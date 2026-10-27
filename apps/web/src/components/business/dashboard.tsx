import { cn, Skeleton } from "@savingroup/ui-web";
import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useId } from "react";
import { Link } from "react-router-dom";

/*
 * Building blocks of the CRM and ERP overviews: titled panels, charts drawn
 * with the theme's ink and status colors, and rows that open a record.
 */

export function Panel({
  title,
  to,
  aside,
  className,
  testId,
  children,
}: {
  title: string;
  /** The list behind the panel; the title links there. */
  to?: string;
  /** A figure beside the title, such as the panel's total. */
  aside?: ReactNode;
  className?: string;
  testId?: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      data-testid={testId}
      className={cn("flex min-w-0 flex-col rounded-xl border bg-card", className)}
    >
      <div className="flex min-h-12 items-center justify-between gap-3 px-4">
        <h2 id={headingId} className="min-w-0 text-sm font-medium">
          {to ? (
            <Link
              to={to}
              className="group/title inline-flex max-w-full items-center gap-1 rounded outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="truncate">{title}</span>
              <ChevronRight
                className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover/title:translate-x-0.5 rtl:rotate-180"
                aria-hidden="true"
              />
            </Link>
          ) : (
            <span className="block truncate">{title}</span>
          )}
        </h2>
        {aside !== undefined ? (
          <div className="shrink-0 text-sm font-medium tabular-nums">{aside}</div>
        ) : null}
      </div>
      <div className="@container flex min-w-0 flex-1 flex-col px-4 pb-4">{children}</div>
    </section>
  );
}

/** Two panels side by side once the page is wide enough. */
export function PanelGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 @3xl:grid-cols-2">{children}</div>;
}

