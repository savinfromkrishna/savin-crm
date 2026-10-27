import { Trans, useLingui } from "@lingui/react/macro";
import type { BusinessBlueprintId, BusinessEnvironment } from "@savingroup/contracts";
import { BUSINESS_BLUEPRINT_IDS } from "@savingroup/contracts";
import { Button, Input, NativeSelect, NativeSelectOption } from "@savingroup/ui-web";
import { Database } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { StatusTone } from "../../lib/business-labels";
import { formatRelativeTime } from "../../lib/relative-time";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";
import { FieldRow, FormDialog, FormField } from "./forms";
import { StatusBadge } from "./records";
import { SiteLink, siteHref, siteOf } from "./site";

const STATUS_TONES: Record<BusinessEnvironment["status"], StatusTone> = {
  provisioning: "warning",
  verifying: "warning",
  active: "success",
  failed: "destructive",
  disabled: "muted",
};

/**
 * Which system holds the organization's business records: the built-in tables,
 * or a connected ERPNext + Frappe CRM site. Owners connect, re-check and
 * disable it here; everyone else just sees where the data lives.
 */
export function EnvironmentCard({ onChanged }: { onChanged?: () => void }) {
  const { t } = useLingui();
  const [environment, setEnvironment] = useState<BusinessEnvironment | null | undefined>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    rpc.business.environment
      .get()
      .then((value) => {
        if (!active) return;
        setEnvironment(value);
        setError("");
      })
      .catch((cause) => {
        if (active) setError(errorText(cause));
      });
    return () => {
      active = false;
    };
  }, [revision]);

  const refresh = () => {
    setRevision((value) => value + 1);
    onChanged?.();
  };

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      refresh();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  if (environment === undefined) return null;
  const active = environment?.status === "active";
  return (
    <section
      className="flex gap-3 rounded-xl border bg-card p-4 text-sm"
      aria-label={t`Business system`}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
        <Database className="size-4" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="font-medium">
            <Trans>Business system</Trans>
          </h2>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
            {environment ? (
              <>
                <span className="truncate text-foreground/85">{environment.siteName}</span>
                <EnvironmentStatus environment={environment} />
                {environment.lastVerifiedAt ? (
                  <span>{t`Checked ${formatRelativeTime(environment.lastVerifiedAt)}`}</span>
                ) : null}
              </>
            ) : (
              <StatusBadge tone="neutral">
                <Trans>Built-in</Trans>
              </StatusBadge>
            )}
          </div>
          {environment && active ? (
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
              <SiteLink href={siteHref(siteOf(environment), "/desk")}>{t`Savingroup ERP`}</SiteLink>
              <SiteLink href={siteHref(siteOf(environment), "/crm")}>{t`Savingroup CRM`}</SiteLink>
            </div>
          ) : null}
          {environment?.lastError && !active ? (
            <p role="alert" className="pt-1 text-destructive">
              {environment.lastError}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="pt-1 text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {environment && environment.status !== "disabled" ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => run(() => rpc.business.environment.verify())}
              >
                <Trans>Check</Trans>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => run(() => rpc.business.environment.disable())}
              >
                <Trans>Disable</Trans>
              </Button>
            </>
          ) : (
            <Button type="button" size="sm" disabled={busy} onClick={() => setConnecting(true)}>
              <Trans>Connect Savingroup ERP</Trans>
            </Button>
          )}
        </div>
      </div>
      {connecting ? (
        <ConnectDialog
          defaults={environment}
          onClose={() => setConnecting(false)}
          onConnected={() => {
            setConnecting(false);
            refresh();
          }}
        />
      ) : null}
    </section>
  );
}

function EnvironmentStatus({ environment }: { environment: BusinessEnvironment }) {
  const { t } = useLingui();
  const labels: Record<BusinessEnvironment["status"], string> = {
    provisioning: t`Provisioning`,
    verifying: t`Checking`,
    active: t`Active`,
    failed: t`Failed`,
    disabled: t`Disabled`,
  };
  return (
    <StatusBadge tone={STATUS_TONES[environment.status]}>{labels[environment.status]}</StatusBadge>
  );
}

