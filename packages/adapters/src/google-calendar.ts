import { createHash } from "node:crypto";
import { z } from "zod";
import { type GoogleApi, GoogleApiError } from "./google-api.js";
import {
  definedFields,
  type GoogleServiceDefinition,
  googleOperation,
  googleScope,
} from "./google-tools.js";

const CALENDAR = "https://www.googleapis.com/calendar/v3";
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;

type EventTime = { date?: string; dateTime?: string; timeZone?: string };
type CalendarEvent = {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: EventTime;
  end?: EventTime;
  attendees?: Array<{ email?: string; responseStatus?: string; organizer?: boolean }>;
  organizer?: { email?: string };
  htmlLink?: string;
  hangoutLink?: string;
  recurringEventId?: string;
  recurrence?: string[];
};

function event(item: CalendarEvent) {
  return definedFields({
    id: item.id,
    summary: item.summary,
    status: item.status,
    start: item.start?.dateTime ?? item.start?.date,
    end: item.end?.dateTime ?? item.end?.date,
    all_day: Boolean(item.start?.date) || undefined,
    time_zone: item.start?.timeZone,
    location: item.location,
    description: item.description ? item.description.slice(0, 1_000) : undefined,
    attendees: item.attendees?.map((attendee) =>
      definedFields({ email: attendee.email, response: attendee.responseStatus }),
    ),
    organizer: item.organizer?.email,
    link: item.htmlLink,
    meet_link: item.hangoutLink,
    recurrence: item.recurrence,
    recurring_event_id: item.recurringEventId,
  });
}

function calendarPath(calendarId: string): string {
  return `${CALENDAR}/calendars/${encodeURIComponent(calendarId)}`;
}

async function calendarTimeZone(api: GoogleApi, calendarId: string): Promise<string> {
  const calendar = await api.json<{ timeZone?: string }>({
    url: calendarPath(calendarId),
    query: { fields: "timeZone" },
  });
  return calendar.timeZone || "UTC";
}