/** Rows of a panel list while its records load. */
export function ListSkeleton() {
  return (
    <div className="space-y-3 py-1">
      {[0, 1, 2].map((placeholder) => (
        <div key={placeholder} className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PanelEmpty({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex min-h-32 flex-1 flex-col items-center justify-center gap-2 py-6 text-center text-sm text-muted-foreground">
      <span className="grid size-9 place-items-center rounded-xl bg-muted">
        <Icon className="size-4" strokeWidth={1.75} aria-hidden="true" />
      </span>
      {children}
    </div>
  );
}

export type ColumnPoint = { key: string; label: string; value: number; display: string };

/** Amounts over consecutive periods, newest last; the tallest column is the largest. */
export function ColumnChart({ points, label }: { points: ColumnPoint[]; label: string }) {
  const max = Math.max(0, ...points.map((point) => point.value));
  return (
    <ol aria-label={label} className="flex min-h-48 flex-1 items-stretch gap-2 pt-1 @md:gap-4">
      {points.map((point, index) => {
        const share = max > 0 ? point.value / max : 0;
        const current = index === points.length - 1;
        // The bar shares its column with the value above it.
        const height = `calc((100% - 1.25rem) * ${share})`;
        return (
          <li key={point.key} className="flex min-w-0 flex-1 flex-col items-center gap-2">
            <span className="sr-only">{`${point.label}: ${point.display}`}</span>
            <div aria-hidden="true" className="relative w-full flex-1">
              {point.value > 0 ? (
                <span
                  className="absolute inset-x-0 text-center text-[11px] font-medium whitespace-nowrap text-muted-foreground tabular-nums"
                  style={{ bottom: `calc(${height} + 0.25rem)` }}
                >
                  {point.display}
                </span>
              ) : null}
              <div
                className={cn(
                  "absolute inset-x-0 bottom-0 mx-auto max-w-10 rounded-md",
                  point.value <= 0
                    ? "h-0.75 bg-foreground/10"
                    : current
                      ? "bg-foreground/80"
                      : "bg-foreground/30",
                )}
                style={point.value > 0 ? { height: `max(0.25rem, ${height})` } : undefined}
              />
            </div>
            <span
              aria-hidden="true"
              className={cn(
                "text-xs whitespace-nowrap",
                current ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {point.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export type BarRow = {
  key: string;
  label: ReactNode;
  value: number;
  display: ReactNode;
  /** A count or note after the label. */
  note?: ReactNode;
  /** Bar color; ink unless the row is an outcome. */
  fill?: string;
  to?: string;
};

/** A ranked list with a bar under each row, scaled to the largest value. */
export function BarList({ rows, label }: { rows: BarRow[]; label: string }) {
  const max = Math.max(0, ...rows.map((row) => row.value));
  return (
    <ul aria-label={label} className="-mx-2">
      {rows.map((row) => {
        const width = max > 0 && row.value > 0 ? Math.max(2, (row.value / max) * 100) : 0;
        const body = (
          <>
            <span className="flex items-baseline gap-2 text-sm">
              <span className="min-w-0 truncate">{row.label}</span>
              {row.note !== undefined ? (
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {row.note}
                </span>
              ) : null}
              <span className="ms-auto shrink-0 font-medium tabular-nums">{row.display}</span>
            </span>
            <span
              aria-hidden="true"
              className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-foreground/8"
            >
              <span
                className={cn("block h-full rounded-full", row.fill ?? "bg-foreground/70")}
                style={{ width: `${width}%` }}
              />
            </span>
          </>
        );
        return (
          <li key={row.key}>
            {row.to ? (
              <Link
                to={row.to}
                className="block rounded-lg px-2 py-2 outline-none transition-colors hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {body}
              </Link>
            ) : (
              <div className="px-2 py-2">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export type Share = { key: string; label: string; count: number; fill: string; to?: string };

/** How a whole splits into parts: one segmented bar and a legend with the counts. */
export function Distribution({ parts, label }: { parts: Share[]; label: string }) {
  const total = parts.reduce((sum, part) => sum + part.count, 0);
  return (
    <div>
      <div
        aria-hidden="true"
        className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-foreground/8"
      >
        {total > 0
          ? parts
              .filter((part) => part.count > 0)
              .map((part) => (
                <span
                  key={part.key}
                  className={cn("h-full", part.fill)}
                  style={{ width: `${(part.count / total) * 100}%` }}
                />
              ))
          : null}
      </div>
      <ul aria-label={label} className="-mx-2 mt-3 grid grid-cols-1 gap-x-2 @sm:grid-cols-2">
        {parts.map((part) => {
          const body = (
            <>
              <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", part.fill)} />
              <span className="min-w-0 truncate text-muted-foreground">{part.label}</span>
              <span className="ms-auto font-medium tabular-nums">{part.count}</span>
            </>
          );
          const className = "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm";
          return (
            <li key={part.key}>
              {part.to ? (
                <Link
                  to={part.to}
                  className={cn(
                    className,
                    "outline-none transition-colors hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50",
                  )}
                >
                  {body}
                </Link>
              ) : (
                <div className={className}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function RecordList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul aria-label={label} className="-mx-2">
      {children}
    </ul>
  );
}

/** One record in an overview list: the whole row opens it, the action stays its own. */
export function RecordRow({
  to,
  icon: Icon,
  tone,
  title,
  meta,
  end,
  action,
}: {
  to: string;
  icon: LucideIcon;
  /** Tints the icon when the record waits on someone or is at risk. */
  tone?: "warning" | "destructive";
  title: ReactNode;
  meta?: ReactNode;
  end?: ReactNode;
  /** A control of its own, such as asking the assistant about the record. */
  action?: ReactNode;
}) {
  return (
    <li className="group/row relative flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent/50">
      <span
        aria-hidden="true"
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-lg",
          tone === "warning"
            ? "bg-warning/14 text-foreground dark:text-warning"
            : tone === "destructive"
              ? "bg-destructive/12 text-destructive"
              : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-4" strokeWidth={1.75} />
      </span>
      <Link
        to={to}
        className="min-w-0 flex-1 rounded-lg outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
      >
        <span className="block truncate text-sm font-medium">{title}</span>
        {meta ? (
          <span className="flex min-w-0 items-baseline gap-1.5 truncate text-xs text-muted-foreground">
            {meta}
          </span>
        ) : null}
      </Link>
      {end !== undefined ? (
        <span className="shrink-0 text-end text-sm font-medium tabular-nums">{end}</span>
      ) : null}
      {action ? (
        <span className="relative z-10 shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(hover:none)]:opacity-100">
          {action}
        </span>
      ) : null}
    </li>
  );
}

/** The last `count` calendar months, oldest first, each with the amounts that fell in it. */
export function monthlyTotals<T>(
  items: readonly T[],
  at: (item: T) => string | null,
  amount: (item: T) => number,
  count: number,
  now = new Date(),
): { start: Date; total: number }[] {
  const months = Array.from({ length: count }, (_, index) => ({
    start: new Date(now.getFullYear(), now.getMonth() - (count - 1 - index), 1),
    total: 0,
  }));
  for (const item of items) {
    const iso = at(item);
    const date = iso ? new Date(iso) : null;
    if (!date || Number.isNaN(date.getTime())) continue;
    const month = months.find(
      (entry) =>
        entry.start.getFullYear() === date.getFullYear() &&
        entry.start.getMonth() === date.getMonth(),
    );
    if (month) month.total += amount(item);
  }
  return months;
}
