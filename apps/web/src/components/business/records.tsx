import { Trans, useLingui } from "@lingui/react/macro";
import type {
  Bot,
  BusinessActor,
  BusinessHistoryEntry,
  BusinessRecordType,
} from "@savingroup/contracts";
import { BotAvatar, cn, Skeleton } from "@savingroup/ui-web";
import type { LucideIcon } from "lucide-react";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Rows3, Search } from "lucide-react";
import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { StatusTone } from "../../lib/business-labels";
import { useHistoryActionLabel } from "../../lib/business-labels";
import { formatRelativeTime } from "../../lib/relative-time";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";

/** Bots of the space, so every actor that is a bot shows the same avatar it has in chat. */
export const BusinessBotsContext = createContext<readonly Bot[]>([]);

export function actorName(actor: BusinessActor | null | undefined, fallback = "—"): string {
  if (!actor) return fallback;
  return actor.name ?? (actor.botId || actor.userId ? fallback : "—");
}

function initials(name: string | null): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

/** Initials for a company (square) or a person (round), so rows read at a glance. */
export function RecordAvatar({
  name,
  shape = "circle",
}: {
  name: string;
  shape?: "circle" | "square";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-7 shrink-0 place-items-center bg-accent text-[11px] font-semibold text-accent-foreground",
        shape === "square" ? "rounded-lg" : "rounded-full",
      )}
    >
      {initials(name)}
    </span>
  );
}

export function ActorAvatar({ actor, size = 18 }: { actor: BusinessActor; size?: number }) {
  const bots = useContext(BusinessBotsContext);
  if (actor.botId) {
    const bot = bots.find((entry) => entry.id === actor.botId);
    return <BotAvatar color={bot?.color ?? ""} identity={actor.botId} size={size} />;
  }
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-full bg-accent font-medium text-accent-foreground"
      style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.42)) }}
    >
      {initials(actor.name)}
    </span>
  );
}

/** A person or bot with its avatar; nothing but the fallback when there is no actor. */
export function ActorLabel({
  actor,
  fallback = "—",
  className,
}: {
  actor: BusinessActor | null | undefined;
  fallback?: string;
  className?: string;
}) {
  if (!actor || (!actor.botId && !actor.userId)) {
    return <span className="text-muted-foreground">{fallback}</span>;
  }
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <ActorAvatar actor={actor} />
      <span className="truncate">{actorName(actor, fallback)}</span>
    </span>
  );
}

// Light success and warning are too pale for small text, so there the dot and
// tint carry the color and the label stays ink.
const TONE_CLASSES: Record<StatusTone, { badge: string; dot: string }> = {
  neutral: { badge: "bg-foreground/8 text-foreground/80", dot: "bg-muted-foreground" },
  progress: {
    badge: "bg-foreground/8 text-foreground ring-1 ring-inset ring-foreground/20",
    dot: "bg-foreground",
  },
  success: { badge: "bg-success/12 text-foreground dark:text-success", dot: "bg-success" },
  warning: { badge: "bg-warning/14 text-foreground dark:text-warning", dot: "bg-warning" },
  destructive: { badge: "bg-destructive/12 text-destructive", dot: "bg-destructive" },
  muted: {
    badge: "text-muted-foreground ring-1 ring-inset ring-border",
    dot: "bg-muted-foreground",
  },
};

export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap",
        TONE_CLASSES[tone].badge,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", TONE_CLASSES[tone].dot)} />
      {children}
    </span>
  );
}

export function useMoney(currency: string) {
  return useMemo(() => {
    let formatter: Intl.NumberFormat | null = null;
    try {
      formatter = new Intl.NumberFormat(undefined, { style: "currency", currency });
    } catch {
      formatter = null;
    }
    return (amount: number) => formatter?.format(amount) ?? `${amount.toFixed(2)} ${currency}`;
  }, [currency]);
}

/**
 * Money for tiles and charts: whole units, and compact from `compactFrom` on
 * (millions by default), so a figure never truncates. Lists and documents keep
 * the exact amount.
 */
