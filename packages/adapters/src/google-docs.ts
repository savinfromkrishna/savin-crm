import { z } from "zod";
import {
  DEFAULT_TEXT_CHARS,
  type GoogleServiceDefinition,
  googleOperation,
  googleScope,
  MAX_TEXT_CHARS,
  pageText,
} from "./google-tools.js";

const DOCS = "https://docs.googleapis.com/v1/documents";

type TextRun = { textRun?: { content?: string } };
type StructuralElement = {
  paragraph?: {
    elements?: TextRun[];
    paragraphStyle?: { namedStyleType?: string };
    bullet?: unknown;
  };
  table?: { tableRows?: Array<{ tableCells?: Array<{ content?: StructuralElement[] }> }> };
  tableOfContents?: { content?: StructuralElement[] };
};

const HEADINGS: Record<string, string> = {
  TITLE: "# ",
  HEADING_1: "# ",
  HEADING_2: "## ",
  HEADING_3: "### ",
  HEADING_4: "#### ",
  HEADING_5: "##### ",
  HEADING_6: "###### ",
};

/** Document body as Markdown-like text: headings, bullets, and tables keep their shape. */
export function documentText(content: StructuralElement[] | undefined, depth = 0): string {
  if (!content || depth > 10) return "";
  const lines: string[] = [];
  for (const element of content) {
    if (element.paragraph) {
      const text = (element.paragraph.elements ?? [])
        .map((item) => item.textRun?.content ?? "")
        .join("")
        .replace(/\n$/, "");
      const prefix = element.paragraph.bullet
        ? "- "
        : (HEADINGS[element.paragraph.paragraphStyle?.namedStyleType ?? ""] ?? "");
      lines.push(text ? `${prefix}${text}` : "");
    } else if (element.table) {
      for (const row of element.table.tableRows ?? []) {
        const cells = (row.tableCells ?? []).map((cell) =>
          documentText(cell.content, depth + 1)
            .replace(/\s*\n\s*/g, " ")
            .trim(),
        );
        lines.push(`| ${cells.join(" | ")} |`);
      }
    } else if (element.tableOfContents) {
      lines.push(documentText(element.tableOfContents.content, depth + 1));
    }
  }
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const read = {
  id: "read",
  label: "See documents",
  scopes: [googleScope("documents.readonly")],
  coveredBy: [googleScope("documents"), googleScope("drive.readonly"), googleScope("drive")],
};
const write = {
  id: "write",
  label: "Create and edit documents",
  scopes: [googleScope("documents")],
  coveredBy: [googleScope("drive")],
};

export const docsService: GoogleServiceDefinition = {
  slug: "google_docs",
  name: "Google Docs",
  description: "Read, create, and edit documents",
  permissions: [read, write],
  defaultPermissions: ["read"],
  operations: [
    googleOperation({
      name: "google_docs_get_document",
      description:
        "Read a Google Doc's text, with headings, lists, and tables. Long documents page with offset.",
      requires: ["read"],
      readOnly: true,
      input: z.object({
        document_id: z.string().min(1).max(200),
        offset: z.number().int().min(0).default(0),
        max_chars: z.number().int().min(200).max(MAX_TEXT_CHARS).default(DEFAULT_TEXT_CHARS),
      }),
      async run(input, { api }) {
        const document = await api.json<{
          documentId?: string;
          title?: string;
          revisionId?: string;
          body?: { content?: StructuralElement[] };
        }>({ url: `${DOCS}/${encodeURIComponent(input.document_id)}` });
        return {
          id: document.documentId,
          title: document.title,
          revision_id: document.revisionId,
          ...pageText(documentText(document.body?.content), input.offset, input.max_chars),
        };
      },
    }),
    googleOperation({
      name: "google_docs_create_document",
      description: "Create a Google Doc, optionally with starting text.",
      requires: ["write"],
      readOnly: false,
      input: z.object({
        title: z.string().trim().min(1).max(500),
        text: z.string().max(500_000).optional(),
      }),
      async run(input, { api }) {
        const created = await api.json<{ documentId?: string; title?: string }>({
          method: "POST",
          url: DOCS,
          json: { title: input.title },
        });
        if (input.text && created.documentId) {
          await api.json({
            method: "POST",
            url: `${DOCS}/${encodeURIComponent(created.documentId)}:batchUpdate`,
            json: { requests: [{ insertText: { location: { index: 1 }, text: input.text } }] },
          });
        }
        return {
          id: created.documentId,
          title: created.title,
          url: created.documentId
            ? `https://docs.google.com/document/d/${created.documentId}/edit`
            : undefined,
        };
      },
    }),
    googleOperation({
      name: "google_docs_append_text",
      description: "Add text to the end of a Google Doc.",
      requires: ["write"],
      readOnly: false,
      input: z.object({
        document_id: z.string().min(1).max(200),
        text: z.string().min(1).max(500_000),
      }),
      async run(input, { api }) {
        await api.json({
          method: "POST",
          url: `${DOCS}/${encodeURIComponent(input.document_id)}:batchUpdate`,
          json: { requests: [{ insertText: { endOfSegmentLocation: {}, text: input.text } }] },
        });
        return { appended_chars: input.text.length };
      },
    }),
    googleOperation({
      name: "google_docs_replace_text",
      description: "Replace every occurrence of some text in a Google Doc.",
      requires: ["write"],
      readOnly: false,
      input: z.object({
        document_id: z.string().min(1).max(200),
        find: z.string().min(1).max(10_000),
        replace: z.string().max(100_000),
        match_case: z.boolean().default(true),
      }),
      async run(input, { api }) {
        const result = await api.json<{
          replies?: Array<{ replaceAllText?: { occurrencesChanged?: number } }>;
        }>({
          method: "POST",
          url: `${DOCS}/${encodeURIComponent(input.document_id)}:batchUpdate`,
          json: {
            requests: [
              {
                replaceAllText: {
                  containsText: { text: input.find, matchCase: input.match_case },
                  replaceText: input.replace,
                },
              },
            ],
          },
          idempotent: true,
        });
        return { replaced: result.replies?.[0]?.replaceAllText?.occurrencesChanged ?? 0 };
      },
    }),
    googleOperation({
      name: "google_docs_batch_update",
      description:
        "Apply Docs API batchUpdate requests for formatting and structure, such as updateTextStyle, createParagraphBullets, or insertTable.",
      requires: ["write"],
      readOnly: false,
      input: z.object({
        document_id: z.string().min(1).max(200),
        requests: z
          .array(z.record(z.string(), z.unknown()))
          .min(1)
          .max(100)
          .describe("Docs API Request objects"),
      }),
      async run(input, { api }) {
        const result = await api.json<{ replies?: unknown[] }>({
          method: "POST",
          url: `${DOCS}/${encodeURIComponent(input.document_id)}:batchUpdate`,
          json: { requests: input.requests },
        });
        return { replies: (result.replies ?? []).length };
      },
    }),
  ],
};
