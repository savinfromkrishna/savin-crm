import type {
  CreateInvoiceDraftInput,
  ErpInvoice,
  InvoiceRefInput,
  IssueInvoiceInput,
  RecordInvoicePaymentInput,
  SearchInvoicesInput,
} from "@savingroup/contracts";
import { INVOICE_REF_PREFIX, parseBusinessRef } from "@savingroup/contracts";
import type { Prisma } from "@savingroup/db";
import { AttributionResolver, resolveAttribution } from "../attribution.js";
import { emitBusinessEvent } from "../audit.js";
import type { BusinessClient, BusinessContext } from "../context.js";
import { actorColumns, actorIds } from "../context.js";
import { conflict, invalidInput, invalidState, notFound, permissionDenied } from "../errors.js";
import { addMoney, decimalToNumber, toDecimal } from "../money.js";
import { allocateBusinessNumber, ensureBusinessSettings } from "../settings.js";
import {
  coerceInvoiceStatus,
  coerceOrderStatus,
  collectInvoice,
  type InvoiceRowWithRelations,
  invoiceInclude,
  invoiceRef,
  orderRef,
  toInvoiceDto,
} from "./dto.js";
import { requireOrderByRef } from "./orders.js";

async function invoiceAttribution(
  client: BusinessClient,
  spaceId: string,
  row: InvoiceRowWithRelations,
): Promise<AttributionResolver> {
  const resolver = new AttributionResolver(client, spaceId);
  collectInvoice(resolver, row);
  await resolver.load();
  return resolver;
}

async function loadInvoice(
  client: BusinessClient,
  spaceId: string,
  id: string,
): Promise<InvoiceRowWithRelations> {
  const row = await client.erpInvoice.findFirst({
    where: { id, spaceId },
    include: invoiceInclude,
  });
  if (!row) throw notFound("Invoice");
  return row;
}

export async function requireInvoiceByRef(
  client: BusinessClient,
  spaceId: string,
  ref: { id?: string; ref?: string },
): Promise<InvoiceRowWithRelations> {
  if (ref.id) return loadInvoice(client, spaceId, ref.id);
  if (ref.ref) {
    const number = parseBusinessRef(ref.ref, INVOICE_REF_PREFIX);
    if (number === null) throw notFound(`Invoice ${ref.ref}`);
    const row = await client.erpInvoice.findFirst({
      where: { spaceId, number },
      include: invoiceInclude,
    });
    if (!row) throw notFound(`Invoice ${ref.ref}`);
    return row;
  }
  throw invalidInput("Provide the invoice id or ref.");
}

async function invoiceDto(client: BusinessClient, spaceId: string, id: string) {
  const row = await loadInvoice(client, spaceId, id);
  return toInvoiceDto(row, await invoiceAttribution(client, spaceId, row));
}

/**
 * While the space requires invoice approval, issuing and payments stay with people:
 * bots may draft and read invoices, but not move money-facing state.
 */
async function requireInvoiceActorPolicy(
  tx: Prisma.TransactionClient,
  ctx: BusinessContext,
  verb: string,
): Promise<void> {
  if (!ctx.actor.botId) return;
  const settings = await ensureBusinessSettings(tx, ctx.spaceId);
  if (settings.invoiceApprovalRequired) {
    throw permissionDenied(
      `A person must ${verb} invoices while invoice approval is required for this workspace.`,
    );
  }
}

/** A draft invoice copies the confirmed order's lines; one invoice per order. */
export async function createInvoiceDraft(
  tx: Prisma.TransactionClient,
  ctx: BusinessContext,
  input: CreateInvoiceDraftInput,
): Promise<ErpInvoice> {
  const order = await requireOrderByRef(tx, ctx.spaceId, {
    id: input.orderId,
    ref: input.orderRef,
  });
  if (coerceOrderStatus(order.status) !== "confirmed") {
    throw invalidState(`Order ${orderRef(order)} must be confirmed before invoicing.`);
  }
  if (order.invoice) throw conflict(`Order ${orderRef(order)} already has an invoice.`);
  const number = await allocateBusinessNumber(tx, ctx.spaceId, "invoice");
  const subtotal = decimalToNumber(order.subtotal);
  const row = await tx.erpInvoice.create({
    data: {
      spaceId: ctx.spaceId,
      number,
      status: "draft",
      paymentStatus: "unpaid",
      currency: order.currency,
      subtotal: toDecimal(subtotal),
      total: toDecimal(subtotal),
      amountPaid: toDecimal(0),
      notes: input.notes || null,
      orderId: order.id,
      companyId: order.companyId,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      ...actorColumns(ctx.actor),
      lines: {
        create: order.lines.map((line) => ({
          spaceId: ctx.spaceId,
          productId: line.productId,
          position: line.position,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          lineTotal: line.lineTotal,
        })),
      },
    },
  });
  await emitBusinessEvent(tx, ctx, {
    type: "erp.invoice.draft_created",
    recordType: "invoice",
    recordId: row.id,
    payload: { number: row.number, orderId: order.id, orderRef: orderRef(order), total: subtotal },
  });
  return invoiceDto(tx, ctx.spaceId, row.id);
}

