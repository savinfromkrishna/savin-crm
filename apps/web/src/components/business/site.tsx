import { useLingui } from "@lingui/react/macro";
import type { BusinessEnvironment } from "@savingroup/contracts";
import { cn } from "@savingroup/ui-web";
import { ExternalLink } from "lucide-react";
import { createContext, useContext, useEffect, useState } from "react";
import { rpc } from "../../lib/rpc";

/** The connected ERPNext + Frappe CRM site, while its connection is active. */
export type BusinessSite = { url: string; name: string };

export const BusinessSiteContext = createContext<BusinessSite | null>(null);

export function siteOf(
  environment: Pick<BusinessEnvironment, "siteUrl" | "siteName">,
): BusinessSite {
  return { url: environment.siteUrl.replace(/\/+$/, ""), name: environment.siteName };
}

export function useBusinessSite(): BusinessSite | null {
  return useContext(BusinessSiteContext);
}

/** The organization's site for this page; null on the built-in tables or a broken connection. */
export function useConnectedSite(): BusinessSite | null {
  const [site, setSite] = useState<BusinessSite | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.resolve()
      .then(() => rpc.business.environment.get())
      .then((environment) => {
        if (!active) return;
        setSite(environment?.status === "active" ? siteOf(environment) : null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return site;
}

export type SiteRecordKind =
  | "company"
  | "contact"
  | "lead"
  | "deal"
  | "product"
  | "order"
  | "invoice";

/** Where each record lives on the site: Frappe CRM for the pipeline, the ERPNext desk for the rest. */
const RECORD_PATHS: Record<SiteRecordKind, string> = {
  company: "/crm/organizations/",
  contact: "/crm/contacts/",
  lead: "/crm/leads/",
  deal: "/crm/deals/",
  product: "/desk/item/",
  order: "/desk/sales-order/",
  invoice: "/desk/sales-invoice/",
};

/** A page on the site, through its sign-in, which sends a signed-in person straight on. */
export function siteHref(site: BusinessSite, path: string): string {
  return `${site.url}/login?redirect-to=${encodeURIComponent(path)}`;
}

/** The same record in ERPNext or Frappe CRM. Nothing without an active site. */
export function SiteRecordLink({ kind, id }: { kind: SiteRecordKind; id: string }) {
  const { t } = useLingui();
  const site = useBusinessSite();
  if (!site) return null;
  const path = RECORD_PATHS[kind];
  return (
    <SiteLink href={siteHref(site, `${path}${encodeURIComponent(id)}`)}>
      {path.startsWith("/crm/") ? t`Open in Savingroup CRM` : t`Open in Savingroup ERP`}
    </SiteLink>
  );
}

export function SiteLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "inline-flex items-center gap-1 rounded text-foreground/85 underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      {children}
      <ExternalLink className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
    </a>
  );
}
