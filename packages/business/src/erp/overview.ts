import type { ErpOverview } from "@savingroup/contracts";
import { LOW_STOCK_THRESHOLD } from "@savingroup/contracts";
import type { BusinessClient } from "../context.js";
import { decimalToNumber } from "../money.js";
import { ensureBusinessSettings } from "../settings.js";

export async function erpOverview(client: BusinessClient, spaceId: string): Promise<ErpOverview> {
  const [settings, products, lowStock, draftOrders, pendingOrders, confirmed, draftInvoices, open] =
    await Promise.all([
      ensureBusinessSettings(client, spaceId),
      client.erpProduct.count({ where: { spaceId, active: true } }),
      client.erpProduct.count({
        where: { spaceId, active: true, stockOnHand: { lte: LOW_STOCK_THRESHOLD } },
      }),
      client.erpSalesOrder.count({ where: { spaceId, status: "draft" } }),
      client.erpSalesOrder.count({ where: { spaceId, status: "pending_approval" } }),
      client.erpSalesOrder.aggregate({
        where: { spaceId, status: "confirmed" },
        _count: { _all: true },
        _sum: { subtotal: true },
      }),
      client.erpInvoice.count({ where: { spaceId, status: "draft" } }),
      client.erpInvoice.aggregate({
        where: { spaceId, status: "issued" },
        _sum: { total: true, amountPaid: true },
      }),
    ]);
  return {
    products,
    lowStockProducts: lowStock,
    draftOrders,
    pendingApprovalOrders: pendingOrders,
    confirmedOrders: confirmed._count._all,
    confirmedOrderAmount: decimalToNumber(confirmed._sum.subtotal),
    draftInvoices,
    outstandingInvoiceAmount:
      decimalToNumber(open._sum.total) - decimalToNumber(open._sum.amountPaid),
    currency: settings.currency,
  };
}
