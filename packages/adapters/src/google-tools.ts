import type { ConnectorWorkspace } from "@savingroup/adapter-kit";
import { ATTACHMENT_MAX_BYTES } from "@savingroup/contracts";
import type { z } from "zod";
import type { GoogleApi } from "./google-api.js";

export function googleScope(name: string): string {
  return `https://www.googleapis.com/auth/${name}`;
}

export interface GooglePermission {
  id: string;
  /** Shown in Integrations and on authorization cards. */
  label: string;
  /** Requested when the user grants this permission. */
  scopes: readonly string[];
  /** Broader granted scopes that already cover it. */
  coveredBy?: readonly string[];
}

export interface GoogleOperationContext {
  api: GoogleApi;
  account: { id: string; email: string };
  /** The bot's workspace, present during runs. */
  workspace?: ConnectorWorkspace;
  /** Stable per approved call, so a retried call can reuse it as an idempotency key. */
  executionId: string;
  signal: AbortSignal;
  /** Report progress of long work in Integrations activity. */
  progress(message: string): Promise<void>;
}

export interface GoogleOperation {
  /** Tool name. Read operations use get/list/search/find/read verbs so they skip approval. */
  name: string;
  description: string;
  /** Permission ids the account must have granted, all of them. */
  requires: readonly string[];
  readOnly: boolean;
  input: z.ZodObject;
  /** Long-running work that appears as running in Integrations until it ends. */
  tracked?: boolean;
  run(input: Record<string, unknown>, context: GoogleOperationContext): Promise<unknown>;
}

/** Keeps each operation's run() typed by its own input schema. */
export function googleOperation<Schema extends z.ZodObject>(definition: {
  name: string;
  description: string;
  requires: readonly string[];
  readOnly: boolean;
  input: Schema;
  tracked?: boolean;
  run(input: z.output<Schema>, context: GoogleOperationContext): Promise<unknown>;
}): GoogleOperation {
  return definition as unknown as GoogleOperation;
}

export interface GoogleServiceDefinition {
  /** Catalog slug and tool-name prefix. */
  slug: string;
  name: string;
  description: string;
  permissions: readonly GooglePermission[];
  /** Requested when the app is first added. */
  defaultPermissions: readonly string[];
  operations: readonly GoogleOperation[];
}

export function hasGooglePermission(
  permission: GooglePermission,
  granted: Iterable<string>,
): boolean {
  const scopes = new Set(granted);
  return (
    permission.scopes.every((scope) => scopes.has(scope)) ||
    (permission.coveredBy ?? []).some((scope) => scopes.has(scope))
  );
}

/** Tool results are clipped near 12k characters; text pages stay well inside that. */
export const DEFAULT_TEXT_CHARS = 6_000;
export const MAX_TEXT_CHARS = 9_000;

export function pageText(
  text: string,
  offset = 0,
  maxChars = DEFAULT_TEXT_CHARS,
): { text: string; total_chars: number; next_offset?: number } {
  const start = Math.max(0, Math.min(offset, text.length));
  const end = Math.min(text.length, start + Math.min(MAX_TEXT_CHARS, Math.max(1, maxChars)));
  return {
    text: text.slice(start, end),
    total_chars: text.length,
    ...(end < text.length ? { next_offset: end } : {}),
  };
}

/**
 * Files cross the sandbox as base64 strings held in memory, so reads stay well under
 * the runtime's string limit and writes match what computers accept from the platform.
 */
export const MAX_TRANSFER_BYTES = 256 * 1024 * 1024;
export const MAX_SAVE_BYTES = ATTACHMENT_MAX_BYTES;

export async function readWorkspaceFile(
  context: Pick<GoogleOperationContext, "workspace">,
  path: string,
  maxBytes = MAX_TRANSFER_BYTES,
): Promise<{ bytes: Uint8Array; name: string; mimeType: string }> {
  if (!context.workspace) {
    throw new Error("Files can only move to Google from a bot's computer during a run.");
  }
  let bytes: Uint8Array;
  try {
    bytes = await context.workspace.readFile(path, { maxBytes });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/exceeds \d+ bytes/.test(message)) {
      throw new Error(`${path} is larger than ${Math.floor(maxBytes / (1024 * 1024))} MiB.`);
    }
    throw new Error(`Could not read ${path} from the bot's computer.`);
  }
  if (bytes.byteLength > maxBytes) {
    throw new Error(`${path} is larger than ${Math.floor(maxBytes / (1024 * 1024))} MiB.`);
  }
  const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? "file";
  return { bytes, name, mimeType: mimeTypeForName(name) };
}

export async function writeWorkspaceFile(
  context: Pick<GoogleOperationContext, "workspace">,
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  if (!context.workspace) {
    throw new Error("Files can only be saved to a bot's computer during a run.");
  }
  if (bytes.byteLength > MAX_SAVE_BYTES) {
    throw new Error(
      `The file is larger than ${MAX_SAVE_BYTES / (1024 * 1024)} MiB, the most a bot's computer accepts. Share its link instead.`,
    );
  }
  await context.workspace.writeFile(path, bytes);
}

const MIME_TYPES: Record<string, string> = {
  avi: "video/x-msvideo",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  gif: "image/gif",
  htm: "text/html",
  html: "text/html",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  m4a: "audio/mp4",
  md: "text/markdown",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  mpeg: "video/mpeg",
  pdf: "application/pdf",
  png: "image/png",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  svg: "image/svg+xml",
  tsv: "text/tab-separated-values",
  txt: "text/plain",
  wav: "audio/wav",
  webm: "video/webm",
  webp: "image/webp",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xml: "application/xml",
  zip: "application/zip",
};

export function mimeTypeForName(name: string): string {
  const extension = name.split(".").at(-1)?.toLowerCase() ?? "";
  return MIME_TYPES[extension] ?? "application/octet-stream";
}

export function isTextMimeType(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/") ||
    /^application\/(json|xml|javascript|x-yaml|yaml|csv|x-ndjson)(;|$)/.test(mimeType)
  );
}

/** Drops undefined fields so PATCH bodies only carry what the caller set. */
export function definedFields<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;
}
