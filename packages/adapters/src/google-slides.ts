import { createHash } from "node:crypto";
import { z } from "zod";
import { type GoogleServiceDefinition, googleOperation, googleScope } from "./google-tools.js";

const SLIDES = "https://slides.googleapis.com/v1/presentations";
const MAX_SLIDE_CHARS = 800;
const MAX_TOTAL_CHARS = 8_000;

type TextContent = { textElements?: Array<{ textRun?: { content?: string } }> };
type PageElement = {
  objectId?: string;
  shape?: { text?: TextContent };
  table?: { tableRows?: Array<{ tableCells?: Array<{ text?: TextContent }> }> };
  elementGroup?: { children?: PageElement[] };
};

function textOf(text: TextContent | undefined): string {
  return (text?.textElements ?? [])
    .map((item) => item.textRun?.content ?? "")
    .join("")
    .trim();
}

function elementText(element: PageElement, depth = 0): string[] {
  if (depth > 5) return [];
  if (element.shape) return [textOf(element.shape.text)].filter(Boolean);
  if (element.table) {
    return (element.table.tableRows ?? []).map(
      (row) => `| ${(row.tableCells ?? []).map((cell) => textOf(cell.text)).join(" | ")} |`,
    );
  }
  return (element.elementGroup?.children ?? []).flatMap((child) => elementText(child, depth + 1));
}

/** Slides object ids derived from the approved call, so a retry cannot add a second slide. */
function objectId(executionId: string, role: string): string {
  return `rk_${createHash("sha256").update(`${executionId}:${role}`).digest("hex").slice(0, 24)}`;
}

const PLACEHOLDERS: Record<string, { title?: string; body?: string }> = {
  TITLE_AND_BODY: { title: "TITLE", body: "BODY" },
  TITLE: { title: "CENTERED_TITLE", body: "SUBTITLE" },
  TITLE_ONLY: { title: "TITLE" },
  SECTION_HEADER: { title: "TITLE" },
  BLANK: {},
};

const read = {
  id: "read",
  label: "See presentations",
  scopes: [googleScope("presentations.readonly")],
  coveredBy: [googleScope("presentations"), googleScope("drive.readonly"), googleScope("drive")],
};
const write = {
  id: "write",
  label: "Create and edit presentations",
  scopes: [googleScope("presentations")],
  coveredBy: [googleScope("drive")],
};

export const slidesService: GoogleServiceDefinition = {
  slug: "google_slides",
  name: "Google Slides",
  description: "Read, create, and edit presentations",
  permissions: [read, write],
  defaultPermissions: ["read"],
  operations: [
    googleOperation({
      name: "google_slides_get_presentation",
      description: "Read a presentation's title and the text on each slide.",
      requires: ["read"],
      readOnly: true,
      input: z.object({ presentation_id: z.string().min(1).max(200) }),
      async run(input, { api }) {
        const presentation = await api.json<{
          presentationId?: string;
          title?: string;
          slides?: Array<{ objectId?: string; pageElements?: PageElement[] }>;
        }>({ url: `${SLIDES}/${encodeURIComponent(input.presentation_id)}` });
        let budget = MAX_TOTAL_CHARS;
        const slides = (presentation.slides ?? []).map((slide, index) => {
          const text = (slide.pageElements ?? [])
            .flatMap((element) => elementText(element))
            .join("\n")
            .slice(0, Math.max(0, Math.min(MAX_SLIDE_CHARS, budget)));
          budget -= text.length;
          return { index, object_id: slide.objectId, text };
        });
        return {
          id: presentation.presentationId,
          title: presentation.title,
          slide_count: slides.length,
          slides,
          ...(budget <= 0 ? { truncated: true } : {}),
        };
      },
    }),
    googleOperation({
      name: "google_slides_create_presentation",
      description: "Create an empty presentation.",
      requires: ["write"],
      readOnly: false,
      input: z.object({ title: z.string().trim().min(1).max(500) }),
      async run(input, { api }) {
        const created = await api.json<{ presentationId?: string; title?: string }>({
          method: "POST",
          url: SLIDES,
          json: { title: input.title },
        });
        return {
          id: created.presentationId,
          title: created.title,
          url: created.presentationId
            ? `https://docs.google.com/presentation/d/${created.presentationId}/edit`
            : undefined,
        };
      },
    }),
    googleOperation({
      name: "google_slides_add_slide",
      description: "Add a slide with a standard layout, title, and body text.",
      requires: ["write"],
      readOnly: false,
      input: z.object({
        presentation_id: z.string().min(1).max(200),
        layout: z
          .enum(["TITLE_AND_BODY", "TITLE", "TITLE_ONLY", "SECTION_HEADER", "BLANK"])
          .default("TITLE_AND_BODY"),
        title: z.string().max(5_000).optional(),
        body: z.string().max(50_000).optional().describe("Body or subtitle text"),
        insertion_index: z.number().int().min(0).optional(),
      }),
      async run(input, { api, executionId }) {
        const slideId = objectId(executionId, "slide");
        const titleId = objectId(executionId, "title");
        const bodyId = objectId(executionId, "body");
        const placeholders = PLACEHOLDERS[input.layout] ?? {};
        const mappings = [
          ...(placeholders.title && input.title
            ? [{ layoutPlaceholder: { type: placeholders.title, index: 0 }, objectId: titleId }]
            : []),
          ...(placeholders.body && input.body
            ? [{ layoutPlaceholder: { type: placeholders.body, index: 0 }, objectId: bodyId }]
            : []),
        ];
        await api.json({
          method: "POST",
          url: `${SLIDES}/${encodeURIComponent(input.presentation_id)}:batchUpdate`,
          json: {
            requests: [
              {
                createSlide: {
                  objectId: slideId,
                  ...(input.insertion_index !== undefined
                    ? { insertionIndex: input.insertion_index }
                    : {}),
                  slideLayoutReference: { predefinedLayout: input.layout },
                  ...(mappings.length ? { placeholderIdMappings: mappings } : {}),
                },
              },
              ...mappings.map((mapping) => ({
                insertText: {
                  objectId: mapping.objectId,
                  text: mapping.objectId === titleId ? input.title : input.body,
                },
              })),
            ],
          },
        });
        return { slide_id: slideId };
      },
    }),
    googleOperation({
      name: "google_slides_replace_text",
      description: "Replace every occurrence of some text across a presentation.",
      requires: ["write"],
      readOnly: false,
      input: z.object({
        presentation_id: z.string().min(1).max(200),
        find: z.string().min(1).max(10_000),
        replace: z.string().max(100_000),
        match_case: z.boolean().default(true),
      }),
      async run(input, { api }) {
        const result = await api.json<{
          replies?: Array<{ replaceAllText?: { occurrencesChanged?: number } }>;
        }>({
          method: "POST",
          url: `${SLIDES}/${encodeURIComponent(input.presentation_id)}:batchUpdate`,
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
      name: "google_slides_batch_update",
      description:
        "Apply Slides API batchUpdate requests, such as createShape, createImage, or updateTextStyle.",
      requires: ["write"],
      readOnly: false,
      input: z.object({
        presentation_id: z.string().min(1).max(200),
        requests: z
          .array(z.record(z.string(), z.unknown()))
          .min(1)
          .max(100)
          .describe("Slides API Request objects"),
      }),
      async run(input, { api }) {
        const result = await api.json<{ replies?: unknown[] }>({
          method: "POST",
          url: `${SLIDES}/${encodeURIComponent(input.presentation_id)}:batchUpdate`,
          json: { requests: input.requests },
        });
        return { replies: (result.replies ?? []).length };
      },
    }),
  ],
};
