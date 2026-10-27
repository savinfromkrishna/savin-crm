import { z } from "zod";
import { type GoogleServiceDefinition, googleOperation, googleScope } from "./google-tools.js";

const REPORTS = "https://youtubeanalytics.googleapis.com/v2/reports";
const MAX_REPORT_ROWS = 200;

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const Name = z
  .string()
  .regex(/^[A-Za-z]+$/)
  .max(64);

export const youtubeAnalyticsService: GoogleServiceDefinition = {
  slug: "youtube_analytics",
  name: "YouTube Analytics",
  description: "Views, watch time, and audience growth",
  permissions: [
    {
      id: "read",
      label: "See channel analytics",
      scopes: [googleScope("yt-analytics.readonly")],
    },
  ],
  defaultPermissions: ["read"],
  operations: [
    googleOperation({
      name: "youtube_analytics_get_report",
      description:
        "Channel analytics for a date range. Metrics such as views, estimatedMinutesWatched, averageViewDuration, likes, subscribersGained; dimensions such as day, video, country, or insightTrafficSourceType.",
      requires: ["read"],
      readOnly: true,
      input: z.object({
        start_date: Day,
        end_date: Day,
        metrics: z
          .array(Name)
          .min(1)
          .max(10)
          .default([
            "views",
            "estimatedMinutesWatched",
            "averageViewDuration",
            "subscribersGained",
          ]),
        dimensions: z.array(Name).max(3).optional(),
        filters: z
          .string()
          .max(500)
          .optional()
          .describe("Report filter, such as video==VIDEO_ID or country==US"),
        sort: z
          .string()
          .max(200)
          .optional()
          .describe("Metric or dimension; prefix - for descending"),
        max_results: z.number().int().min(1).max(MAX_REPORT_ROWS).default(50),
      }),
      async run(input, { api }) {
        const report = await api.json<{
          columnHeaders?: Array<{ name?: string }>;
          rows?: unknown[][];
        }>({
          url: REPORTS,
          query: {
            ids: "channel==MINE",
            startDate: input.start_date,
            endDate: input.end_date,
            metrics: input.metrics.join(","),
            dimensions: input.dimensions?.join(","),
            filters: input.filters,
            sort: input.sort,
            maxResults: input.max_results,
          },
        });
        return {
          columns: (report.columnHeaders ?? []).map((header) => header.name),
          rows: (report.rows ?? []).slice(0, MAX_REPORT_ROWS),
        };
      },
    }),
  ],
};
