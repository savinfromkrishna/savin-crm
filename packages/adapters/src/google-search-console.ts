import { z } from "zod";
import {
  definedFields,
  type GoogleServiceDefinition,
  googleOperation,
  googleScope,
} from "./google-tools.js";

const WEBMASTERS = "https://www.googleapis.com/webmasters/v3";
const INSPECTION = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";
const MAX_ROWS_RETURNED = 100;

function sitePath(siteUrl: string): string {
  return `${WEBMASTERS}/sites/${encodeURIComponent(siteUrl)}`;
}

const SiteUrl = z
  .string()
  .min(1)
  .max(2_048)
  .describe("Property, such as https://example.com/ or sc-domain:example.com");
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const read = {
  id: "read",
  label: "See search traffic and indexing",
  scopes: [googleScope("webmasters.readonly")],
  coveredBy: [googleScope("webmasters")],
};
const write = { id: "write", label: "Submit sitemaps", scopes: [googleScope("webmasters")] };

export const searchConsoleService: GoogleServiceDefinition = {
  slug: "google_search_console",
  name: "Google Search Console",
  description: "Check search performance and indexing",
  permissions: [read, write],
  defaultPermissions: ["read"],
  operations: [
    googleOperation({
      name: "google_search_console_list_sites",
      description: "List Search Console properties this account can access.",
      requires: ["read"],
      readOnly: true,
      input: z.object({}),
      async run(_input, { api }) {
        const listed = await api.json<{
          siteEntry?: Array<{ siteUrl?: string; permissionLevel?: string }>;
        }>({ url: `${WEBMASTERS}/sites` });
        return {
          sites: (listed.siteEntry ?? []).map((site) => ({
            site_url: site.siteUrl,
            permission: site.permissionLevel,
          })),
        };
      },
    }),
    googleOperation({
      name: "google_search_console_get_search_analytics",
      description:
        "Clicks, impressions, CTR, and position from Google Search, grouped by dimensions such as query, page, country, device, or date.",
      requires: ["read"],
      readOnly: true,
      input: z.object({
        site_url: SiteUrl,
        start_date: Day,
        end_date: Day,
        dimensions: z
          .array(z.enum(["query", "page", "country", "device", "date", "searchAppearance"]))
          .max(4)
          .default(["query"]),
        search_type: z
          .enum(["web", "image", "video", "news", "discover", "googleNews"])
          .default("web"),
        page_contains: z.string().max(2_048).optional(),
        query_contains: z.string().max(500).optional(),
        row_limit: z.number().int().min(1).max(MAX_ROWS_RETURNED).default(25),
        start_row: z.number().int().min(0).default(0),
      }),
      async run(input, { api }) {
        const filters = [
          ...(input.page_contains
            ? [{ dimension: "page", operator: "contains", expression: input.page_contains }]
            : []),
          ...(input.query_contains
            ? [{ dimension: "query", operator: "contains", expression: input.query_contains }]
            : []),
        ];
        const result = await api.json<{
          rows?: Array<{
            keys?: string[];
            clicks?: number;
            impressions?: number;
            ctr?: number;
            position?: number;
          }>;
        }>({
          method: "POST",
          url: `${sitePath(input.site_url)}/searchAnalytics/query`,
          json: definedFields({
            startDate: input.start_date,
            endDate: input.end_date,
            dimensions: input.dimensions,
            type: input.search_type,
            rowLimit: input.row_limit,
            startRow: input.start_row,
            dimensionFilterGroups: filters.length ? [{ filters }] : undefined,
          }),
          idempotent: true,
        });
        return {
          dimensions: input.dimensions,
          rows: (result.rows ?? []).map((row) => ({
            keys: row.keys ?? [],
            clicks: row.clicks ?? 0,
            impressions: row.impressions ?? 0,
            ctr: Number((row.ctr ?? 0).toFixed(4)),
            position: Number((row.position ?? 0).toFixed(1)),
          })),
        };
      },
    }),
    googleOperation({
      name: "google_search_console_get_url_inspection",
      description:
        "Google's index status for one URL in a property: coverage, last crawl, and canonical.",
      requires: ["read"],
      readOnly: true,
      input: z.object({ site_url: SiteUrl, url: z.url().max(2_048) }),
      async run(input, { api }) {
        const result = await api.json<{
          inspectionResult?: {
            inspectionResultLink?: string;
            indexStatusResult?: Record<string, unknown>;
          };
        }>({
          method: "POST",
          url: INSPECTION,
          json: { inspectionUrl: input.url, siteUrl: input.site_url },
          idempotent: true,
        });
        const status = result.inspectionResult?.indexStatusResult ?? {};
        return definedFields({
          verdict: status.verdict,
          coverage: status.coverageState,
          indexing: status.indexingState,
          robots_txt: status.robotsTxtState,
          page_fetch: status.pageFetchState,
          last_crawl: status.lastCrawlTime,
          google_canonical: status.googleCanonical,
          user_canonical: status.userCanonical,
          link: result.inspectionResult?.inspectionResultLink,
        });
      },
    }),
    googleOperation({
      name: "google_search_console_list_sitemaps",
      description: "List sitemaps submitted for a property, with errors and warnings.",
      requires: ["read"],
      readOnly: true,
      input: z.object({ site_url: SiteUrl }),
      async run(input, { api }) {
        const listed = await api.json<{
          sitemap?: Array<{
            path?: string;
            lastSubmitted?: string;
            lastDownloaded?: string;
            isPending?: boolean;
            errors?: string;
            warnings?: string;
          }>;
        }>({ url: `${sitePath(input.site_url)}/sitemaps` });
        return {
          sitemaps: (listed.sitemap ?? []).map((sitemap) =>
            definedFields({
              path: sitemap.path,
              submitted: sitemap.lastSubmitted,
              downloaded: sitemap.lastDownloaded,
              pending: sitemap.isPending,
              errors: sitemap.errors ? Number(sitemap.errors) : undefined,
              warnings: sitemap.warnings ? Number(sitemap.warnings) : undefined,
            }),
          ),
        };
      },
    }),
    googleOperation({
      name: "google_search_console_submit_sitemap",
      description: "Submit a sitemap URL for a property.",
      requires: ["write"],
      readOnly: false,
      input: z.object({ site_url: SiteUrl, sitemap_url: z.url().max(2_048) }),
      async run(input, { api }) {
        await api.request({
          method: "PUT",
          url: `${sitePath(input.site_url)}/sitemaps/${encodeURIComponent(input.sitemap_url)}`,
          responseType: "none",
        });
        return { submitted: input.sitemap_url };
      },
    }),
  ],
};
