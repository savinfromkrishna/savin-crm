import type { BusinessRecordType } from "@savingroup/contracts";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Label,
  Switch,
} from "@savingroup/ui-web";
import type { ReactNode } from "react";
import { useRef } from "react";
import type { AssistantRecord } from "./assistant";
import { AskAssistantButton, useAssistant } from "./assistant";
import { HistoryList } from "./records";
import type { SiteRecordKind } from "./site";
import { SiteRecordLink, useBusinessSite } from "./site";

const DIALOG_SIZES = {
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
} as const;

/**
 * Every create, edit and detail view in CRM OS and ERP OS. Fields scroll; the
 * error and the actions stay pinned to the bottom edge.
 */
export function FormDialog({
  title,
  meta,
  size = "md",
  onClose,
  onSubmit,
  busy,
  submitLabel,
  disabled,
  error,
  history,
  actions,
  ask,
  site,
  children,
}: {
  title: string;
  /** Status and context shown under the title. */
  meta?: ReactNode;
  size?: keyof typeof DIALOG_SIZES;
  onClose: () => void;
  onSubmit?: () => void | Promise<void>;
  busy: boolean;
  submitLabel: string;
  disabled?: boolean;
  error?: string;
  history?: { recordType: BusinessRecordType; recordId: string; revision?: number };
  /** Workflow actions for records that are not edited through a single submit. */
  actions?: ReactNode;
  /** The record, for asking the assistant about it. */
  ask?: AssistantRecord;
  /** The record's document on the connected site, linked while the connection is active. */
  site?: { kind: SiteRecordKind; id: string };
  children: ReactNode;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  const assistant = useAssistant();
  const askable = ask && assistant?.bot ? ask : null;
  const connectedSite = useBusinessSite();
  const siteRecord = site && connectedSite ? site : null;
  const footer = Boolean(onSubmit || actions || error || askable);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        ref={popupRef}
        // A record view opens on itself, not on its first control: that control
        // can be a select that saves on change or a workflow action.
        initialFocus={onSubmit ? undefined : popupRef}
        className={cn(
          "flex max-h-[min(90vh,56rem)] flex-col gap-0 overflow-hidden p-0",
          DIALOG_SIZES[size],
        )}
      >
        <DialogHeader className="gap-1.5 px-5 pt-5 pb-3 pe-12">
          <DialogTitle className="text-base leading-snug font-semibold">{title}</DialogTitle>
          {meta || siteRecord ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              {meta}
              {siteRecord ? <SiteRecordLink kind={siteRecord.kind} id={siteRecord.id} /> : null}
            </div>
          ) : null}
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (onSubmit) void onSubmit();
          }}
        >
          <div className="rk-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pt-1 pb-5">
            {children}
            {history ? (
              <HistoryList
                recordType={history.recordType}
                recordId={history.recordId}
                revision={history.revision}
              />
            ) : null}
          </div>
          {footer ? (
            <div className="space-y-3 border-t bg-muted/40 px-5 py-3">
              {error ? (
                <p
                  role="alert"
                  className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {error}
                </p>
              ) : null}
              {onSubmit || actions || askable ? (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {askable ? (
                    <AskAssistantButton record={askable} onAsk={onClose} className="me-auto" />
                  ) : null}
                  {actions}
                  {onSubmit ? (
                    <Button type="submit" disabled={busy || disabled}>
                      {submitLabel}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function FormField({
  id,
  label,
  required = false,
  className,
  children,
}: {
  id: string;
  label: string;
  /** Marks the label; the control itself carries `required`. */
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label htmlFor={id} className={cn("block min-w-0 space-y-1.5 text-sm", className)}>
      <span className="flex items-center gap-0.5 text-[13px] font-medium text-foreground/85">
        {label}
        {required ? (
          <span aria-hidden="true" className="text-muted-foreground">
            *
          </span>
        ) : null}
      </span>
      {children}
    </label>
  );
}

/** Two fields side by side from small screens up. */
export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

export function SwitchField({
  id,
  checked,
  onChange,
  label,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <Label htmlFor={id} className="text-sm font-normal text-foreground/85">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function parseMoneyInput(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : undefined;
}
