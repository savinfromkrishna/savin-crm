import { z } from "zod";
import { GoogleApiError } from "./google-api.js";
import {
  DEFAULT_TEXT_CHARS,
  definedFields,
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

const DRIVE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FILE_FIELDS =
  "id,name,mimeType,size,modifiedTime,createdTime,webViewLink,parents,description,shared,trashed,owners(emailAddress,displayName)";
/** Google only exports files up to 10 MB. */
const MAX_TEXT_DOWNLOAD_BYTES = 10 * 1024 * 1024;

const FOLDER = "application/vnd.google-apps.folder";
const NATIVE_TEXT_EXPORT: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};
const EXPORT_FORMATS: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  txt: "text/plain",
};
/** Source types Drive converts into Docs, Sheets, or Slides on upload. */
const CONVERSIONS: Record<string, string> = {
  "text/plain": "application/vnd.google-apps.document",
  "text/markdown": "application/vnd.google-apps.document",
  "text/html": "application/vnd.google-apps.document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "application/vnd.google-apps.document",
  "application/msword": "application/vnd.google-apps.document",
  "text/csv": "application/vnd.google-apps.spreadsheet",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    "application/vnd.google-apps.spreadsheet",
  "application/vnd.ms-excel": "application/vnd.google-apps.spreadsheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "application/vnd.google-apps.presentation",
  "application/vnd.ms-powerpoint": "application/vnd.google-apps.presentation",
};

type DriveFile = {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  createdTime?: string;
  webViewLink?: string;
  parents?: string[];
  description?: string;
  shared?: boolean;
  trashed?: boolean;
  owners?: Array<{ emailAddress?: string; displayName?: string }>;
};

type DrivePermission = {
  id?: string;
  type?: string;
  role?: string;
  emailAddress?: string;
  domain?: string;
  displayName?: string;
};

function file(item: DriveFile) {
  return definedFields({
    id: item.id,
    name: item.name,
    mime_type: item.mimeType,
    size: item.size ? Number(item.size) : undefined,
    modified: item.modifiedTime,
    link: item.webViewLink,
    parents: item.parents,
    owner: item.owners?.[0]?.emailAddress,
    shared: item.shared,
    description: item.description || undefined,
  });
}

