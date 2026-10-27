import { randomBytes } from "node:crypto";

export interface MimeAttachment {
  filename: string;
  mimeType: string;
  content: Uint8Array;
}

export interface MimeMessageInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: MimeAttachment[];
}

const EMAIL_ADDRESS = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;

/** Header values come from the model; a line break would let it add headers such as Bcc. */
function headerSafe(value: string, field: string): string {
  if (/[\r\n\0]/.test(value)) throw new Error(`${field} must be a single line`);
  return value.trim();
}

function encodeWord(value: string): string {
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** Accepts "name@example.com" or "Name <name@example.com>". */
export function formatAddress(input: string): string {
  const value = headerSafe(input, "Email address");
  const named = /^(.*)<([^<>]+)>$/.exec(value);
  const email = (named ? named[2] : value)?.trim() ?? "";
  if (!EMAIL_ADDRESS.test(email)) throw new Error(`Invalid email address: ${email || value}`);
  const name = named?.[1]?.trim().replace(/^"|"$/g, "") ?? "";
  if (!name) return email;
  const safeName = /^[\w .'-]*$/.test(name) ? `"${name}"` : encodeWord(name);
  return `${safeName} <${email}>`;
}

function addressHeader(name: string, values: string[] | undefined): string[] {
  const list = (values ?? []).map(formatAddress);
  return list.length > 0 ? [`${name}: ${list.join(", ")}`] : [];
}

function base64Lines(content: Uint8Array | string): string {
  const encoded = Buffer.from(content).toString("base64");
  return encoded.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

function boundary(): string {
  return `savingroup_${randomBytes(12).toString("hex")}`;
}

function textPart(contentType: string, value: string): string {
  return [
    `Content-Type: ${contentType}; charset="UTF-8"`,
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(value),
  ].join("\r\n");
}

function quotedFilename(filename: string): string {
  const safe = headerSafe(filename, "Attachment name").replace(/["\\]/g, "_") || "attachment";
  return /^[\x20-\x7e]*$/.test(safe)
    ? `filename="${safe}"`
    : `filename*=UTF-8''${encodeURIComponent(safe)}`;
}

/** RFC 5322 message for Gmail's raw field. Bodies are base64 so any UTF-8 survives transport. */
export function buildMimeMessage(input: MimeMessageInput): string {
  if (input.to.length + (input.cc?.length ?? 0) + (input.bcc?.length ?? 0) === 0) {
    throw new Error("Add at least one recipient");
  }
  const headers = [
    ...addressHeader("To", input.to),
    ...addressHeader("Cc", input.cc),
    ...addressHeader("Bcc", input.bcc),
    `Subject: ${encodeWord(headerSafe(input.subject, "Subject"))}`,
    ...(input.inReplyTo ? [`In-Reply-To: ${headerSafe(input.inReplyTo, "In-Reply-To")}`] : []),
    ...(input.references ? [`References: ${headerSafe(input.references, "References")}`] : []),
    "MIME-Version: 1.0",
  ];
  const body = input.html
    ? (() => {
        const alternative = boundary();
        return {
          type: `multipart/alternative; boundary="${alternative}"`,
          content: [
            `--${alternative}`,
            textPart("text/plain", input.text),
            `--${alternative}`,
            textPart("text/html", input.html),
            `--${alternative}--`,
          ].join("\r\n"),
        };
      })()
    : { type: 'text/plain; charset="UTF-8"', content: base64Lines(input.text) };
  const attachments = input.attachments ?? [];
  if (attachments.length === 0) {
    return [
      ...headers,
      `Content-Type: ${body.type}`,
      ...(input.html ? [] : ["Content-Transfer-Encoding: base64"]),
      "",
      body.content,
    ].join("\r\n");
  }
  const mixed = boundary();
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    `--${mixed}`,
    `Content-Type: ${body.type}`,
    ...(input.html ? [] : ["Content-Transfer-Encoding: base64"]),
    "",
    body.content,
    ...attachments.flatMap((attachment) => [
      `--${mixed}`,
      `Content-Type: ${headerSafe(attachment.mimeType, "Attachment type")}`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; ${quotedFilename(attachment.filename)}`,
      "",
      base64Lines(attachment.content),
    ]),
    `--${mixed}--`,
  ].join("\r\n");
}

export function decodeBase64Url(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Readable text from email HTML. Scripts, styles, and hidden markup never reach the model. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|head|title)[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, href, label) => {
        const text = String(label)
          .replace(/<[^>]+>/g, "")
          .trim();
        return text && text !== href ? `${text} (${href})` : String(href);
      })
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface GmailHeader {
  name?: string | null;
  value?: string | null;
}

export interface GmailMessagePart {
  partId?: string | null;
  mimeType?: string | null;
  filename?: string | null;
  headers?: GmailHeader[] | null;
  body?: { attachmentId?: string | null; size?: number | null; data?: string | null } | null;
  parts?: GmailMessagePart[] | null;
}

export function headerValue(headers: GmailHeader[] | null | undefined, name: string): string {
  const lower = name.toLowerCase();
  return headers?.find((header) => header.name?.toLowerCase() === lower)?.value?.trim() ?? "";
}

function charsetOf(part: GmailMessagePart): string {
  const type = headerValue(part.headers, "content-type");
  return /charset="?([\w-]+)"?/i.exec(type)?.[1]?.toLowerCase() ?? "utf-8";
}

function decodePartText(part: GmailMessagePart): string {
  const data = part.body?.data;
  if (!data) return "";
  const bytes = decodeBase64Url(data);
  try {
    return new TextDecoder(charsetOf(part)).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

export interface GmailAttachmentInfo {
  attachment_id: string;
  filename: string;
  mime_type: string;
  size: number;
}

/** Body text (plain preferred over HTML) and attachment listing for one message payload. */
export function readGmailPayload(payload: GmailMessagePart | null | undefined): {
  text: string;
  attachments: GmailAttachmentInfo[];
} {
  let plain = "";
  let html = "";
  const attachments: GmailAttachmentInfo[] = [];
  const visit = (part: GmailMessagePart, depth: number) => {
    if (depth > 20) return;
    const type = part.mimeType?.toLowerCase() ?? "";
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        attachment_id: part.body.attachmentId,
        filename: part.filename,
        mime_type: type || "application/octet-stream",
        size: part.body.size ?? 0,
      });
      return;
    }
    if (type === "text/plain" && !plain) plain = decodePartText(part);
    else if (type === "text/html" && !html) html = decodePartText(part);
    for (const child of part.parts ?? []) visit(child, depth + 1);
  };
  if (payload) visit(payload, 0);
  return { text: (plain || htmlToText(html)).trim(), attachments };
}
