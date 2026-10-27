import { z } from "zod";
import type { GoogleApi } from "./google-api.js";
import {
  buildMimeMessage,
  decodeBase64Url,
  formatAddress,
  type GmailMessagePart,
  headerValue,
  type MimeAttachment,
  readGmailPayload,
} from "./google-mime.js";
import {
  DEFAULT_TEXT_CHARS,
  type GoogleOperationContext,
  type GoogleServiceDefinition,
  googleOperation,
  googleScope,
  isTextMimeType,
  MAX_SAVE_BYTES,
  MAX_TEXT_CHARS,
  pageText,
  readWorkspaceFile,
  writeWorkspaceFile,
} from "./google-tools.js";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const GMAIL_UPLOAD = "https://www.googleapis.com/upload/gmail/v1/users/me";
const FULL_MAIL = "https://mail.google.com/";
/** Gmail's own ceiling for a sent message, attachments included. */
const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 35 * 1024 * 1024;
const MAX_INLINE_ATTACHMENT_BYTES = 256 * 1024;
const SYSTEM_LABEL = /^[A-Z_]+$/;

type GmailMessage = {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailMessagePart;
};

type GmailLabel = { id?: string; name?: string; type?: string };

async function mapLimit<T, R>(items: T[], limit: number, map: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await map(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

function summary(message: GmailMessage) {
  const headers = message.payload?.headers;
  return {
    id: message.id ?? "",
    thread_id: message.threadId ?? "",
    from: headerValue(headers, "from"),
    to: headerValue(headers, "to"),
    subject: headerValue(headers, "subject"),
    date: headerValue(headers, "date"),
    snippet: message.snippet ?? "",
    labels: message.labelIds ?? [],
  };
}

async function labelIds(api: GoogleApi, names: string[]): Promise<string[]> {
  if (names.every((name) => SYSTEM_LABEL.test(name) || name.startsWith("Label_"))) return names;
  const { labels = [] } = await api.json<{ labels?: GmailLabel[] }>({ url: `${GMAIL}/labels` });
  return names.map((name) => {
    if (SYSTEM_LABEL.test(name) || name.startsWith("Label_")) return name;
    const match = labels.find((label) => label.name?.toLowerCase() === name.toLowerCase());
    if (!match?.id) throw new Error(`No Gmail label named "${name}". Create it first.`);
    return match.id;
  });
}

async function attachmentsFromWorkspace(
  context: GoogleOperationContext,
  paths: string[] | undefined,
): Promise<MimeAttachment[]> {
  const attachments: MimeAttachment[] = [];
  let total = 0;
  for (const path of paths ?? []) {
    const file = await readWorkspaceFile(context, path, MAX_MESSAGE_BYTES);
    total += file.bytes.byteLength;
    if (total > MAX_MESSAGE_BYTES) throw new Error("Attachments exceed Gmail's 25 MB limit.");
    attachments.push({ filename: file.name, mimeType: file.mimeType, content: file.bytes });
  }
  return attachments;
}

/** Metadata plus raw RFC 822, so threading survives large attachments. */
async function uploadMessage(
  api: GoogleApi,
  path: "messages/send" | "drafts",
  raw: string,
  threadId: string | undefined,
): Promise<{ id?: string; threadId?: string; message?: { id?: string; threadId?: string } }> {
  if (Buffer.byteLength(raw) > MAX_MESSAGE_BYTES * 1.4) {
    throw new Error("The message is larger than Gmail allows.");
  }
  const boundary = `savingroup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const metadata = threadId ? (path === "drafts" ? { message: { threadId } } : { threadId }) : {};
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: message/rfc822",
    "",
    raw,
    `--${boundary}--`,
    "",
  ].join("\r\n");
  return api.json({
    method: "POST",
    url: `${GMAIL_UPLOAD}/${path}`,
    query: { uploadType: "multipart" },
    headers: { "content-type": `multipart/related; boundary=${boundary}` },
    body,
  });
}

const Recipients = z.array(z.string().min(3).max(320)).max(100);
const Attachments = z
  .array(z.string().min(1).max(1024))
  .max(10)
  .optional()
  .describe("Paths of files on the bot's computer to attach");

const Compose = z.object({
  to: Recipients.min(1).describe('Recipients, as "name@example.com" or "Name <name@example.com>"'),
  cc: Recipients.optional(),
  bcc: Recipients.optional(),
  subject: z.string().max(998),
  body: z.string().max(200_000).describe("Plain-text body"),
  html_body: z.string().max(400_000).optional().describe("Optional HTML version of the body"),
  attachments: Attachments,
  reply_to_message_id: z
    .string()
    .max(200)
    .optional()
    .describe("Gmail message id this replies to, to keep the thread"),
});

async function threading(api: GoogleApi, messageId: string | undefined) {
  if (!messageId) return {};
  const original = await api.json<GmailMessage>({
    url: `${GMAIL}/messages/${encodeURIComponent(messageId)}`,
    query: {
      format: "metadata",
      metadataHeaders: ["Message-ID", "References", "Subject", "From", "To", "Cc", "Reply-To"],
    },
  });
  const headers = original.payload?.headers;
  const rfcId = headerValue(headers, "message-id");
  const references = [headerValue(headers, "references"), rfcId].filter(Boolean).join(" ");
  return {
    original,
    threadId: original.threadId,
    inReplyTo: rfcId || undefined,
    references: references || undefined,
  };
}

async function composed(input: z.output<typeof Compose>, context: GoogleOperationContext) {
  const thread = await threading(context.api, input.reply_to_message_id);
  const raw = buildMimeMessage({
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    text: input.body,
    html: input.html_body,
    inReplyTo: thread.inReplyTo,
    references: thread.references,
    attachments: await attachmentsFromWorkspace(context, input.attachments),
  });
  return { raw, threadId: thread.threadId };
}

/** Addresses from a header, skipping entries Gmail would reject such as group syntax. */
function addressList(value: string): string[] {
  // Split on commas outside quoted display names.
  return (value.match(/(?:[^,"]|"[^"]*")+/g) ?? []).flatMap((item) => {
    try {
      return [formatAddress(item.trim())];
    } catch {
      return [];
    }
  });
}

function bareEmail(address: string): string {
  return (/<([^<>]+)>/.exec(address)?.[1] ?? address).trim().toLowerCase();
}

const read = {
  id: "read",
  label: "Read email",
  scopes: [googleScope("gmail.readonly")],
  coveredBy: [googleScope("gmail.modify"), FULL_MAIL],
};
const compose = {
  id: "compose",
  label: "Draft and send email",
  scopes: [googleScope("gmail.compose")],
  coveredBy: [googleScope("gmail.modify"), FULL_MAIL],
};
const organize = {
  id: "organize",
  label: "Label, archive, and trash email",
  scopes: [googleScope("gmail.modify")],
  coveredBy: [FULL_MAIL],
};

export const gmailService: GoogleServiceDefinition = {
  slug: "gmail",
  name: "Gmail",
  description: "Search, read, draft, and send email",
  permissions: [read, compose, organize],
  defaultPermissions: ["read"],
  operations: [
    googleOperation({
      name: "gmail_search_messages",
      description:
        "Search Gmail with Gmail query syntax (from:, to:, subject:, after:2025/01/31, newer_than:1d, has:attachment, is:unread). Returns headers and snippets; read a message for its body.",
      requires: ["read"],
      readOnly: true,
      input: z.object({
        query: z
          .string()
          .max(1_000)
          .optional()
          .describe("Gmail search query. Omit for newest mail."),
        label: z.string().max(200).optional().describe("Label name or id, such as INBOX"),
        max_results: z.number().int().min(1).max(25).default(10),
        page_token: z.string().max(500).optional(),
        include_spam_trash: z.boolean().default(false),
      }),
      async run(input, { api }) {
        const listed = await api.json<{
          messages?: Array<{ id?: string }>;
          nextPageToken?: string;
          resultSizeEstimate?: number;
        }>({
          url: `${GMAIL}/messages`,
          query: {
            q: input.query,
            maxResults: input.max_results,
            pageToken: input.page_token,
            includeSpamTrash: input.include_spam_trash,
            labelIds: input.label ? await labelIds(api, [input.label]) : undefined,
          },
        });
        const ids = (listed.messages ?? []).map((message) => message.id).filter(Boolean);
        const messages = await mapLimit(ids as string[], 5, (id) =>
          api.json<GmailMessage>({
            url: `${GMAIL}/messages/${encodeURIComponent(id)}`,
            query: { format: "metadata", metadataHeaders: ["From", "To", "Subject", "Date"] },
          }),
        );
        return {
          messages: messages.map(summary),
          ...(listed.nextPageToken ? { next_page_token: listed.nextPageToken } : {}),
        };
      },
    }),
    googleOperation({
      name: "gmail_get_message",
      description:
        "Read one Gmail message: headers, body text, and attachment ids. Long bodies are paged with offset.",
      requires: ["read"],
      readOnly: true,
      input: z.object({
        message_id: z.string().min(1).max(200),
        offset: z.number().int().min(0).default(0),
        max_chars: z.number().int().min(200).max(MAX_TEXT_CHARS).default(DEFAULT_TEXT_CHARS),
      }),
      async run(input, { api }) {
        const message = await api.json<GmailMessage>({
          url: `${GMAIL}/messages/${encodeURIComponent(input.message_id)}`,
          query: { format: "full" },
        });
        const headers = message.payload?.headers;
        const body = readGmailPayload(message.payload);
        return {
          ...summary(message),
          cc: headerValue(headers, "cc"),
          reply_to: headerValue(headers, "reply-to"),
          body: pageText(body.text, input.offset, input.max_chars),
          attachments: body.attachments,
        };
      },
    }),
    googleOperation({
      name: "gmail_get_thread",
      description: "Read a Gmail conversation, oldest message first, with each body shortened.",
      requires: ["read"],
      readOnly: true,
      input: z.object({ thread_id: z.string().min(1).max(200) }),
      async run(input, { api }) {
        const thread = await api.json<{ id?: string; messages?: GmailMessage[] }>({
          url: `${GMAIL}/threads/${encodeURIComponent(input.thread_id)}`,
          query: { format: "full" },
        });
        const messages = thread.messages ?? [];
        const budget = Math.max(400, Math.floor(7_000 / Math.max(1, messages.length)));
        return {
          id: thread.id ?? input.thread_id,
          messages: messages.slice(-20).map((message) => {
            const body = readGmailPayload(message.payload);
            const page = pageText(body.text, 0, budget);
            return {
              ...summary(message),
              body: page.text,
              ...(page.next_offset ? { body_truncated: true } : {}),
              attachments: body.attachments.map((item) => item.filename),
            };
          }),
        };
      },
    }),
    googleOperation({
      name: "gmail_list_labels",
      description: "List Gmail labels with their ids.",
      requires: ["read"],
      readOnly: true,
      input: z.object({}),
      async run(_input, { api }) {
        const { labels = [] } = await api.json<{ labels?: GmailLabel[] }>({
          url: `${GMAIL}/labels`,
        });
        return {
          labels: labels.map((label) => ({ id: label.id, name: label.name, type: label.type })),
        };
      },
    }),
    googleOperation({
      name: "gmail_get_attachment",
      description:
        "Get a message attachment. Text files return their content; pass save_to to save any file on the bot's computer.",
      requires: ["read"],
      readOnly: true,
      input: z.object({
        message_id: z.string().min(1).max(200),
        attachment_id: z.string().min(1).max(2_000),
        save_to: z.string().min(1).max(1_024).optional().describe("Path on the bot's computer"),
        offset: z.number().int().min(0).default(0),
      }),
      async run(input, context) {
        const message = await context.api.json<GmailMessage>({
          url: `${GMAIL}/messages/${encodeURIComponent(input.message_id)}`,
          query: { format: "full" },
        });
        const info = readGmailPayload(message.payload).attachments.find(
          (item) => item.attachment_id === input.attachment_id,
        );
        if (!info) throw new Error("That attachment is not on this message.");
        if (info.size > (input.save_to ? MAX_SAVE_BYTES : MAX_ATTACHMENT_BYTES)) {
          throw new Error(`${info.filename} is too large to save on the bot's computer.`);
        }
        const attachment = await context.api.json<{ data?: string; size?: number }>({
          url: `${GMAIL}/messages/${encodeURIComponent(input.message_id)}/attachments/${encodeURIComponent(input.attachment_id)}`,
          maxBytes: Math.ceil(MAX_ATTACHMENT_BYTES * 1.4),
        });
        const bytes = decodeBase64Url(attachment.data ?? "");
        if (input.save_to) {
          await writeWorkspaceFile(context, input.save_to, bytes);
          return {
            saved_to: input.save_to,
            filename: info.filename,
            mime_type: info.mime_type,
            size: bytes.byteLength,
          };
        }
        if (!isTextMimeType(info.mime_type) || bytes.byteLength > MAX_INLINE_ATTACHMENT_BYTES) {
          throw new Error(
            `${info.filename} is ${info.mime_type}, ${bytes.byteLength} bytes. Pass save_to to save it on the bot's computer.`,
          );
        }
        return {
          filename: info.filename,
          mime_type: info.mime_type,
          content: pageText(new TextDecoder().decode(bytes), input.offset),
        };
      },
    }),
    googleOperation({
      name: "gmail_create_draft",
      description: "Create a Gmail draft. Attachments are files on the bot's computer.",
      requires: ["compose"],
      readOnly: false,
      input: Compose,
      async run(input, context) {
        const message = await composed(input, context);
        const draft = await uploadMessage(context.api, "drafts", message.raw, message.threadId);
        return {
          draft_id: draft.id,
          message_id: draft.message?.id,
          thread_id: draft.message?.threadId,
        };
      },
    }),
    googleOperation({
      name: "gmail_send_email",
      description: "Send an email from Gmail. Attachments are files on the bot's computer.",
      requires: ["compose"],
      readOnly: false,
      input: Compose,
      async run(input, context) {
        const message = await composed(input, context);
        const sent = await uploadMessage(
          context.api,
          "messages/send",
          message.raw,
          message.threadId,
        );
        return { message_id: sent.id, thread_id: sent.threadId };
      },
    }),
    googleOperation({
      name: "gmail_reply_to_message",
      description: "Reply in the same Gmail thread. reply_all also copies the original recipients.",
      requires: ["read", "compose"],
      readOnly: false,
      input: z.object({
        message_id: z.string().min(1).max(200),
        body: z.string().max(200_000),
        html_body: z.string().max(400_000).optional(),
        reply_all: z.boolean().default(false),
        cc: Recipients.optional(),
        attachments: Attachments,
      }),
      async run(input, context) {
        const thread = await threading(context.api, input.message_id);
        const headers = thread.original?.payload?.headers;
        const self = context.account.email.toLowerCase();
        const replyTo = headerValue(headers, "reply-to") || headerValue(headers, "from");
        const from = headerValue(headers, "from");
        const to = addressList(replyTo).filter((address) => bareEmail(address) !== self);
        const others = input.reply_all
          ? [...addressList(headerValue(headers, "to")), ...addressList(headerValue(headers, "cc"))]
          : [];
        // Replying to your own message goes back to its original recipients.
        if (to.length === 0 && bareEmail(from) === self) {
          to.push(...addressList(headerValue(headers, "to")));
        }
        const seen = new Set(to.map(bareEmail));
        const cc = [...others, ...(input.cc ?? [])].filter((address) => {
          const email = bareEmail(address);
          if (email === self || seen.has(email)) return false;
          seen.add(email);
          return true;
        });
        const subject = headerValue(headers, "subject");
        const raw = buildMimeMessage({
          to,
          cc,
          subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
          text: input.body,
          html: input.html_body,
          inReplyTo: thread.inReplyTo,
          references: thread.references,
          attachments: await attachmentsFromWorkspace(context, input.attachments),
        });
        const sent = await uploadMessage(context.api, "messages/send", raw, thread.threadId);
        return { message_id: sent.id, thread_id: sent.threadId, to, cc };
      },
    }),
    googleOperation({
      name: "gmail_send_draft",
      description: "Send an existing Gmail draft.",
      requires: ["compose"],
      readOnly: false,
      input: z.object({ draft_id: z.string().min(1).max(200) }),
      async run(input, { api }) {
        const sent = await api.json<{ id?: string; threadId?: string }>({
          method: "POST",
          url: `${GMAIL}/drafts/send`,
          json: { id: input.draft_id },
        });
        return { message_id: sent.id, thread_id: sent.threadId };
      },
    }),
    googleOperation({
      name: "gmail_create_label",
      description: "Create a Gmail label.",
      requires: ["organize"],
      readOnly: false,
      input: z.object({ name: z.string().trim().min(1).max(225) }),
      async run(input, { api }) {
        const label = await api.json<GmailLabel>({
          method: "POST",
          url: `${GMAIL}/labels`,
          json: {
            name: input.name,
            labelListVisibility: "labelShow",
            messageListVisibility: "show",
          },
        });
        return { id: label.id, name: label.name };
      },
    }),
    googleOperation({
      name: "gmail_modify_message_labels",
      description:
        "Add or remove labels on a message. Remove INBOX to archive, remove UNREAD to mark read, add STARRED to star.",
      requires: ["organize"],
      readOnly: false,
      input: z.object({
        message_id: z.string().min(1).max(200),
        add_labels: z.array(z.string().min(1).max(225)).max(20).default([]),
        remove_labels: z.array(z.string().min(1).max(225)).max(20).default([]),
      }),
      async run(input, { api }) {
        if (input.add_labels.length + input.remove_labels.length === 0) {
          throw new Error("Pass labels to add or remove.");
        }
        const message = await api.json<GmailMessage>({
          method: "POST",
          url: `${GMAIL}/messages/${encodeURIComponent(input.message_id)}/modify`,
          json: {
            addLabelIds: await labelIds(api, input.add_labels),
            removeLabelIds: await labelIds(api, input.remove_labels),
          },
          idempotent: true,
        });
        return { id: message.id, labels: message.labelIds ?? [] };
      },
    }),
    googleOperation({
      name: "gmail_trash_message",
      description: "Move a Gmail message to Trash, where it stays recoverable for 30 days.",
      requires: ["organize"],
      readOnly: false,
      input: z.object({ message_id: z.string().min(1).max(200) }),
      async run(input, { api }) {
        const message = await api.json<GmailMessage>({
          method: "POST",
          url: `${GMAIL}/messages/${encodeURIComponent(input.message_id)}/trash`,
          idempotent: true,
        });
        return { id: message.id, trashed: true };
      },
    }),
  ],
};
