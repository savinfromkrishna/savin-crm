import type {
  BusinessBotSummary,
  CrmCompany,
  CrmContact,
  ErpInvoice,
  ErpProduct,
} from "@savingroup/contracts";
import { Button, cn, Input, NativeSelect, NativeSelectOption, Textarea } from "@savingroup/ui-web";
import {
  Calculator,
  Check,
  Copy,
  CreditCard,
  Download,
  FileSpreadsheet,
  Mail,
  PackagePlus,
  Plus,
  Send,
  Trash2,
  Truck,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";
import { useMoney } from "./records";

// --- 1. Universal CSV Export Button ------------------------------------------

export type CsvColumn<Row> = {
  header: string;
  value: (row: Row) => string | number | boolean | null | undefined;
};

function escapeCsvCell(raw: string | number | boolean | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  const text = String(raw);
  if (text.includes(",") || text.includes('"') || text.includes("\n") || text.includes("\r")) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export function CsvExportButton<Row>({
  filename,
  rows,
  columns,
  label = "Export CSV",
}: {
  filename: string;
  rows: readonly Row[];
  columns: readonly CsvColumn<Row>[];
  label?: string;
}) {
  const [exported, setExported] = useState(false);

  function handleExport() {
    const headerRow = columns.map((col) => escapeCsvCell(col.header)).join(",");
    const bodyRows = rows.map((row) =>
      columns.map((col) => escapeCsvCell(col.value(row))).join(","),
    );
    const csvContent = `\uFEFF${[headerRow, ...bodyRows].join("\r\n")}`;
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setExported(true);
    window.setTimeout(() => setExported(false), 1800);
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={rows.length === 0}
      onClick={handleExport}
      title={`Download ${rows.length} records as CSV`}
    >
      {exported ? (
        <Check className="size-3.5 text-success" data-icon="inline-start" aria-hidden="true" />
      ) : (
        <Download className="size-3.5" data-icon="inline-start" aria-hidden="true" />
      )}
      {exported ? "Exported" : label}
    </Button>
  );
}

// --- 2. Universal Bulk CSV Importer Modal ------------------------------------

export type CsvImportEntity = "leads" | "companies" | "contacts" | "products";

const SAMPLE_CSV_BY_ENTITY: Record<CsvImportEntity, { headers: string; sample: string }> = {
  leads: {
    headers: "title,company,value,source,notes",
    sample: [
      "title,company,value,source,notes",
      "Global Cloud ERP Rollout,Apex Manufacturing,48000,Inbound Demo,Multi-site warehouse automation inquiry",
      "Autonomous Revenue Desk Pilot,Vanguard Logistics,24500,Partner Referral,Looking for 15 AI agent seats",
      "Enterprise Supply Chain Upgrade,Helios Energy Corp,92000,Executive Outbound,Replacing legacy on-prem ERP",
    ].join("\n"),
  },
  companies: {
    headers: "name,domain,phone,notes",
    sample: [
      "name,domain,phone,notes",
      "Apex Manufacturing Inc,apexmfg.io,+1-415-890-2210,Tier-1 industrial equipment partner",
      "Vanguard Global Logistics,vanguardfreight.com,+1-312-550-9801,Mid-market freight & distribution",
      "Helios Clean Energy,heliosenergy.co,+1-512-774-3390,Enterprise energy infrastructure",
    ].join("\n"),
  },
  contacts: {
    headers: "firstName,lastName,email,phone,title,company",
    sample: [
      "firstName,lastName,email,phone,title,company",
      "Elena,Rostova,elena.rostova@apexmfg.io,+1-415-890-2211,VP of Operations,Apex Manufacturing Inc",
      "Marcus,Vance,mvance@vanguardfreight.com,+1-312-550-9805,Chief Revenue Officer,Vanguard Global Logistics",
      "Sophia,Chen,s.chen@heliosenergy.co,+1-512-774-3395,Head of Procurement,Helios Clean Energy",
    ].join("\n"),
  },
  products: {
    headers: "sku,name,unitPrice,unit,stockOnHand,reorderPoint,description",
    sample: [
      "sku,name,unitPrice,unit,stockOnHand,reorderPoint,description",
      "ENT-NODE-A1,Autonomous AI Operator Seat (Annual),3600,seat,150,25,Full-access autonomous CRM + ERP agent license",
      "HW-SCAN-X9,Industrial RFID Warehouse Scanner,890,unit,45,15,Ruggedized ultra-high-frequency barcode & RFID reader",
      "SVC-IMPL-PRO,Enterprise Onboarding & Migration Pack,7500,package,30,5,Dedicated data migration & workflow architecture",
    ].join("\n"),
  },
};

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((ch === "," || ch === "\t") && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCsvText(raw: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]!).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const record: Record<string, string> = {};
    headers.forEach((header, idx) => {
      record[header.toLowerCase()] = cells[idx] ?? "";
    });
    return record;
  });
  return { headers, rows };
}