function ConnectDialog({
  defaults,
  onClose,
  onConnected,
}: {
  defaults: BusinessEnvironment | null;
  onClose: () => void;
  onConnected: () => void;
}) {
  const { t } = useLingui();
  const formId = useId();
  const [siteUrl, setSiteUrl] = useState(defaults?.siteUrl ?? "http://localhost:8090");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [blueprintId, setBlueprintId] = useState<BusinessBlueprintId>(
    defaults?.blueprintId ?? "india-smb",
  );
  const [companyName, setCompanyName] = useState(defaults?.companyName ?? "");
  const [companyAbbr, setCompanyAbbr] = useState(defaults?.companyAbbr ?? "");
  const [country, setCountry] = useState(defaults?.country ?? "India");
  const [currency, setCurrency] = useState(defaults?.currency ?? "INR");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function connect() {
    setBusy(true);
    setError("");
    try {
      const result = await rpc.business.environment.connect({
        siteUrl,
        apiKey,
        apiSecret,
        webhookSecret,
        blueprintId,
        companyName,
        companyAbbr,
        country,
        currency,
      });
      if (result.status !== "active") {
        setError(result.lastError ?? t`The site could not be verified.`);
        return;
      }
      onConnected();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  const ready =
    siteUrl.trim().length > 0 &&
    apiKey.trim().length >= 8 &&
    apiSecret.trim().length >= 8 &&
    webhookSecret.trim().length >= 8 &&
    companyName.trim().length > 0 &&
    companyAbbr.trim().length > 0 &&
    currency.trim().length === 3;

  return (
    <FormDialog
      title={t`Connect Savingroup ERP`}
      onClose={onClose}
      onSubmit={connect}
      busy={busy}
      submitLabel={t`Connect`}
      disabled={!ready}
      error={error}
    >
      <FormField id={`${formId}-url`} label={t`Site URL`} required>
        <Input
          id={`${formId}-url`}
          value={siteUrl}
          onChange={(event) => setSiteUrl(event.target.value)}
          required
        />
      </FormField>
      <FieldRow>
        <FormField id={`${formId}-key`} label={t`Gateway API key`} required>
          <Input
            id={`${formId}-key`}
            value={apiKey}
            autoComplete="off"
            onChange={(event) => setApiKey(event.target.value)}
            required
          />
        </FormField>
        <FormField id={`${formId}-secret`} label={t`Gateway API secret`} required>
          <Input
            id={`${formId}-secret`}
            type="password"
            value={apiSecret}
            autoComplete="off"
            onChange={(event) => setApiSecret(event.target.value)}
            required
          />
        </FormField>
      </FieldRow>
      <FormField id={`${formId}-webhook`} label={t`Event signing secret`} required>
        <Input
          id={`${formId}-webhook`}
          type="password"
          value={webhookSecret}
          autoComplete="off"
          onChange={(event) => setWebhookSecret(event.target.value)}
          required
        />
      </FormField>
      <div className="space-y-4 border-t pt-4">
        <FieldRow>
          <FormField id={`${formId}-company`} label={t`Company`} required>
            <Input
              id={`${formId}-company`}
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
              required
            />
          </FormField>
          <FormField id={`${formId}-abbr`} label={t`Company abbreviation`} required>
            <Input
              id={`${formId}-abbr`}
              value={companyAbbr}
              maxLength={10}
              onChange={(event) => setCompanyAbbr(event.target.value)}
              required
            />
          </FormField>
        </FieldRow>
        <FieldRow>
          <FormField id={`${formId}-country`} label={t`Country`} required>
            <Input
              id={`${formId}-country`}
              value={country}
              onChange={(event) => setCountry(event.target.value)}
              required
            />
          </FormField>
          <FormField id={`${formId}-currency`} label={t`Currency`} required>
            <Input
              id={`${formId}-currency`}
              value={currency}
              maxLength={3}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              required
            />
          </FormField>
        </FieldRow>
        <FormField id={`${formId}-blueprint`} label={t`Blueprint`}>
          <NativeSelect
            className="w-full"
            id={`${formId}-blueprint`}
            value={blueprintId}
            onChange={(event) => setBlueprintId(event.target.value as BusinessBlueprintId)}
          >
            {BUSINESS_BLUEPRINT_IDS.map((id) => (
              <NativeSelectOption key={id} value={id}>
                {id}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
      </div>
    </FormDialog>
  );
}