export async function issueInvoice(
  tx: Prisma.TransactionClient,
  ctx: BusinessContext,
  input: IssueInvoiceInput,
): Promise<ErpInvoice> {
  const invoice = await requireInvoiceByRef(tx, ctx.spaceId, input);
  await requireInvoiceActorPolicy(tx, ctx, "issue");
  if (coerceInvoiceStatus(invoice.status) !== "draft") {
    throw invalidState(`Invoice ${invoiceRef(invoice)} is already ${invoice.status}.`);
  }
  if (invoice.lines.length === 0) throw invalidState("An invoice needs at least one line.");
  const approver = actorIds(ctx.actor);
  await tx.erpInvoice.update({
    where: { id: invoice.id },
    data: {
      status: "issued",
      issuedAt: ctx.now,
      ...(input.dueAt ? { dueAt: new Date(input.dueAt) } : {}),
      approvedByUserId: approver.userId,
      approvedByBotId: approver.botId,
    },
  });
  await emitBusinessEvent(tx, ctx, {
    type: "erp.invoice.issued",
    recordType: "invoice",
    recordId: invoice.id,
    payload: { number: invoice.number, total: decimalToNumber(invoice.total) },
  });
  return invoiceDto(tx, ctx.spaceId, invoice.id);
}

export async function recordInvoicePayment(
  tx: Prisma.TransactionClient,
  ctx: BusinessContext,
  input: RecordInvoicePaymentInput,
): Promise<ErpInvoice> {
  const invoice = await requireInvoiceByRef(tx, ctx.spaceId, input);
  await requireInvoiceActorPolicy(tx, ctx, "record a payment on");
  const status = coerceInvoiceStatus(invoice.status);
  if (status === "draft") throw invalidState("Issue the invoice before recording a payment.");
  const total = decimalToNumber(invoice.total);
  const paid = addMoney(decimalToNumber(invoice.amountPaid), input.amount);
  if (paid > total) {
    throw invalidState(
      `Payment of ${input.amount} exceeds the outstanding balance of ${addMoney(total, -decimalToNumber(invoice.amountPaid))}.`,
    );
  }
  const settled = paid >= total;
  await tx.erpInvoice.update({
    where: { id: invoice.id },
    data: {
      amountPaid: toDecimal(paid),
      paymentStatus: settled ? "paid" : "partial",
      ...(settled ? { status: "paid", paidAt: ctx.now } : {}),
    },
  });
  await emitBusinessEvent(tx, ctx, {
    type: "erp.invoice.payment_recorded",
    recordType: "invoice",
    recordId: invoice.id,
    payload: {
      number: invoice.number,
      amount: input.amount,
      amountPaid: paid,
      settled,
      ...(input.note ? { note: input.note } : {}),
    },
  });
  return invoiceDto(tx, ctx.spaceId, invoice.id);
}

export async function getInvoice(
  client: BusinessClient,
  spaceId: string,
  input: InvoiceRefInput,
): Promise<ErpInvoice> {
  const row = await requireInvoiceByRef(client, spaceId, input);
  return toInvoiceDto(row, await invoiceAttribution(client, spaceId, row));
}

export async function searchInvoices(
  client: BusinessClient,
  spaceId: string,
  input: SearchInvoicesInput,
): Promise<{ invoices: ErpInvoice[] }> {
  const rows = await client.erpInvoice.findMany({
    where: {
      spaceId,
      ...(input.status ? { status: input.status } : {}),
      ...(input.paymentStatus ? { paymentStatus: input.paymentStatus } : {}),
      ...(input.companyId ? { companyId: input.companyId } : {}),
    },
    include: invoiceInclude,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: input.limit,
  });
  const attribution = await resolveAttribution(client, spaceId, rows, (row, resolver) =>
    collectInvoice(resolver, row),
  );
  return { invoices: rows.map((row) => toInvoiceDto(row, attribution)) };
}