/** Dates mean all-day events; date-times without an offset use the time zone given or the calendar's. */
async function eventTimes(
  api: GoogleApi,
  calendarId: string,
  input: { start: string; end?: string; duration_minutes?: number; time_zone?: string },
): Promise<{ start: EventTime; end: EventTime }> {
  if (DATE_ONLY.test(input.start)) {
    const end =
      input.end ??
      new Date(Date.parse(`${input.start}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    if (!DATE_ONLY.test(end)) throw new Error("An all-day event needs an end date, not a time.");
    return { start: { date: input.start }, end: { date: end } };
  }
  const zone =
    input.time_zone ??
    (HAS_OFFSET.test(input.start) ? undefined : await calendarTimeZone(api, calendarId));
  const startMs = Date.parse(HAS_OFFSET.test(input.start) ? input.start : `${input.start}Z`);
  if (!Number.isFinite(startMs)) throw new Error("start must be an ISO date or date-time.");
  let end = input.end;
  if (!end) {
    const minutes = input.duration_minutes ?? 30;
    if (HAS_OFFSET.test(input.start)) {
      end = new Date(startMs + minutes * 60_000).toISOString();
    } else {
      // Keep the floating local time in the same zone as the start.
      end = new Date(startMs + minutes * 60_000).toISOString().slice(0, 19);
    }
  }
  return {
    start: definedFields({ dateTime: input.start, timeZone: zone }),
    end: definedFields({ dateTime: end, timeZone: zone }),
  };
}

/** Calendar accepts caller-chosen ids, so a retried create finds the event it already made. */
export function calendarEventId(executionId: string): string {
  const digest = createHash("sha256").update(`savingroup-calendar:${executionId}`).digest();
  const alphabet = "0123456789abcdefghijklmnopqrstuv";
  let id = "";
  for (const byte of digest) id += alphabet[byte & 31];
  return `rk${id}`;
}

const SendUpdates = z
  .enum(["all", "externalOnly", "none"])
  .default("all")
  .describe("Who receives invitation emails");
const Times = {
  start: z.string().min(10).max(40).describe("ISO date (all day) or date-time"),
  end: z.string().min(10).max(40).optional(),
  duration_minutes: z.number().int().min(1).max(1_440).optional(),
  time_zone: z.string().max(64).optional().describe("IANA time zone, such as America/New_York"),
};

const read = {
  id: "read",
  label: "See calendars and events",
  scopes: [googleScope("calendar.readonly")],
  coveredBy: [googleScope("calendar")],
};
const write = {
  id: "write",
  label: "Create, change, and delete events",
  scopes: [googleScope("calendar.events")],
  coveredBy: [googleScope("calendar")],
};

export const calendarService: GoogleServiceDefinition = {
  slug: "google_calendar",
  name: "Google Calendar",
  description: "Check availability and manage events",
  permissions: [read, write],
  defaultPermissions: ["read"],
  operations: [
    googleOperation({
      name: "google_calendar_list_calendars",
      description: "List the calendars this account can see, with ids and time zones.",
      requires: ["read"],
      readOnly: true,
      input: z.object({}),
      async run(_input, { api }) {
        const listed = await api.json<{
          items?: Array<{
            id?: string;
            summary?: string;
            primary?: boolean;
            accessRole?: string;
            timeZone?: string;
          }>;
        }>({ url: `${CALENDAR}/users/me/calendarList`, query: { maxResults: 250 } });
        return {
          calendars: (listed.items ?? []).map((item) =>
            definedFields({
              id: item.id,
              name: item.summary,
              primary: item.primary || undefined,
              access: item.accessRole,
              time_zone: item.timeZone,
            }),
          ),
        };
      },
    }),
    googleOperation({
      name: "google_calendar_list_events",
      description:
        "List events between two times, soonest first. Recurring events are expanded into instances.",
      requires: ["read"],
      readOnly: true,
      input: z.object({
        calendar_id: z.string().max(500).default("primary"),
        time_min: z.string().max(40).optional().describe("ISO date-time; defaults to now"),
        time_max: z.string().max(40).optional(),
        query: z.string().max(500).optional().describe("Free text to match"),
        max_results: z.number().int().min(1).max(50).default(20),
        page_token: z.string().max(1_000).optional(),
        time_zone: z.string().max(64).optional(),
      }),
      async run(input, { api }) {
        const listed = await api.json<{ items?: CalendarEvent[]; nextPageToken?: string }>({
          url: `${calendarPath(input.calendar_id)}/events`,
          query: {
            timeMin: input.time_min ?? new Date().toISOString(),
            timeMax: input.time_max,
            q: input.query,
            maxResults: input.max_results,
            pageToken: input.page_token,
            singleEvents: true,
            orderBy: "startTime",
            timeZone: input.time_zone,
          },
        });
        return {
          events: (listed.items ?? []).map(event),
          ...(listed.nextPageToken ? { next_page_token: listed.nextPageToken } : {}),
        };
      },
    }),
    googleOperation({
      name: "google_calendar_get_event",
      description: "Get one calendar event by id.",
      requires: ["read"],
      readOnly: true,
      input: z.object({
        calendar_id: z.string().max(500).default("primary"),
        event_id: z.string().min(1).max(1_024),
      }),
      async run(input, { api }) {
        return event(
          await api.json<CalendarEvent>({
            url: `${calendarPath(input.calendar_id)}/events/${encodeURIComponent(input.event_id)}`,
          }),
        );
      },
    }),
    googleOperation({
      name: "google_calendar_get_availability",
      description: "Find busy time ranges on one or more calendars between two times.",
      requires: ["read"],
      readOnly: true,
      input: z.object({
        time_min: z.string().min(10).max(40),
        time_max: z.string().min(10).max(40),
        calendar_ids: z.array(z.string().max(500)).min(1).max(20).default(["primary"]),
        time_zone: z.string().max(64).optional(),
      }),
      async run(input, { api }) {
        const result = await api.json<{
          calendars?: Record<
            string,
            { busy?: Array<{ start?: string; end?: string }>; errors?: unknown[] }
          >;
        }>({
          method: "POST",
          url: `${CALENDAR}/freeBusy`,
          json: definedFields({
            timeMin: input.time_min,
            timeMax: input.time_max,
            timeZone: input.time_zone,
            items: input.calendar_ids.map((id) => ({ id })),
          }),
          idempotent: true,
        });
        return {
          calendars: Object.entries(result.calendars ?? {}).map(([id, calendar]) =>
            definedFields({
              id,
              busy: calendar.busy ?? [],
              unavailable: calendar.errors?.length ? true : undefined,
            }),
          ),
        };
      },
    }),
    googleOperation({
      name: "google_calendar_create_event",
      description:
        "Create a calendar event and invite attendees. Pass a date for an all-day event. add_google_meet adds a Meet link.",
      requires: ["write"],
      readOnly: false,
      input: z.object({
        calendar_id: z.string().max(500).default("primary"),
        summary: z.string().trim().min(1).max(1_024),
        ...Times,
        description: z.string().max(8_000).optional(),
        location: z.string().max(1_024).optional(),
        attendees: z.array(z.email().max(320)).max(100).default([]),
        add_google_meet: z.boolean().default(false),
        recurrence: z
          .array(
            z
              .string()
              .regex(/^(RRULE|EXRULE|RDATE|EXDATE)[:;]/)
              .max(500),
          )
          .max(10)
          .optional()
          .describe("RFC 5545 lines, such as RRULE:FREQ=WEEKLY;COUNT=4"),
        send_updates: SendUpdates,
      }),
      async run(input, { api, executionId }) {
        const id = calendarEventId(executionId);
        const times = await eventTimes(api, input.calendar_id, input);
        try {
          const created = await api.json<CalendarEvent>({
            method: "POST",
            url: `${calendarPath(input.calendar_id)}/events`,
            query: {
              sendUpdates: input.send_updates,
              conferenceDataVersion: input.add_google_meet ? 1 : undefined,
            },
            json: definedFields({
              id,
              summary: input.summary,
              description: input.description,
              location: input.location,
              ...times,
              attendees: input.attendees.length
                ? input.attendees.map((email) => ({ email }))
                : undefined,
              recurrence: input.recurrence,
              conferenceData: input.add_google_meet
                ? {
                    createRequest: {
                      requestId: id,
                      conferenceSolutionKey: { type: "hangoutsMeet" },
                    },
                  }
                : undefined,
            }),
            // The fixed id makes a repeated insert fail instead of duplicating the event.
            idempotent: true,
          });
          return event(created);
        } catch (error) {
          if (error instanceof GoogleApiError && error.kind === "conflict") {
            return event(
              await api.json<CalendarEvent>({
                url: `${calendarPath(input.calendar_id)}/events/${id}`,
              }),
            );
          }
          throw error;
        }
      },
    }),
    googleOperation({
      name: "google_calendar_update_event",
      description:
        "Change an event's title, time, place, description, or attendees. Only fields you pass change.",
      requires: ["write"],
      readOnly: false,
      input: z.object({
        calendar_id: z.string().max(500).default("primary"),
        event_id: z.string().min(1).max(1_024),
        summary: z.string().trim().min(1).max(1_024).optional(),
        start: Times.start.optional(),
        end: Times.end,
        duration_minutes: Times.duration_minutes,
        time_zone: Times.time_zone,
        description: z.string().max(8_000).optional(),
        location: z.string().max(1_024).optional(),
        attendees: z
          .array(z.email().max(320))
          .max(100)
          .optional()
          .describe("Replaces the attendee list"),
        send_updates: SendUpdates,
      }),
      async run(input, { api }) {
        const times = input.start
          ? await eventTimes(api, input.calendar_id, { ...input, start: input.start })
          : input.end
            ? { end: (await eventTimes(api, input.calendar_id, { start: input.end })).start }
            : {};
        const updated = await api.json<CalendarEvent>({
          method: "PATCH",
          url: `${calendarPath(input.calendar_id)}/events/${encodeURIComponent(input.event_id)}`,
          query: { sendUpdates: input.send_updates },
          json: definedFields({
            summary: input.summary,
            description: input.description,
            location: input.location,
            ...times,
            attendees: input.attendees?.map((email) => ({ email })),
          }),
          idempotent: true,
        });
        return event(updated);
      },
    }),
    googleOperation({
      name: "google_calendar_delete_event",
      description: "Delete a calendar event and notify its attendees.",
      requires: ["write"],
      readOnly: false,
      input: z.object({
        calendar_id: z.string().max(500).default("primary"),
        event_id: z.string().min(1).max(1_024),
        send_updates: SendUpdates,
      }),
      async run(input, { api }) {
        try {
          await api.request({
            method: "DELETE",
            url: `${calendarPath(input.calendar_id)}/events/${encodeURIComponent(input.event_id)}`,
            query: { sendUpdates: input.send_updates },
            responseType: "none",
          });
        } catch (error) {
          // 410 Gone: it was already deleted, which is the requested end state.
          if (!(error instanceof GoogleApiError && error.status === 410)) throw error;
        }
        return { deleted: true, event_id: input.event_id };
      },
    }),
  ],
};
