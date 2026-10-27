import { z } from "zod";
import {
  definedFields,
  type GoogleServiceDefinition,
  googleOperation,
  googleScope,
} from "./google-tools.js";

const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
/** Cell data returned to the model stays inside the tool result budget. */
const MAX_VALUE_CHARS = 8_000;
const MAX_WRITE_CELLS = 50_000;

const Cell = z.union([z.string().max(50_000), z.number(), z.boolean(), z.null()]);
const Rows = z
  .array(z.array(Cell).max(1_000))
  .min(1)
  .max(10_000)
  .refine((rows) => rows.reduce((total, row) => total + row.length, 0) <= MAX_WRITE_CELLS, {
    message: `Write at most ${MAX_WRITE_CELLS} cells at a time`,
  })
  .describe("Rows of cell values, first row first");
const ValueInput = z
  .enum(["USER_ENTERED", "RAW"])
  .default("USER_ENTERED")
  .describe("USER_ENTERED parses formulas, numbers, and dates like typing into Sheets");

function spreadsheetPath(id: string): string {
  return `${SHEETS}/${encodeURIComponent(id)}`;
}

function rangePath(id: string, range: string): string {
  return `${spreadsheetPath(id)}/values/${encodeURIComponent(range)}`;
}

/** Keeps whole rows until the character budget is spent. */
function clipRows(values: unknown[][]): { values: unknown[][]; truncated: boolean } {
  let used = 2;
  const kept: unknown[][] = [];
  for (const row of values) {
    const size = JSON.stringify(row).length + 1;
    if (used + size > MAX_VALUE_CHARS) return { values: kept, truncated: true };
    used += size;
    kept.push(row);
  }
  return { values: kept, truncated: false };
}

type UpdateResult = {
  updatedRange?: string;
  updatedRows?: number;
  updatedColumns?: number;
  updatedCells?: number;
};

function updated(result: UpdateResult | undefined) {
  return definedFields({
    updated_range: result?.updatedRange,
    updated_rows: result?.updatedRows,
    updated_cells: result?.updatedCells,
  });
}

const read = {
  id: "read",
  label: "See spreadsheets",
  scopes: [googleScope("spreadsheets.readonly")],
  coveredBy: [googleScope("spreadsheets"), googleScope("drive.readonly"), googleScope("drive")],
};
const write = {
  id: "write",
  label: "Create and edit spreadsheets",
  scopes: [googleScope("spreadsheets")],
  coveredBy: [googleScope("drive")],
};

