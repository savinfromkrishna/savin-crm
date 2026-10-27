import { calendarService } from "./google-calendar.js";
import { contactsService } from "./google-contacts.js";
import { docsService } from "./google-docs.js";
import { driveService } from "./google-drive.js";
import { formsService } from "./google-forms.js";
import { gmailService } from "./google-gmail.js";
import { searchConsoleService } from "./google-search-console.js";
import { sheetsService } from "./google-sheets.js";
import { slidesService } from "./google-slides.js";
import { tasksService } from "./google-tasks.js";
import type { GoogleOperation, GooglePermission, GoogleServiceDefinition } from "./google-tools.js";
import { youtubeService } from "./google-youtube.js";
import { youtubeAnalyticsService } from "./google-youtube-analytics.js";

/** Every Google app Savingroup can connect. A new API is one definition added here. */
export const GOOGLE_SERVICES: readonly GoogleServiceDefinition[] = [
  gmailService,
  calendarService,
  driveService,
  docsService,
  sheetsService,
  slidesService,
  youtubeService,
  youtubeAnalyticsService,
  tasksService,
  contactsService,
  formsService,
  searchConsoleService,
];

const bySlug = new Map(GOOGLE_SERVICES.map((service) => [service.slug, service]));
const byOperation = new Map(
  GOOGLE_SERVICES.flatMap((service) =>
    service.operations.map((operation) => [operation.name, { service, operation }] as const),
  ),
);

export function googleService(slug: string): GoogleServiceDefinition | undefined {
  return bySlug.get(slug);
}

export function googleOperationNamed(
  name: string,
): { service: GoogleServiceDefinition; operation: GoogleOperation } | undefined {
  return byOperation.get(name);
}

export function googlePermission(
  service: GoogleServiceDefinition,
  id: string,
): GooglePermission | undefined {
  return service.permissions.find((permission) => permission.id === id);
}
