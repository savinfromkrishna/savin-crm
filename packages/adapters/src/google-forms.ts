import { z } from "zod";
import {
  definedFields,
  type GoogleServiceDefinition,
  googleOperation,
  googleScope,
} from "./google-tools.js";

const FORMS = "https://forms.googleapis.com/v1/forms";

type Question = {
  questionId?: string;
  required?: boolean;
  textQuestion?: { paragraph?: boolean };
  choiceQuestion?: { type?: string; options?: Array<{ value?: string }> };
  scaleQuestion?: { low?: number; high?: number };
  dateQuestion?: unknown;
  timeQuestion?: unknown;
};
type FormItem = {
  itemId?: string;
  title?: string;
  description?: string;
  questionItem?: { question?: Question };
};
type Form = {
  formId?: string;
  info?: { title?: string; description?: string };
  items?: FormItem[];
  responderUri?: string;
};

function questionKind(question: Question): string {
  if (question.choiceQuestion) return question.choiceQuestion.type?.toLowerCase() ?? "choice";
  if (question.textQuestion) return question.textQuestion.paragraph ? "paragraph" : "text";
  if (question.scaleQuestion) return "scale";
  if (question.dateQuestion) return "date";
  if (question.timeQuestion) return "time";
  return "other";
}

const read = {
  id: "read",
  label: "See forms and responses",
  scopes: [googleScope("forms.body.readonly"), googleScope("forms.responses.readonly")],
};
const write = {
  id: "write",
  label: "Create and edit forms",
  scopes: [googleScope("forms.body")],
  coveredBy: [googleScope("drive")],
};

export const formsService: GoogleServiceDefinition = {
  slug: "google_forms",
  name: "Google Forms",
  description: "Build forms and read responses",
  permissions: [read, write],
  defaultPermissions: ["read"],
  operations: [
    googleOperation({
      name: "google_forms_get_form",
      description: "Get a form's title, questions, and responder link.",
      requires: ["read"],
      readOnly: true,
      input: z.object({ form_id: z.string().min(1).max(200) }),
      async run(input, { api }) {
        const form = await api.json<Form>({ url: `${FORMS}/${encodeURIComponent(input.form_id)}` });
        return {
          id: form.formId,
          title: form.info?.title,
          description: form.info?.description,
          responder_url: form.responderUri,
          questions: (form.items ?? []).flatMap((item) => {
            const question = item.questionItem?.question;
            if (!question) return [];
            return [
              definedFields({
                question_id: question.questionId,
                title: item.title,
                kind: questionKind(question),
                required: question.required || undefined,
                options: question.choiceQuestion?.options?.map((option) => option.value),
              }),
            ];
          }),
        };
      },
    }),
    googleOperation({
      name: "google_forms_list_responses",
      description: "List form responses, with answers keyed by question title.",
      requires: ["read"],
      readOnly: true,
      input: z.object({
        form_id: z.string().min(1).max(200),
        max_results: z.number().int().min(1).max(100).default(25),
        page_token: z.string().max(500).optional(),
      }),
      async run(input, { api }) {
        const id = encodeURIComponent(input.form_id);
        const [form, listed] = await Promise.all([
          api.json<Form>({ url: `${FORMS}/${id}` }),
          api.json<{
            responses?: Array<{
              responseId?: string;
              lastSubmittedTime?: string;
              respondentEmail?: string;
              answers?: Record<string, { textAnswers?: { answers?: Array<{ value?: string }> } }>;
            }>;
            nextPageToken?: string;
          }>({
            url: `${FORMS}/${id}/responses`,
            query: { pageSize: input.max_results, pageToken: input.page_token },
          }),
        ]);
        const titles = new Map(
          (form.items ?? []).flatMap((item) => {
            const questionId = item.questionItem?.question?.questionId;
            return questionId ? [[questionId, item.title ?? questionId] as const] : [];
          }),
        );
        return {
          responses: (listed.responses ?? []).map((response) =>
            definedFields({
              id: response.responseId,
              submitted: response.lastSubmittedTime,
              email: response.respondentEmail,
              answers: Object.fromEntries(
                Object.entries(response.answers ?? {}).map(([questionId, answer]) => [
                  titles.get(questionId) ?? questionId,
                  (answer.textAnswers?.answers ?? [])
                    .map((item) => item.value ?? "")
                    .join(", ")
                    .slice(0, 1_000),
                ]),
              ),
            }),
          ),
          ...(listed.nextPageToken ? { next_page_token: listed.nextPageToken } : {}),
        };
      },
    }),
    googleOperation({
      name: "google_forms_create_form",
      description: "Create an empty form. Add questions with google_forms_add_question.",
      requires: ["write"],
      readOnly: false,
      input: z.object({
        title: z.string().trim().min(1).max(500),
        description: z.string().max(4_000).optional(),
      }),
      async run(input, { api }) {
        const form = await api.json<Form>({
          method: "POST",
          url: FORMS,
          json: { info: { title: input.title } },
        });
        if (input.description && form.formId) {
          await api.json({
            method: "POST",
            url: `${FORMS}/${encodeURIComponent(form.formId)}:batchUpdate`,
            json: {
              requests: [
                {
                  updateFormInfo: {
                    info: { description: input.description },
                    updateMask: "description",
                  },
                },
              ],
            },
          });
        }
        return { id: form.formId, responder_url: form.responderUri };
      },
    }),
    googleOperation({
      name: "google_forms_add_question",
      description: "Add a question to a form: short text, paragraph, or a choice question.",
      requires: ["write"],
      readOnly: false,
      input: z.object({
        form_id: z.string().min(1).max(200),
        title: z.string().trim().min(1).max(1_000),
        kind: z.enum(["text", "paragraph", "radio", "checkbox", "drop_down"]).default("text"),
        options: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
        required: z.boolean().default(false),
        index: z.number().int().min(0).optional().describe("Position; defaults to the end"),
      }),
      async run(input, { api }) {
        const choice =
          input.kind === "radio" || input.kind === "checkbox" || input.kind === "drop_down";
        if (choice && !input.options?.length) throw new Error("Choice questions need options.");
        const id = encodeURIComponent(input.form_id);
        const index =
          input.index ??
          (await api.json<Form>({ url: `${FORMS}/${id}`, query: { fields: "items(itemId)" } }))
            .items?.length ??
          0;
        await api.json({
          method: "POST",
          url: `${FORMS}/${id}:batchUpdate`,
          json: {
            requests: [
              {
                createItem: {
                  item: {
                    title: input.title,
                    questionItem: {
                      question: {
                        required: input.required,
                        ...(choice
                          ? {
                              choiceQuestion: {
                                type: input.kind.toUpperCase(),
                                options: input.options?.map((value) => ({ value })),
                              },
                            }
                          : { textQuestion: { paragraph: input.kind === "paragraph" } }),
                      },
                    },
                  },
                  location: { index },
                },
              },
            ],
          },
        });
        return { added: true, index };
      },
    }),
  ],
};