/** Drive query string literal: backslashes and quotes must be escaped. */
function literal(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function folderPermissionHint(error: unknown, folder: string | undefined): never {
  if (folder && error instanceof GoogleApiError && error.kind === "permission") {
    throw new GoogleApiError(
      "permission",
      error.status,
      "Adding files to an existing folder needs the Manage Drive files permission.",
      error.reason,
    );
  }
  throw error;
}

const read = {
  id: "read",
  label: "See and download files",
  scopes: [googleScope("drive.readonly")],
  coveredBy: [googleScope("drive")],
};
const create = {
  id: "create",
  label: "Upload and create files",
  scopes: [googleScope("drive.file")],
  coveredBy: [googleScope("drive")],
};
const manage = {
  id: "manage",
  label: "Edit, move, share, and trash any file",
  scopes: [googleScope("drive")],
};

export const driveService: GoogleServiceDefinition = {
  slug: "google_drive",
  name: "Google Drive",
  description: "Find, read, upload, and share files",
  permissions: [read, create, manage],
  defaultPermissions: ["read"],
  operations: [
    googleOperation({
      name: "google_drive_search_files",
      description:
        "Find Drive files by text, name, folder, or type. Returns ids, names, types, and links.",
      requires: ["read"],
      readOnly: true,
      input: z.object({
        text: z.string().max(500).optional().describe("Words in the file name or content"),
        name: z.string().max(500).optional().describe("Part of the file name"),
        folder_id: z.string().max(200).optional().describe("Only files directly in this folder"),
        mime_type: z
          .string()
          .max(200)
          .optional()
          .describe("Exact type, such as application/vnd.google-apps.document or application/pdf"),
        drive_query: z
          .string()
          .max(2_000)
          .optional()
          .describe("Raw Drive query, combined with the other filters"),
        max_results: z.number().int().min(1).max(50).default(20),
        page_token: z.string().max(1_000).optional(),
      }),
      async run(input, { api }) {
        const clauses = ["trashed = false"];
        if (input.text) clauses.push(`fullText contains ${literal(input.text)}`);
        if (input.name) clauses.push(`name contains ${literal(input.name)}`);
        if (input.folder_id) clauses.push(`${literal(input.folder_id)} in parents`);
        if (input.mime_type) clauses.push(`mimeType = ${literal(input.mime_type)}`);
        if (input.drive_query) clauses.push(`(${input.drive_query})`);
        const listed = await api.json<{ files?: DriveFile[]; nextPageToken?: string }>({
          url: `${DRIVE}/files`,
          query: {
            q: clauses.join(" and "),
            pageSize: input.max_results,
            pageToken: input.page_token,
            // Drive rejects ordering for full-text searches.
            orderBy: input.text ? undefined : "modifiedTime desc",
            fields: `nextPageToken,files(${FILE_FIELDS})`,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
          },
        });
        return {
          files: (listed.files ?? []).map(file),
          ...(listed.nextPageToken ? { next_page_token: listed.nextPageToken } : {}),
        };
      },
    }),
    googleOperation({
      name: "google_drive_get_file",
      description: "Get a Drive file's details by id.",
      requires: ["read"],
      readOnly: true,
      input: z.object({ file_id: z.string().min(1).max(200) }),
      async run(input, { api }) {
        return file(
          await api.json<DriveFile>({
            url: `${DRIVE}/files/${encodeURIComponent(input.file_id)}`,
            query: { fields: FILE_FIELDS, supportsAllDrives: true },
          }),
        );
      },
    }),
    googleOperation({
      name: "google_drive_read_file",
      description:
        "Read a Drive file's text: Docs and Slides as text, Sheets as CSV of the first sheet, text files as-is. Pass save_to to save any file, including PDFs and media, on the bot's computer.",
      requires: ["read"],
      readOnly: true,
      input: z.object({
        file_id: z.string().min(1).max(200),
        save_to: z.string().min(1).max(1_024).optional().describe("Path on the bot's computer"),
        export_format: z
          .enum(["pdf", "docx", "xlsx", "pptx", "csv", "txt"])
          .optional()
          .describe("Format for saving a Google Docs, Sheets, or Slides file"),
        offset: z.number().int().min(0).default(0),
        max_chars: z.number().int().min(200).max(MAX_TEXT_CHARS).default(DEFAULT_TEXT_CHARS),
      }),
      async run(input, context) {
        const { api } = context;
        const meta = await api.json<DriveFile>({
          url: `${DRIVE}/files/${encodeURIComponent(input.file_id)}`,
          query: { fields: "id,name,mimeType,size", supportsAllDrives: true },
        });
        const mimeType = meta.mimeType ?? "application/octet-stream";
        if (mimeType === FOLDER) throw new Error("That is a folder. Search inside it instead.");
        const native = mimeType.startsWith("application/vnd.google-apps.");
        if (input.save_to) {
          const exportType = native ? EXPORT_FORMATS[input.export_format ?? "pdf"] : undefined;
          const bytes = (await api.request(
            exportType
              ? {
                  url: `${DRIVE}/files/${encodeURIComponent(input.file_id)}/export`,
                  query: { mimeType: exportType },
                  responseType: "bytes",
                  maxBytes: MAX_TEXT_DOWNLOAD_BYTES,
                }
              : {
                  url: `${DRIVE}/files/${encodeURIComponent(input.file_id)}`,
                  query: { alt: "media", supportsAllDrives: true },
                  responseType: "bytes",
                  maxBytes: MAX_SAVE_BYTES,
                },
          )) as Uint8Array;
          await writeWorkspaceFile(context, input.save_to, bytes);
          return {
            name: meta.name,
            mime_type: exportType ?? mimeType,
            saved_to: input.save_to,
            size: bytes.byteLength,
          };
        }
        const exportText = NATIVE_TEXT_EXPORT[mimeType];
        if (native && !exportText) {
          throw new Error(
            `${meta.name} (${mimeType}) has no text form. Pass save_to with export_format pdf.`,
          );
        }
        if (!native && !isTextMimeType(mimeType)) {
          throw new Error(
            `${meta.name} is ${mimeType}. Pass save_to to save it on the bot's computer, then open it there.`,
          );
        }
        const text = (await api.request(
          exportText
            ? {
                url: `${DRIVE}/files/${encodeURIComponent(input.file_id)}/export`,
                query: { mimeType: exportText },
                responseType: "text",
                maxBytes: MAX_TEXT_DOWNLOAD_BYTES,
              }
            : {
                url: `${DRIVE}/files/${encodeURIComponent(input.file_id)}`,
                query: { alt: "media", supportsAllDrives: true },
                responseType: "text",
                maxBytes: MAX_TEXT_DOWNLOAD_BYTES,
              },
        )) as string;
        return {
          name: meta.name,
          mime_type: mimeType,
          ...pageText(text, input.offset, input.max_chars),
        };
      },
    }),
    googleOperation({
      name: "google_drive_list_permissions",
      description: "List who can access a Drive file, before or after sharing it.",
      requires: ["read"],
      readOnly: true,
      input: z.object({ file_id: z.string().min(1).max(200) }),
      async run(input, { api }) {
        const listed = await api.json<{ permissions?: DrivePermission[] }>({
          url: `${DRIVE}/files/${encodeURIComponent(input.file_id)}/permissions`,
          query: {
            fields: "permissions(id,type,role,emailAddress,domain,displayName)",
            supportsAllDrives: true,
          },
        });
        return {
          permissions: (listed.permissions ?? []).map((permission) =>
            definedFields({
              id: permission.id,
              type: permission.type,
              role: permission.role,
              email: permission.emailAddress,
              domain: permission.domain,
              name: permission.displayName,
            }),
          ),
        };
      },
    }),
    googleOperation({
      name: "google_drive_upload_file",
      description:
        "Upload a file from the bot's computer to Drive. convert turns documents, spreadsheets, and presentations into Google formats.",
      requires: ["create"],
      readOnly: false,
      tracked: true,
      input: z.object({
        file_path: z.string().min(1).max(1_024).describe("Path on the bot's computer"),
        name: z.string().max(500).optional().describe("Name in Drive; defaults to the file name"),
        folder_id: z.string().max(200).optional(),
        description: z.string().max(4_000).optional(),
        convert: z.boolean().default(false),
      }),
      async run(input, context) {
        const source = await readWorkspaceFile(context, input.file_path);
        const target = input.convert ? CONVERSIONS[source.mimeType] : undefined;
        if (input.convert && !target) {
          throw new Error(`Drive cannot convert ${source.mimeType} into a Google format.`);
        }
        const uploaded = await context.api
          .resumableUpload({
            url: DRIVE_UPLOAD,
            query: { supportsAllDrives: true, fields: FILE_FIELDS },
            metadata: definedFields({
              name: input.name ?? source.name,
              parents: input.folder_id ? [input.folder_id] : undefined,
              description: input.description,
              mimeType: target,
            }),
            bytes: source.bytes,
            mimeType: source.mimeType,
            onProgress: (done, total) =>
              context.progress(`${Math.floor((done / total) * 100)}% uploaded`),
          })
          .catch((error: unknown) => folderPermissionHint(error, input.folder_id));
        return file(uploaded as DriveFile);
      },
    }),
    googleOperation({
      name: "google_drive_create_folder",
      description: "Create a Drive folder.",
      requires: ["create"],
      readOnly: false,
      input: z.object({
        name: z.string().trim().min(1).max(500),
        parent_id: z.string().max(200).optional(),
      }),
      async run(input, { api }) {
        const created = await api
          .json<DriveFile>({
            method: "POST",
            url: `${DRIVE}/files`,
            query: { supportsAllDrives: true, fields: FILE_FIELDS },
            json: definedFields({
              name: input.name,
              mimeType: FOLDER,
              parents: input.parent_id ? [input.parent_id] : undefined,
            }),
          })
          .catch((error: unknown) => folderPermissionHint(error, input.parent_id));
        return file(created);
      },
    }),
    googleOperation({
      name: "google_drive_create_file",
      description:
        "Create a Drive file from text. Set as_google_file to make a Google Doc, or a Google Sheet from CSV.",
      requires: ["create"],
      readOnly: false,
      input: z.object({
        name: z.string().trim().min(1).max(500),
        content: z.string().max(1_000_000),
        mime_type: z
          .enum(["text/plain", "text/markdown", "text/csv", "text/html"])
          .default("text/plain"),
        as_google_file: z.boolean().default(false),
        folder_id: z.string().max(200).optional(),
      }),
      async run(input, { api }) {
        const created = await api
          .resumableUpload({
            url: DRIVE_UPLOAD,
            query: { supportsAllDrives: true, fields: FILE_FIELDS },
            metadata: definedFields({
              name: input.name,
              parents: input.folder_id ? [input.folder_id] : undefined,
              mimeType: input.as_google_file ? CONVERSIONS[input.mime_type] : undefined,
            }),
            bytes: new TextEncoder().encode(input.content || " "),
            mimeType: input.mime_type,
          })
          .catch((error: unknown) => folderPermissionHint(error, input.folder_id));
        return file(created as DriveFile);
      },
    }),
    googleOperation({
      name: "google_drive_update_file",
      description: "Rename, describe, star, or move a Drive file.",
      requires: ["manage"],
      readOnly: false,
      input: z.object({
        file_id: z.string().min(1).max(200),
        name: z.string().trim().min(1).max(500).optional(),
        description: z.string().max(4_000).optional(),
        starred: z.boolean().optional(),
        move_to_folder_id: z.string().max(200).optional(),
      }),
      async run(input, { api }) {
        const id = encodeURIComponent(input.file_id);
        let removeParents: string | undefined;
        if (input.move_to_folder_id) {
          const current = await api.json<DriveFile>({
            url: `${DRIVE}/files/${id}`,
            query: { fields: "parents", supportsAllDrives: true },
          });
          removeParents = current.parents?.join(",") || undefined;
        }
        const updated = await api.json<DriveFile>({
          method: "PATCH",
          url: `${DRIVE}/files/${id}`,
          query: {
            supportsAllDrives: true,
            fields: FILE_FIELDS,
            addParents: input.move_to_folder_id,
            removeParents,
          },
          json: definedFields({
            name: input.name,
            description: input.description,
            starred: input.starred,
          }),
          idempotent: true,
        });
        return file(updated);
      },
    }),
    googleOperation({
      name: "google_drive_share_file",
      description:
        "Share a Drive file with a person, group, domain, or anyone with the link. Check current access with google_drive_list_permissions first.",
      requires: ["manage"],
      readOnly: false,
      input: z.object({
        file_id: z.string().min(1).max(200),
        role: z.enum(["reader", "commenter", "writer"]),
        type: z.enum(["user", "group", "domain", "anyone"]).default("user"),
        email_address: z.string().max(320).optional().describe("Required for user and group"),
        domain: z.string().max(255).optional().describe("Required for domain"),
        notify: z.boolean().default(true).describe("Email the person about the share"),
        message: z.string().max(2_000).optional(),
      }),
      async run(input, { api }) {
        if ((input.type === "user" || input.type === "group") && !input.email_address) {
          throw new Error("Pass email_address to share with a user or group.");
        }
        if (input.type === "domain" && !input.domain) throw new Error("Pass domain.");
        const notifies = input.type === "user" || input.type === "group";
        const permission = await api.json<DrivePermission>({
          method: "POST",
          url: `${DRIVE}/files/${encodeURIComponent(input.file_id)}/permissions`,
          query: {
            supportsAllDrives: true,
            sendNotificationEmail: notifies ? input.notify : undefined,
            emailMessage: notifies && input.notify ? input.message : undefined,
            fields: "id,type,role,emailAddress,domain",
          },
          json: definedFields({
            role: input.role,
            type: input.type,
            emailAddress: notifies ? input.email_address : undefined,
            domain: input.type === "domain" ? input.domain : undefined,
          }),
        });
        return definedFields({
          permission_id: permission.id,
          type: permission.type,
          role: permission.role,
          email: permission.emailAddress,
          domain: permission.domain,
        });
      },
    }),
    googleOperation({
      name: "google_drive_remove_permission",
      description: "Remove someone's access to a Drive file, by permission id.",
      requires: ["manage"],
      readOnly: false,
      input: z.object({
        file_id: z.string().min(1).max(200),
        permission_id: z.string().min(1).max(200),
      }),
      async run(input, { api }) {
        await api.request({
          method: "DELETE",
          url: `${DRIVE}/files/${encodeURIComponent(input.file_id)}/permissions/${encodeURIComponent(input.permission_id)}`,
          query: { supportsAllDrives: true },
          responseType: "none",
        });
        return { removed: true };
      },
    }),
    googleOperation({
      name: "google_drive_trash_file",
      description: "Move a Drive file to the trash, where it stays recoverable for 30 days.",
      requires: ["manage"],
      readOnly: false,
      input: z.object({ file_id: z.string().min(1).max(200) }),
      async run(input, { api }) {
        const updated = await api.json<DriveFile>({
          method: "PATCH",
          url: `${DRIVE}/files/${encodeURIComponent(input.file_id)}`,
          query: { supportsAllDrives: true, fields: "id,name,trashed" },
          json: { trashed: true },
          idempotent: true,
        });
        return { id: updated.id, name: updated.name, trashed: updated.trashed === true };
      },
    }),
  ],
};