export const sheetsService: GoogleServiceDefinition = {
  slug: "google_sheets",
  name: "Google Sheets",
  description: "Read and update spreadsheets",
  permissions: [read, write],
  defaultPermissions: ["read"],
  operations: [
    googleOperation({
      name: "google_sheets_get_spreadsheet",
      description: "Get a spreadsheet's title and its sheets with their sizes.",
      requires: ["read"],
      readOnly: true,
      input: z.object({ spreadsheet_id: z.string().min(1).max(200) }),
      async run(input, { api }) {
        const sheet = await api.json<{
          spreadsheetId?: string;
          spreadsheetUrl?: string;
          properties?: { title?: string; timeZone?: string };
          sheets?: Array<{
            properties?: {
              sheetId?: number;
              title?: string;
              gridProperties?: { rowCount?: number; columnCount?: number };
            };
          }>;
        }>({
          url: spreadsheetPath(input.spreadsheet_id),
          query: {
            fields:
              "spreadsheetId,spreadsheetUrl,properties(title,timeZone),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))",
          },
        });
        return {
          id: sheet.spreadsheetId,
          title: sheet.properties?.title,
          url: sheet.spreadsheetUrl,
          time_zone: sheet.properties?.timeZone,
          sheets: (sheet.sheets ?? []).map((item) => ({
            sheet_id: item.properties?.sheetId,
            title: item.properties?.title,
            rows: item.properties?.gridProperties?.rowCount,
            columns: item.properties?.gridProperties?.columnCount,
          })),
        };
      },
    }),
    googleOperation({
      name: "google_sheets_read_range",
      description:
        "Read cell values in A1 notation, such as Sheet1!A1:D50. Large ranges return the first rows; read the rest with a narrower range.",
      requires: ["read"],
      readOnly: true,
      input: z.object({
        spreadsheet_id: z.string().min(1).max(200),
        range: z.string().min(1).max(500),
        render: z
          .enum(["FORMATTED_VALUE", "UNFORMATTED_VALUE", "FORMULA"])
          .default("FORMATTED_VALUE"),
      }),
      async run(input, { api }) {
        const result = await api.json<{ range?: string; values?: unknown[][] }>({
          url: rangePath(input.spreadsheet_id, input.range),
          query: { valueRenderOption: input.render, majorDimension: "ROWS" },
        });
        const values = result.values ?? [];
        const clipped = clipRows(values);
        return {
          range: result.range,
          values: clipped.values,
          total_rows: values.length,
          ...(clipped.truncated ? { truncated: true, rows_returned: clipped.values.length } : {}),
        };
      },
    }),
    googleOperation({
      name: "google_sheets_write_range",
      description: "Overwrite cells starting at an A1 range with rows of values.",
      requires: ["write"],
      readOnly: false,
      input: z.object({
        spreadsheet_id: z.string().min(1).max(200),
        range: z.string().min(1).max(500),
        values: Rows,
        value_input: ValueInput,
      }),
      async run(input, { api }) {
        return updated(
          await api.json<UpdateResult>({
            method: "PUT",
            url: rangePath(input.spreadsheet_id, input.range),
            query: { valueInputOption: input.value_input },
            json: { range: input.range, majorDimension: "ROWS", values: input.values },
          }),
        );
      },
    }),
    googleOperation({
      name: "google_sheets_append_rows",
      description: "Add rows after the last row of a table, such as range Sheet1!A:A.",
      requires: ["write"],
      readOnly: false,
      input: z.object({
        spreadsheet_id: z.string().min(1).max(200),
        range: z.string().min(1).max(500),
        values: Rows,
        value_input: ValueInput,
      }),
      async run(input, { api }) {
        const result = await api.json<{ updates?: UpdateResult }>({
          method: "POST",
          url: `${rangePath(input.spreadsheet_id, input.range)}:append`,
          query: { valueInputOption: input.value_input, insertDataOption: "INSERT_ROWS" },
          json: { majorDimension: "ROWS", values: input.values },
        });
        return updated(result.updates);
      },
    }),
    googleOperation({
      name: "google_sheets_clear_range",
      description: "Clear the values in an A1 range, keeping formatting.",
      requires: ["write"],
      readOnly: false,
      input: z.object({
        spreadsheet_id: z.string().min(1).max(200),
        range: z.string().min(1).max(500),
      }),
      async run(input, { api }) {
        const result = await api.json<{ clearedRange?: string }>({
          method: "POST",
          url: `${rangePath(input.spreadsheet_id, input.range)}:clear`,
          json: {},
          idempotent: true,
        });
        return { cleared_range: result.clearedRange };
      },
    }),
    googleOperation({
      name: "google_sheets_create_spreadsheet",
      description: "Create a spreadsheet, optionally with named sheets and header rows.",
      requires: ["write"],
      readOnly: false,
      input: z.object({
        title: z.string().trim().min(1).max(500),
        sheet_titles: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
        rows: Rows.optional().describe("Initial rows for the first sheet"),
      }),
      async run(input, { api }) {
        const created = await api.json<{
          spreadsheetId?: string;
          spreadsheetUrl?: string;
          sheets?: Array<{ properties?: { title?: string } }>;
        }>({
          method: "POST",
          url: SHEETS,
          json: definedFields({
            properties: { title: input.title },
            sheets: input.sheet_titles?.map((title) => ({ properties: { title } })),
          }),
        });
        if (input.rows && created.spreadsheetId) {
          const first = created.sheets?.[0]?.properties?.title ?? "Sheet1";
          await api.json({
            method: "PUT",
            url: rangePath(created.spreadsheetId, `'${first.replace(/'/g, "''")}'!A1`),
            query: { valueInputOption: "USER_ENTERED" },
            json: { majorDimension: "ROWS", values: input.rows },
          });
        }
        return { id: created.spreadsheetId, url: created.spreadsheetUrl };
      },
    }),
    googleOperation({
      name: "google_sheets_batch_update",
      description:
        "Apply Sheets API batchUpdate requests for structure and formatting, such as addSheet, deleteSheet, repeatCell, or autoResizeDimensions.",
      requires: ["write"],
      readOnly: false,
      input: z.object({
        spreadsheet_id: z.string().min(1).max(200),
        requests: z
          .array(z.record(z.string(), z.unknown()))
          .min(1)
          .max(100)
          .describe("Sheets API Request objects"),
      }),
      async run(input, { api }) {
        const result = await api.json<{ replies?: unknown[] }>({
          method: "POST",
          url: `${spreadsheetPath(input.spreadsheet_id)}:batchUpdate`,
          json: { requests: input.requests },
        });
        return { replies: (result.replies ?? []).length };
      },
    }),
  ],
};