export function useShortMoney(currency: string, compactFrom = 1_000_000) {
  return useMemo(() => {
    const make = (options: Intl.NumberFormatOptions) => {
      try {
        return new Intl.NumberFormat(undefined, { style: "currency", currency, ...options });
      } catch {
        return null;
      }
    };
    const whole = make({ minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const compact = make({ notation: "compact", maximumFractionDigits: 1 });
    return (amount: number) =>
      (Math.abs(amount) >= compactFrom ? compact : whole)?.format(amount) ??
      `${Math.round(amount)} ${currency}`;
  }, [compactFrom, currency]);
}

const quantityFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

/** Plain grouped number, for values that carry no currency of their own. */
export function formatQuantity(value: number): string {
  return quantityFormat.format(value);
}

/** Case-insensitive match of a search box against any of the given fields. */
export function matchesQuery(query: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => field?.toLowerCase().includes(needle));
}

export type Column<Row> = {
  key: string;
  header: string;
  render: (row: Row) => ReactNode;
  /** Numbers and money line up on the right. */
  align?: "end";
  /** Columns that matter less give way first when the table is narrow. */
  hideBelow?: ColumnWidth;
  className?: string;
};

type ColumnWidth = "sm" | "md" | "lg";

// Widths are the page content's, not the window's: the assistant panel narrows it.
const HIDE_BELOW: Record<ColumnWidth, string> = {
  sm: "hidden @xl:table-cell",
  md: "hidden @2xl:table-cell",
  lg: "hidden @4xl:table-cell",
};

/** For a line under a row's title that repeats a column while that column is hidden. */
const WHILE_HIDDEN: Record<ColumnWidth, string> = {
  sm: "@xl:hidden",
  md: "@2xl:hidden",
  lg: "@4xl:hidden",
};

function cellClass<Row>(column: Column<Row>) {
  return cn(
    column.align === "end" && "text-end tabular-nums whitespace-nowrap",
    column.hideBelow && HIDE_BELOW[column.hideBelow],
    column.className,
  );
}

function extractComparableValue<Row>(row: Row, key: string): string | number {
  const record = row as Record<string, unknown>;
  const direct = record[key];
  if (typeof direct === "number") return direct;
  if (typeof direct === "string") return direct.toLowerCase();
  for (const fallback of [
    "title",
    "name",
    "orderNumber",
    "invoiceNumber",
    "sku",
    "value",
    "total",
    "price",
    "status",
    "stage",
    "updatedAt",
    "createdAt",
  ]) {
    if (key.toLowerCase().includes(fallback.toLowerCase()) && record[fallback] !== undefined) {
      const val = record[fallback];
      if (typeof val === "number") return val;
      if (typeof val === "string") return val.toLowerCase();
    }
  }
  return String(record.id ?? "");
}

function exportRowsToCsv<Row extends { id: string }>(rows: Row[], filename: string) {
  if (rows.length === 0) return;
  const first = rows[0] as Record<string, unknown>;
  const keys = Object.keys(first).filter(
    (key) =>
      typeof first[key] === "string" ||
      typeof first[key] === "number" ||
      typeof first[key] === "boolean" ||
      first[key] === null,
  );
  const escapeCsv = (val: unknown) => {
    if (val === null || val === undefined) return "";
    const str = String(val).replace(/"/g, '""');
    return /[",\n]/.test(str) ? `"${str}"` : str;
  };
  const lines = [
    keys.join(","),
    ...rows.map((row) =>
      keys.map((key) => escapeCsv((row as Record<string, unknown>)[key])).join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function RecordTable<Row extends { id: string }>({
  columns,
  rows,
  onRowClick,
  empty,
  emptyIcon: EmptyIcon,
  emptyAction,
  filtered = false,
  loading = false,
  testId,
  rowClassName,
  rowAction,
}: {
  columns: Column<Row>[];
  rows: Row[];
  onRowClick?: (row: Row) => void;
  empty: string;
  emptyIcon?: LucideIcon;
  /** What starts the book, such as the section's create button. */
  emptyAction?: ReactNode;
  /** A search or filter is narrowing the rows, so an empty list is not an empty book. */
  filtered?: boolean;
  loading?: boolean;
  testId?: string;
  rowClassName?: (row: Row) => string | undefined;
  /** A quick control at the end of each row, shown while the row is hovered or focused. */
  rowAction?: (row: Row) => ReactNode;
}) {
  const { t } = useLingui();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [sortState, setSortState] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [compact, setCompact] = useState(false);

  const sortedRows = useMemo(() => {
    if (!sortState) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const va = extractComparableValue(a, sortState.key);
      const vb = extractComparableValue(b, sortState.key);
      if (typeof va === "number" && typeof vb === "number") {
        return sortState.dir === "asc" ? va - vb : vb - va;
      }
      const cmp = String(va).localeCompare(String(vb), undefined, { numeric: true });
      return sortState.dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortState]);

  if (rows.length === 0 && !loading) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card/50 px-6 py-14 text-center text-sm text-muted-foreground">
        {EmptyIcon ? (
          <span className="grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground">
            <EmptyIcon className="size-5" strokeWidth={1.75} aria-hidden="true" />
          </span>
        ) : null}
        <p>{filtered ? t`No results` : empty}</p>
        {filtered ? null : emptyAction}
      </div>
    );
  }

  const allSelected = sortedRows.length > 0 && sortedRows.every((row) => selectedIds.has(row.id));
  const selectedRows = sortedRows.filter((row) => selectedIds.has(row.id));
  const columnCount = columns.length + 1 + (rowAction ? 1 : 0);

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedRows.map((row) => row.id)));
    }
  }

  function toggleOne(id: string) {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSort(key: string) {
    setSortState((previous) => {
      if (!previous || previous.key !== key) return { key, dir: "asc" };
      if (previous.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-2xs">
      {selectedRows.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-accent/60 px-4 py-2 text-xs">
          <span className="font-medium">
            <Trans>{selectedRows.length} selected</Trans>
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => exportRowsToCsv(selectedRows, `${testId ?? "records"}-selected.csv`)}
              className="inline-flex h-6 items-center gap-1 rounded-md border bg-background px-2 font-medium text-foreground transition-colors hover:bg-accent"
            >
              <Download className="size-3" />
              <Trans>Export Selected CSV</Trans>
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="inline-flex h-6 items-center rounded-md px-2 text-muted-foreground hover:text-foreground"
            >
              <Trans>Clear</Trans>
            </button>
          </div>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm" data-testid={testId}>
          <thead>
            <tr className="border-b bg-muted/40">
              <th scope="col" className="w-9 ps-3.5 pe-1 text-start">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label={t`Select all rows`}
                  className="size-3.5 rounded border-input accent-primary"
                />
              </th>
              {columns.map((column) => {
                const isSorted = sortState?.key === column.key;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={cn(
                      "h-9 px-3 text-start text-xs font-medium whitespace-nowrap text-muted-foreground last:pe-4",
                      cellClass(column),
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(column.key)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded py-0.5 transition-colors hover:text-foreground",
                        column.align === "end" && "ms-auto",
                      )}
                    >
                      <span>{column.header}</span>
                      {isSorted ? (
                        sortState.dir === "asc" ? (
                          <ArrowUp className="size-3 text-foreground" />
                        ) : (
                          <ArrowDown className="size-3 text-foreground" />
                        )
                      ) : (
                        <ArrowUpDown className="size-3 opacity-35" />
                      )}
                    </button>
                  </th>
                );
              })}
              {rowAction ? <th scope="col" className="w-0 pe-2" /> : null}
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0
              ? [0, 1, 2].map((placeholder) => (
                  <tr key={placeholder} className="border-b last:border-b-0">
                    {Array.from({ length: columnCount }, (_, index) => (
                      <td
                        key={columns[index - 1]?.key ?? `col-${index}`}
                        className={cn(
                          "h-13 px-3 first:ps-3.5 last:pe-4",
                          columns[index - 1] && cellClass(columns[index - 1]!),
                        )}
                      >
                        {index > 0 && columns[index - 1] ? (
                          <Skeleton className="h-3.5 w-full max-w-28" />
                        ) : null}
                      </td>
                    ))}
                  </tr>
                ))
              : sortedRows.map((row) => {
                  const selected = selectedIds.has(row.id);
                  return (
                    <tr
                      key={row.id}
                      data-testid={testId ? `${testId}-row` : undefined}
                      className={cn(
                        "group/row border-b transition-colors last:border-b-0",
                        selected && "bg-accent/35",
                        onRowClick &&
                          "cursor-pointer hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                        rowClassName?.(row),
                      )}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      onKeyDown={
                        onRowClick
                          ? (event) => {
                              if (event.target !== event.currentTarget) return;
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                onRowClick(row);
                              }
                            }
                          : undefined
                      }
                      tabIndex={onRowClick ? 0 : undefined}
                    >
                      <td
                        className={cn("w-9 ps-3.5 pe-1 align-middle", compact ? "py-1.5" : "py-2")}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleOne(row.id)}
                          onClick={(event) => event.stopPropagation()}
                          aria-label={t`Select row`}
                          className="size-3.5 rounded border-input accent-primary"
                        />
                      </td>
                      {columns.map((column) => (
                        <td
                          key={column.key}
                          className={cn(
                            "px-3 align-middle last:pe-4",
                            compact ? "h-10 py-1.5" : "h-13 py-2",
                            cellClass(column),
                          )}
                        >
                          {column.render(row)}
                        </td>
                      ))}
                      {rowAction ? (
                        <td className="w-0 py-2 pe-2 text-end align-middle">
                          <div className="opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(hover:none)]:opacity-100">
                            {rowAction(row)}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>
      {sortedRows.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/25 px-4 py-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="tabular-nums">
              <Trans>Total: {sortedRows.length} records</Trans>
            </span>
            {sortState ? (
              <button
                type="button"
                onClick={() => setSortState(null)}
                className="rounded bg-accent px-1.5 py-0.5 text-[11px] text-foreground hover:bg-accent/80"
              >
                <Trans>Sorted by {sortState.key}</Trans> ({sortState.dir}) ×
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCompact(!compact)}
              className="inline-flex h-6 items-center gap-1 rounded-md border bg-background px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Rows3 className="size-3" />
              {compact ? <Trans>Standard density</Trans> : <Trans>Compact density</Trans>}
            </button>
            <button
              type="button"
              onClick={() => exportRowsToCsv(sortedRows, `${testId ?? "records"}.csv`)}
              className="inline-flex h-6 items-center gap-1 rounded-md border bg-background px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Download className="size-3" />
              <Trans>Export CSV</Trans>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The record's name, with its ref and a line of context under it. The context
 * can give way once the table is wide enough to show it in a column of its own.
 */
export function PrimaryCell({
  refText,
  title,
  detail,
  detailWhile,
  avatar,
  icon: Icon,
}: {
  refText?: string;
  title: ReactNode;
  detail?: ReactNode;
  /** The column that repeats the detail; the detail shows only while it is hidden. */
  detailWhile?: ColumnWidth;
  /** Initials beside the name, for companies and people. */
  avatar?: { name: string; shape?: "circle" | "square" };
  icon?: LucideIcon;
}) {
  const hasDetail = detail !== null && detail !== undefined && detail !== "";
  return (
    <div className="flex min-w-0 max-w-md items-center gap-3">
      {avatar ? (
        <RecordAvatar name={avatar.name} shape={avatar.shape} />
      ) : Icon ? (
        <span
          aria-hidden="true"
          className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground"
        >
          <Icon className="size-3.5" strokeWidth={1.75} />
        </span>
      ) : null}
      <div className="min-w-0">
        <div className="truncate font-medium">{title}</div>
        {refText || hasDetail ? (
          <div className="flex min-w-0 items-baseline gap-1.5 text-xs text-muted-foreground">
            {refText ? <span className="shrink-0 font-mono">{refText}</span> : null}
            {hasDetail ? (
              <span
                className={cn(
                  "flex min-w-0 items-baseline gap-1.5",
                  detailWhile && WHILE_HIDDEN[detailWhile],
                )}
              >
                {refText ? <span aria-hidden="true">·</span> : null}
                <span className="truncate">{detail}</span>
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Search and the section's primary action on one row, filters under them: always in the same places. */
export function Toolbar({
  children,
  filters,
  action,
}: {
  children?: ReactNode;
  filters?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {children}
        {action ? <div className="ms-auto flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      {filters}
    </div>
  );
}

export function SearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useLingui();
  return (
    <div className="relative min-w-40 flex-1 sm:w-64 sm:flex-none">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t`Search`}
        aria-label={t`Search`}
        className="h-8 w-full rounded-lg border border-input bg-transparent ps-8 pe-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      />
    </div>
  );
}

export function FilterChips<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value | "";
  options: { value: Value | ""; label: string }[];
  onChange: (value: Value | "") => void;
}) {
  return (
    <fieldset
      aria-label={label}
      className="-mx-1 flex min-w-0 gap-1 overflow-x-auto px-1 scrollbar-none"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value || "all"}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-7 shrink-0 rounded-full px-3 text-[13px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </fieldset>
  );
}

export function KpiCard({
  label,
  value,
  icon: Icon,
  to,
  attention = false,
  detail,
  exact,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  /** Where the number comes from; the card opens that list. */
  to?: string;
  /** Something is waiting on a person, such as an approval or low stock. */
  attention?: boolean;
  /** A related figure under the value. */
  detail?: { label: string; value: string | number };
  /** The unrounded amount behind a short one, for its tooltip. */
  exact?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 pt-0.5 text-[12.5px] font-medium leading-snug text-muted-foreground">
          {label}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-lg border transition-colors",
            attention
              ? "border-warning/30 bg-warning/14 text-foreground dark:text-warning"
              : "border-border/60 bg-muted/60 text-muted-foreground group-hover/kpi:bg-accent group-hover/kpi:text-foreground",
          )}
        >
          <Icon className="size-3.5" strokeWidth={1.9} />
        </span>
      </div>
      <div
        title={exact}
        className="mt-1.5 truncate text-2xl font-semibold tracking-tight tabular-nums"
      >
        {value}
      </div>
      {detail ? (
        <div className="mt-2 flex min-w-0 items-center justify-between gap-1.5 border-t border-border/50 pt-1.5 text-xs text-muted-foreground">
          <span className="truncate">{detail.label}</span>
          <span className="font-semibold text-foreground/85 tabular-nums">{detail.value}</span>
        </div>
      ) : null}
    </>
  );
  const className = cn(
    "group/kpi relative block min-w-0 overflow-hidden rounded-xl border bg-card px-4 pt-3.5 pb-3 shadow-2xs",
    attention && "border-warning/40",
  );
  if (!to) return <div className={className}>{body}</div>;
  return (
    <Link
      to={to}
      className={cn(
        className,
        "transition-all outline-none hover:-translate-y-0.5 hover:border-foreground/25 hover:bg-accent/25 hover:shadow-sm focus-visible:ring-3 focus-visible:ring-ring/50",
      )}
    >
      {body}
    </Link>
  );
}

export function KpiGrid({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="grid grid-cols-2 gap-3 @3xl:grid-cols-4" data-testid={testId}>
      {children}
    </div>
  );
}

/** Label and value pairs for a record's details. */
export function DetailList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="mt-0.5 min-w-0 truncate">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Who changed a record and when, straight from the action log. */
export function HistoryList({
  recordType,
  recordId,
  revision,
}: {
  recordType: BusinessRecordType;
  recordId: string;
  revision?: number;
}) {
  const actionLabel = useHistoryActionLabel();
  const [entries, setEntries] = useState<BusinessHistoryEntry[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void rpc.business
      .history({ recordType, recordId, limit: 50 })
      .then((rows) => {
        if (active) setEntries(rows);
      })
      .catch((cause) => {
        if (active) setError(errorText(cause));
      });
    return () => {
      active = false;
    };
  }, [recordType, recordId, revision]);
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (entries.length === 0) return null;
  return (
    <section data-testid="business-history" className="border-t pt-4">
      <h3 className="text-xs font-medium text-muted-foreground">
        <Trans>History</Trans>
      </h3>
      <ol className="mt-3 space-y-3">
        {entries.map((entry, index) => (
          <li key={entry.id} className="relative flex gap-3">
            {index < entries.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute start-[8.5px] top-6 -bottom-3 w-px bg-border"
              />
            ) : null}
            <span className="relative mt-0.5">
              <ActorAvatar actor={entry.actor} />
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "text-sm font-medium",
                  entry.outcome === "failed" && "text-destructive",
                )}
              >
                {actionLabel(entry)}
                {entry.outcome === "failed" ? (
                  <span className="font-normal"> · {entry.errorCode ?? "failed"}</span>
                ) : null}
              </p>
              <p className="truncate text-xs text-muted-foreground">{actorName(entry.actor)}</p>
            </div>
            <time
              className="shrink-0 pt-0.5 text-xs text-muted-foreground"
              dateTime={entry.createdAt}
            >
              {formatRelativeTime(entry.createdAt)}
            </time>
          </li>
        ))}
      </ol>
    </section>
  );
}