export function CsvImportModal({
  entity,
  bots,
  companies = [],
  onClose,
  onImported,
}: {
  entity: CsvImportEntity;
  bots: readonly BusinessBotSummary[];
  companies?: readonly CrmCompany[];
  onClose: () => void;
  onImported: () => void;
}) {
  const formId = useId();
  const [csvText, setCsvText] = useState(SAMPLE_CSV_BY_ENTITY[entity].sample);
  const [actorBotId, setActorBotId] = useState<string>(bots[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");

  const parsed = useMemo(() => parseCsvText(csvText), [csvText]);

  function handleFileUpload(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setCsvText(reader.result);
      }
    };
    reader.readAsText(file);
  }

  async function runImport() {
    if (parsed.rows.length === 0) return;
    setBusy(true);
    setError("");
    setProgress({ done: 0, total: parsed.rows.length });

    try {
      const companyByName = new Map<string, string>(
        companies.map((c) => [c.name.toLowerCase(), c.id]),
      );

      let done = 0;
      for (const row of parsed.rows) {
        const botPayload = actorBotId ? { actorBotId } : {};

        if (entity === "companies") {
          const name = row.name || row.company || row.organization || "";
          if (!name) continue;
          const created = await rpc.crm.companies.create({
            name,
            ...(row.domain ? { domain: row.domain } : {}),
            ...(row.phone ? { phone: row.phone } : {}),
            ...(row.notes ? { notes: row.notes } : {}),
            ...botPayload,
          });
          companyByName.set(created.name.toLowerCase(), created.id);
        } else if (entity === "contacts") {
          const firstName = row.firstname || row.first_name || row.name?.split(" ")[0] || "";
          const lastName =
            row.lastname || row.last_name || row.name?.split(" ").slice(1).join(" ") || "";
          if (!firstName) continue;
          const companyName = (row.company || row.organization || "").trim();
          let companyId = companyName ? companyByName.get(companyName.toLowerCase()) : undefined;
          if (companyName && !companyId) {
            const createdCo = await rpc.crm.companies.create({
              name: companyName,
              ...botPayload,
            });
            companyId = createdCo.id;
            companyByName.set(companyName.toLowerCase(), createdCo.id);
          }
          await rpc.crm.contacts.create({
            firstName,
            ...(lastName ? { lastName } : {}),
            ...(row.email ? { email: row.email } : {}),
            ...(row.phone ? { phone: row.phone } : {}),
            ...(row.title ? { title: row.title } : {}),
            ...(companyId ? { companyId } : {}),
            ...botPayload,
          });
        } else if (entity === "leads") {
          const title = row.title || row.name || row.lead || "";
          if (!title) continue;
          const companyName = (row.company || row.organization || "").trim();
          let companyId = companyName ? companyByName.get(companyName.toLowerCase()) : undefined;
          if (companyName && !companyId) {
            const createdCo = await rpc.crm.companies.create({
              name: companyName,
              ...botPayload,
            });
            companyId = createdCo.id;
            companyByName.set(companyName.toLowerCase(), createdCo.id);
          }
          const numericVal = Number.parseFloat((row.value || row.amount || "").replaceAll(",", ""));
          await rpc.crm.leads.create({
            title,
            ...(companyId ? { companyId } : {}),
            ...(Number.isFinite(numericVal) && numericVal >= 0 ? { value: numericVal } : {}),
            ...(row.source ? { source: row.source } : {}),
            ...(row.notes ? { notes: row.notes } : {}),
            ...(actorBotId ? { assigneeBotId: actorBotId, actorBotId } : {}),
          });
        } else if (entity === "products") {
          const sku = (
            row.sku ||
            row.code ||
            `SKU-${Math.floor(1000 + Math.random() * 9000)}`
          ).toUpperCase();
          const name = row.name || row.title || row.product || "";
          if (!name) continue;
          const unitPrice = Number.parseFloat(
            (row.unitprice || row.price || "0").replaceAll(",", ""),
          );
          const initialStock = Number.parseInt(
            row.stockonhand || row.initialstock || row.stock || "0",
            10,
          );
          await rpc.erp.products.create({
            sku,
            name,
            unitPrice: Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : 0,
            initialStock: Number.isFinite(initialStock) && initialStock >= 0 ? initialStock : 0,
            ...(row.description ? { description: row.description } : {}),
            ...(row.hsncode || row.hsn ? { hsnCode: row.hsncode || row.hsn } : {}),
            ...botPayload,
          });
        }

        done += 1;
        setProgress({ done, total: parsed.rows.length });
      }

      onImported();
      onClose();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  const titleByEntity: Record<CsvImportEntity, string> = {
    leads: "Bulk Import Leads (CSV / Spreadsheet)",
    companies: "Bulk Import Accounts (CSV / Spreadsheet)",
    contacts: "Bulk Import Contacts (CSV / Spreadsheet)",
    products: "Bulk Import Catalog SKUs (CSV / Spreadsheet)",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close modal"
        onClick={onClose}
        className="fixed inset-0 bg-background/75 backdrop-blur-xs"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titleByEntity[entity]}
        className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl"
      >
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="grid size-8 place-items-center rounded-lg border bg-muted/50">
              <FileSpreadsheet className="size-4 text-foreground" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">{titleByEntity[entity]}</h2>
              <p className="text-xs text-muted-foreground">
                Upload a `.csv` file or paste rows directly from Excel / Google Sheets.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="rk-scroll flex-1 space-y-4 overflow-y-auto p-5">
          {error ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
              {error}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor={`${formId}-file`}
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                Upload CSV / TSV File
              </label>
              <Input
                id={`${formId}-file`}
                type="file"
                accept=".csv,.tsv,.txt"
                onChange={(e) => handleFileUpload(e.target.files?.[0])}
                className="text-xs"
              />
            </div>
            <div>
              <label
                htmlFor={`${formId}-bot`}
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                Execute & Attribute Import To
              </label>
              <NativeSelect
                id={`${formId}-bot`}
                value={actorBotId}
                onChange={(e) => setActorBotId(e.target.value)}
                className="w-full"
              >
                <NativeSelectOption value="">Human Operator (Current Session)</NativeSelectOption>
                {bots.map((bot) => (
                  <NativeSelectOption key={bot.id} value={bot.id}>
                    🤖 {bot.name} (AI Agent Seat)
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor={`${formId}-csv`}
                className="text-xs font-medium text-muted-foreground"
              >
                Expected Columns:{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                  {SAMPLE_CSV_BY_ENTITY[entity].headers}
                </code>
              </label>
              <button
                type="button"
                onClick={() => setCsvText(SAMPLE_CSV_BY_ENTITY[entity].sample)}
                className="text-xs font-medium text-foreground underline-offset-2 hover:underline"
              >
                Load sample template
              </button>
            </div>
            <Textarea
              id={`${formId}-csv`}
              rows={5}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              className="font-mono text-xs"
              placeholder={SAMPLE_CSV_BY_ENTITY[entity].sample}
            />
          </div>

          <div className="rounded-xl border bg-muted/20">
            <div className="flex items-center justify-between border-b px-3.5 py-2">
              <span className="text-xs font-semibold">
                Live Parsed Preview ({parsed.rows.length} rows ready)
              </span>
              {progress ? (
                <span className="font-mono text-xs text-success">
                  Importing {progress.done} / {progress.total}…
                </span>
              ) : null}
            </div>
            {parsed.rows.length === 0 ? (
              <p className="p-4 text-center text-xs text-muted-foreground">
                No valid data rows detected yet.
              </p>
            ) : (
              <div className="max-h-44 overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b bg-muted/40 text-[11px] font-medium text-muted-foreground uppercase">
                    <tr>
                      {parsed.headers.map((header) => (
                        <th key={header} className="px-3 py-1.5">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {parsed.rows.slice(0, 8).map((row, idx) => (
                      <tr key={idx}>
                        {parsed.headers.map((header) => (
                          <td key={header} className="max-w-44 truncate px-3 py-1.5">
                            {row[header.toLowerCase()] || "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t bg-muted/30 px-5 py-3">
          <span className="text-xs text-muted-foreground">
            Auto-links existing companies by name and logs full audit attribution.
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || parsed.rows.length === 0}
              onClick={() => void runImport()}
            >
              <Upload className="size-3.5" data-icon="inline-start" aria-hidden="true" />
              {busy ? "Importing…" : `Import ${parsed.rows.length} Records`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- 3. Interactive Commercial Tax, Discount & Payment Terms Calculator ------

export type CommercialTermsState = {
  discountPercent: number;
  taxPercent: number;
  taxLabel: string;
  shippingFee: number;
  paymentTerms: string;
};

const DEFAULT_TERMS: CommercialTermsState = {
  discountPercent: 0,
  taxPercent: 8.25,
  taxLabel: "Sales Tax / VAT",
  shippingFee: 0,
  paymentTerms: "Net 30",
};

const TAX_PRESETS = [
  { label: "Exempt / 0%", rate: 0 },
  { label: "US Sales Tax (8.25%)", rate: 8.25 },
  { label: "India GST (18%)", rate: 18 },
  { label: "EU / UK VAT (20%)", rate: 20 },
  { label: "Reduced GST / VAT (5%)", rate: 5 },
] as const;

export function readCommercialTerms(recordId: string): CommercialTermsState {
  try {
    const raw = window.localStorage.getItem(`savingroup.commercial.terms.${recordId}`);
    if (!raw) return DEFAULT_TERMS;
    const parsed = JSON.parse(raw) as Partial<CommercialTermsState>;
    return {
      discountPercent:
        typeof parsed.discountPercent === "number" && Number.isFinite(parsed.discountPercent)
          ? parsed.discountPercent
          : 0,
      taxPercent:
        typeof parsed.taxPercent === "number" && Number.isFinite(parsed.taxPercent)
          ? parsed.taxPercent
          : 8.25,
      taxLabel: typeof parsed.taxLabel === "string" ? parsed.taxLabel : "Sales Tax / VAT",
      shippingFee:
        typeof parsed.shippingFee === "number" && Number.isFinite(parsed.shippingFee)
          ? parsed.shippingFee
          : 0,
      paymentTerms: typeof parsed.paymentTerms === "string" ? parsed.paymentTerms : "Net 30",
    };
  } catch {
    return DEFAULT_TERMS;
  }
}

export function QuoteTaxCalculatorCard({
  recordId,
  currency,
  grossSubtotal,
}: {
  recordId: string;
  currency: string;
  grossSubtotal: number;
}) {
  const money = useMoney(currency);
  const [terms, setTerms] = useState<CommercialTermsState>(() => readCommercialTerms(recordId));

  useEffect(() => {
    setTerms(readCommercialTerms(recordId));
  }, [recordId]);

  function updateTerms(patch: Partial<CommercialTermsState>) {
    setTerms((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(
          `savingroup.commercial.terms.${recordId}`,
          JSON.stringify(next),
        );
      } catch {
        // Ignore storage quota errors
      }
      return next;
    });
  }

  const discountAmount = Math.max(0, (grossSubtotal * terms.discountPercent) / 100);
  const netTaxable = Math.max(0, grossSubtotal - discountAmount);
  const taxAmount = Math.max(0, (netTaxable * terms.taxPercent) / 100);
  const grandTotal = netTaxable + taxAmount + Math.max(0, terms.shippingFee);

  return (
    <div className="rounded-xl border bg-card p-4 shadow-2xs">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b pb-2.5">
        <div className="flex items-center gap-2">
          <Calculator className="size-4 text-muted-foreground" />
          <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Commercial Pricing, Tax & Payment Terms Engine
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {TAX_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => updateTerms({ taxPercent: preset.rate, taxLabel: preset.label })}
              className={cn(
                "rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors",
                terms.taxPercent === preset.rate
                  ? "border-foreground bg-foreground text-background"
                  : "bg-muted/40 text-muted-foreground hover:text-foreground",
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-12">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:col-span-7">
          <div>
            <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Discount (%)
            </span>
            <Input
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={String(terms.discountPercent)}
              onChange={(e) =>
                updateTerms({
                  discountPercent: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                })
              }
              className="h-8 text-xs tabular-nums"
            />
          </div>
          <div>
            <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Tax Rate (%)
            </span>
            <Input
              type="number"
              min="0"
              max="100"
              step="0.25"
              value={String(terms.taxPercent)}
              onChange={(e) =>
                updateTerms({
                  taxPercent: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                })
              }
              className="h-8 text-xs tabular-nums"
            />
          </div>
          <div>
            <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Shipping / Freight
            </span>
            <Input
              type="number"
              min="0"
              step="10"
              value={String(terms.shippingFee)}
              onChange={(e) =>
                updateTerms({ shippingFee: Math.max(0, Number(e.target.value) || 0) })
              }
              className="h-8 text-xs tabular-nums"
            />
          </div>
          <div>
            <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Payment Terms
            </span>
            <NativeSelect
              value={terms.paymentTerms}
              onChange={(e) => updateTerms({ paymentTerms: e.target.value })}
              className="h-8 w-full text-xs"
            >
              <NativeSelectOption value="Due on Receipt">Due on Receipt</NativeSelectOption>
              <NativeSelectOption value="Net 15">Net 15 Days</NativeSelectOption>
              <NativeSelectOption value="Net 30">Net 30 Days</NativeSelectOption>
              <NativeSelectOption value="Net 60">Net 60 Days</NativeSelectOption>
              <NativeSelectOption value="50% Upfront / 50% Delivery">
                50% Upfront / 50% Delivery
              </NativeSelectOption>
            </NativeSelect>
          </div>
        </div>

        <div className="space-y-1.5 rounded-lg border bg-muted/20 p-3 text-xs md:col-span-5">
          <div className="flex items-center justify-between text-muted-foreground">
            <span>Gross Line Subtotal</span>
            <span className="font-mono tabular-nums">{money(grossSubtotal)}</span>
          </div>
          {terms.discountPercent > 0 ? (
            <div className="flex items-center justify-between text-success">
              <span>Commercial Discount ({terms.discountPercent}%)</span>
              <span className="font-mono tabular-nums">-{money(discountAmount)}</span>
            </div>
          ) : null}
          <div className="flex items-center justify-between text-muted-foreground">
            <span>Taxable Base</span>
            <span className="font-mono tabular-nums">{money(netTaxable)}</span>
          </div>
          <div className="flex items-center justify-between text-muted-foreground">
            <span>
              {terms.taxLabel} ({terms.taxPercent}%)
            </span>
            <span className="font-mono tabular-nums">+{money(taxAmount)}</span>
          </div>
          {terms.shippingFee > 0 ? (
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Shipping & Handling</span>
              <span className="font-mono tabular-nums">+{money(terms.shippingFee)}</span>
            </div>
          ) : null}
          <div className="flex items-center justify-between border-t pt-1.5 text-sm font-semibold text-foreground">
            <span>Tax-Inclusive Total ({terms.paymentTerms})</span>
            <span className="font-mono tabular-nums">{money(grandTotal)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- 4. Purchase Order & Warehouse Restocking Modal --------------------------

type PoLineDraft = {
  id: string;
  productId: string;
  quantity: string;
  unitCost: string;
};

export function PurchaseRestockModal({
  products,
  bots,
  currency,
  onClose,
  onSaved,
}: {
  products: readonly ErpProduct[];
  bots: readonly BusinessBotSummary[];
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const money = useMoney(currency);
  const [poNumber, setPoNumber] = useState(
    () => `PO-2026-${String(Math.floor(100 + Math.random() * 900))}`,
  );
  const [vendorName, setVendorName] = useState("Global Industrial Supply Co.");
  const [warehouse, setWarehouse] = useState("Primary Distribution Hub (WH-01)");
  const [actorBotId, setActorBotId] = useState(
    () => bots.find((b) => b.name.toLowerCase().includes("operation"))?.id ?? bots[0]?.id ?? "",
  );
  const [lines, setLines] = useState<PoLineDraft[]>(() => {
    const lowStock = products.filter((p) => p.active && p.stockOnHand <= p.reorderPoint);
    const seed = lowStock.length > 0 ? lowStock.slice(0, 3) : products.slice(0, 2);
    return seed.map((p, idx) => ({
      id: `po-line-${idx}`,
      productId: p.id,
      quantity: String(Math.max(25, p.reorderPoint * 2 - p.stockOnHand)),
      unitCost: String(Math.round(p.unitPrice * 0.6 * 100) / 100),
    }));
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const totalPoCost = useMemo(() => {
    return lines.reduce((sum, line) => {
      const qty = Number.parseInt(line.quantity, 10) || 0;
      const cost = Number.parseFloat(line.unitCost) || 0;
      return sum + Math.max(0, qty) * Math.max(0, cost);
    }, 0);
  }, [lines]);

  function addLine() {
    const first = products[0];
    if (!first) return;
    setLines((prev) => [
      ...prev,
      {
        id: `po-line-${Date.now()}-${prev.length}`,
        productId: first.id,
        quantity: "25",
        unitCost: String(Math.round(first.unitPrice * 0.6 * 100) / 100),
      },
    ]);
  }

  async function receivePurchaseOrder() {
    const validLines = lines
      .map((l) => ({
        productId: l.productId,
        qty: Number.parseInt(l.quantity, 10),
        cost: Number.parseFloat(l.unitCost) || 0,
      }))
      .filter((l) => l.productId && Number.isFinite(l.qty) && l.qty > 0);

    if (validLines.length === 0) {
      setError("Add at least one SKU line with a positive receive quantity.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      for (const item of validLines) {
        await rpc.erp.inventory.adjust({
          productId: item.productId,
          delta: item.qty,
          reason: `[${poNumber.trim() || "PO"}] Vendor: ${vendorName.trim() || "Supplier"} · ${warehouse} · Unit Cost ${item.cost}`,
          ...(actorBotId ? { actorBotId } : {}),
        });
      }
      onSaved();
      onClose();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close modal"
        onClick={onClose}
        className="fixed inset-0 bg-background/75 backdrop-blur-xs"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Receive Purchase Order & Restock Inventory"
        className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl"
      >
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="grid size-8 place-items-center rounded-lg border bg-muted/50">
              <Truck className="size-4 text-foreground" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">
                Purchase Order Receipt & Warehouse Restocking
              </h2>
              <p className="text-xs text-muted-foreground">
                Receive vendor shipment into stock and record immutable procurement ledger entries.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="rk-scroll flex-1 space-y-4 overflow-y-auto p-5">
          {error ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
              {error}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                PO Reference
              </span>
              <Input
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
            <div>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                Supplier / Vendor
              </span>
              <Input
                value={vendorName}
                onChange={(e) => setVendorName(e.target.value)}
                className="text-xs"
              />
            </div>
            <div>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                Target Warehouse
              </span>
              <NativeSelect
                value={warehouse}
                onChange={(e) => setWarehouse(e.target.value)}
                className="w-full text-xs"
              >
                <NativeSelectOption value="Primary Distribution Hub (WH-01)">
                  Primary Distribution Hub (WH-01)
                </NativeSelectOption>
                <NativeSelectOption value="East Coast Fulfillment (WH-02)">
                  East Coast Fulfillment (WH-02)
                </NativeSelectOption>
                <NativeSelectOption value="EU Regional Depot (WH-03)">
                  EU Regional Depot (WH-03)
                </NativeSelectOption>
              </NativeSelect>
            </div>
            <div>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                Receiving Agent
              </span>
              <NativeSelect
                value={actorBotId}
                onChange={(e) => setActorBotId(e.target.value)}
                className="w-full text-xs"
              >
                <NativeSelectOption value="">Human Operator</NativeSelectOption>
                {bots.map((bot) => (
                  <NativeSelectOption key={bot.id} value={bot.id}>
                    🤖 {bot.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>

          <div className="rounded-xl border">
            <div className="flex items-center justify-between border-b bg-muted/30 px-3.5 py-2">
              <span className="text-xs font-semibold">Purchase Order Line Items</span>
              <Button type="button" variant="outline" size="xs" onClick={addLine}>
                <Plus className="size-3.5" data-icon="inline-start" />
                Add SKU Line
              </Button>
            </div>
            <div className="divide-y">
              {lines.map((line, index) => {
                const product = products.find((p) => p.id === line.productId);
                return (
                  <div
                    key={line.id}
                    className="grid grid-cols-12 items-center gap-2 px-3.5 py-2.5 text-xs"
                  >
                    <div className="col-span-5">
                      <NativeSelect
                        value={line.productId}
                        onChange={(e) => {
                          const nextProd = products.find((p) => p.id === e.target.value);
                          setLines((prev) =>
                            prev.map((item, i) =>
                              i === index
                                ? {
                                    ...item,
                                    productId: e.target.value,
                                    unitCost: nextProd
                                      ? String(Math.round(nextProd.unitPrice * 0.6 * 100) / 100)
                                      : item.unitCost,
                                  }
                                : item,
                            ),
                          );
                        }}
                        className="w-full text-xs"
                      >
                        {products.map((p) => (
                          <NativeSelectOption key={p.id} value={p.id}>
                            {p.sku} · {p.name} (Stock: {p.stockOnHand})
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </div>
                    <div className="col-span-3">
                      <Input
                        type="number"
                        min="1"
                        placeholder="Qty to receive"
                        value={line.quantity}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((item, i) =>
                              i === index ? { ...item, quantity: e.target.value } : item,
                            ),
                          )
                        }
                        className="h-8 text-xs tabular-nums"
                      />
                    </div>
                    <div className="col-span-3">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Unit cost"
                        value={line.unitCost}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((item, i) =>
                              i === index ? { ...item, unitCost: e.target.value } : item,
                            ),
                          )
                        }
                        className="h-8 text-xs tabular-nums"
                      />
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <button
                        type="button"
                        onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                        disabled={lines.length <= 1}
                        className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
                        title={`Remove ${product?.sku ?? "line"}`}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between border-t bg-muted/20 px-3.5 py-2.5 text-xs">
              <span className="text-muted-foreground">Total Estimated Procurement Value</span>
              <span className="font-mono text-sm font-semibold tabular-nums">
                {money(totalPoCost)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t bg-muted/30 px-5 py-3">
          <span className="text-xs text-muted-foreground">
            Updates on-hand stock immediately and writes PO receipt to audit ledger.
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => void receivePurchaseOrder()}
            >
              <PackagePlus className="size-3.5" data-icon="inline-start" />
              {busy ? "Receiving Stock…" : `Receive ${poNumber}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- 5. Customer Payment Link & Invoice Email Dispatch Modal -----------------

export function SendInvoicePaymentModal({
  invoice,
  contacts,
  bots,
  onClose,
  onSaved,
}: {
  invoice: ErpInvoice;
  contacts: readonly CrmContact[];
  bots: readonly BusinessBotSummary[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const money = useMoney(invoice.currency);
  const linkedContact = contacts.find(
    (c) => c.id === invoice.contactId || (invoice.companyId && c.companyId === invoice.companyId),
  );
  const [recipientEmail, setRecipientEmail] = useState(
    linkedContact?.email ??
      `accounts@${(invoice.companyName ?? "customer").toLowerCase().replaceAll(/[^a-z0-9]/g, "")}.com`,
  );
  const [actorBotId, setActorBotId] = useState(
    () => bots.find((b) => b.name.toLowerCase().includes("finance"))?.id ?? bots[0]?.id ?? "",
  );
  const balanceDue = Math.max(0, invoice.total - invoice.amountPaid);
  const paymentUrl = `https://pay.savingroup.app/checkout/${invoice.ref.toLowerCase()}`;
  const [messageBody, setMessageBody] = useState(
    `Hello ${linkedContact?.name ?? invoice.companyName ?? "Customer"},\n\nPlease find attached Invoice ${invoice.ref} for ${money(invoice.total)} (Balance Due: ${money(balanceDue)}).\n\nYou can review line items and complete instant ACH / Card payment online via your secure checkout link:\n${paymentUrl}\n\nThank you for your business.`,
  );
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sentSuccess, setSentSuccess] = useState(false);
  const [error, setError] = useState("");

  function copyPaymentLink() {
    void navigator.clipboard?.writeText(paymentUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function dispatchInvoiceEmail() {
    setBusy(true);
    setError("");
    try {
      if (invoice.status === "draft") {
        await rpc.erp.invoices.issue({
          id: invoice.id,
          ...(actorBotId ? { actorBotId } : {}),
        });
      }
      if (invoice.companyId || invoice.contactId) {
        await rpc.crm.activities.create({
          kind: "email",
          subject: `Dispatched Invoice ${invoice.ref} & Payment Link to ${recipientEmail}`,
          body: messageBody,
          ...(invoice.companyId ? { companyId: invoice.companyId } : {}),
          ...(invoice.contactId
            ? { contactId: invoice.contactId }
            : linkedContact
              ? { contactId: linkedContact.id }
              : {}),
          completed: true,
          ...(actorBotId ? { actorBotId, assigneeBotId: actorBotId } : {}),
        });
      }
      setSentSuccess(true);
      onSaved();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function simulateCustomerOnlinePayment() {
    if (balanceDue <= 0) return;
    setBusy(true);
    setError("");
    try {
      if (invoice.status === "draft") {
        await rpc.erp.invoices.issue({
          id: invoice.id,
          ...(actorBotId ? { actorBotId } : {}),
        });
      }
      await rpc.erp.invoices.recordPayment({
        id: invoice.id,
        amount: balanceDue,
        ...(actorBotId ? { actorBotId } : {}),
      });
      if (invoice.companyId || invoice.contactId) {
        await rpc.crm.activities.create({
          kind: "note",
          subject: `Online Payment Received (${money(balanceDue)}) for ${invoice.ref}`,
          body: `Customer completed online checkout via ${paymentUrl}. Invoice marked Paid in full.`,
          ...(invoice.companyId ? { companyId: invoice.companyId } : {}),
          ...(invoice.contactId ? { contactId: invoice.contactId } : {}),
          completed: true,
          ...(actorBotId ? { actorBotId } : {}),
        });
      }
      onSaved();
      onClose();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close modal"
        onClick={onClose}
        className="fixed inset-0 bg-background/75 backdrop-blur-xs"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Dispatch Invoice ${invoice.ref}`}
        className="relative z-10 flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl"
      >
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="grid size-8 place-items-center rounded-lg border bg-muted/50">
              <Mail className="size-4 text-foreground" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">
                Dispatch Invoice {invoice.ref} & Customer Checkout Link
              </h2>
              <p className="text-xs text-muted-foreground">
                {invoice.companyName ?? "Customer"} · Balance Due:{" "}
                <span className="font-mono font-semibold text-foreground">{money(balanceDue)}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="rk-scroll flex-1 space-y-4 overflow-y-auto p-5">
          {error ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
              {error}
            </div>
          ) : null}
          {sentSuccess ? (
            <div className="flex items-center justify-between rounded-xl border border-success/40 bg-success/10 px-3.5 py-2.5 text-xs text-success">
              <span>
                ✓ Invoice {invoice.ref} dispatched to {recipientEmail} and logged to CRM timeline!
              </span>
              <button
                type="button"
                onClick={onClose}
                className="font-semibold underline underline-offset-2"
              >
                Done
              </button>
            </div>
          ) : null}

          <div className="rounded-xl border bg-muted/30 p-3">
            <span className="mb-1 block text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              Customer Online Payment Link
            </span>
            <div className="flex items-center gap-2">
              <Input readOnly value={paymentUrl} className="h-8 font-mono text-xs" />
              <Button type="button" variant="outline" size="sm" onClick={copyPaymentLink}>
                {copied ? (
                  <Check className="size-3.5 text-success" data-icon="inline-start" />
                ) : (
                  <Copy className="size-3.5" data-icon="inline-start" />
                )}
                {copied ? "Copied" : "Copy Link"}
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                Recipient Billing Email
              </span>
              <Input
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                className="text-xs"
              />
            </div>
            <div>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                Dispatched By Agent
              </span>
              <NativeSelect
                value={actorBotId}
                onChange={(e) => setActorBotId(e.target.value)}
                className="w-full text-xs"
              >
                <NativeSelectOption value="">Human Operator</NativeSelectOption>
                {bots.map((bot) => (
                  <NativeSelectOption key={bot.id} value={bot.id}>
                    🤖 {bot.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>

          <div>
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              Invoice Dispatch Email Body
            </span>
            <Textarea
              rows={6}
              value={messageBody}
              onChange={(e) => setMessageBody(e.target.value)}
              className="text-xs"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-5 py-3">
          {balanceDue > 0 && invoice.status !== "void" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void simulateCustomerOnlinePayment()}
            >
              <CreditCard className="size-3.5" data-icon="inline-start" />
              Simulate Instant Online Payment ({money(balanceDue)})
            </Button>
          ) : (
            <span className="text-xs text-success">✓ Paid in full</span>
          )}
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={busy}>
              Close
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || !recipientEmail.trim()}
              onClick={() => void dispatchInvoiceEmail()}
            >
              <Send className="size-3.5" data-icon="inline-start" />
              {busy ? "Sending…" : "Send Invoice & Log Email"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
