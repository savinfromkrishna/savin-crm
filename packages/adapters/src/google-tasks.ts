import { z } from "zod";
import {
  definedFields,
  type GoogleServiceDefinition,
  googleOperation,
  googleScope,
} from "./google-tools.js";

const TASKS = "https://tasks.googleapis.com/tasks/v1";

type Task = {
  id?: string;
  title?: string;
  notes?: string;
  status?: string;
  due?: string;
  completed?: string;
  parent?: string;
  webViewLink?: string;
};

function task(item: Task) {
  return definedFields({
    id: item.id,
    title: item.title,
    notes: item.notes,
    done: item.status === "completed",
    due: item.due?.slice(0, 10),
    completed: item.completed,
    parent: item.parent,
    link: item.webViewLink,
  });
}

/** Tasks keeps only the date of a due time. */
function dueDate(value: string | undefined): string | undefined {
  return value ? `${value.slice(0, 10)}T00:00:00.000Z` : undefined;
}

function listPath(list: string): string {
  return `${TASKS}/lists/${encodeURIComponent(list)}/tasks`;
}

const TaskList = z
  .string()
  .max(200)
  .default("@default")
  .describe("Task list id; @default is the user's main list");
const Due = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/)
  .max(40)
  .describe("Due date, YYYY-MM-DD");

const read = {
  id: "read",
  label: "See tasks",
  scopes: [googleScope("tasks.readonly")],
  coveredBy: [googleScope("tasks")],
};
const write = {
  id: "write",
  label: "Create, complete, and delete tasks",
  scopes: [googleScope("tasks")],
};

export const tasksService: GoogleServiceDefinition = {
  slug: "google_tasks",
  name: "Google Tasks",
  description: "Track and complete to-dos",
  permissions: [read, write],
  defaultPermissions: ["read"],
  operations: [
    googleOperation({
      name: "google_tasks_list_task_lists",
      description: "List task lists.",
      requires: ["read"],
      readOnly: true,
      input: z.object({}),
      async run(_input, { api }) {
        const listed = await api.json<{ items?: Array<{ id?: string; title?: string }> }>({
          url: `${TASKS}/users/@me/lists`,
          query: { maxResults: 100 },
        });
        return { lists: (listed.items ?? []).map((item) => ({ id: item.id, title: item.title })) };
      },
    }),
    googleOperation({
      name: "google_tasks_list_tasks",
      description: "List tasks in a list, optionally including completed ones or a due range.",
      requires: ["read"],
      readOnly: true,
      input: z.object({
        task_list: TaskList,
        include_completed: z.boolean().default(false),
        due_after: Due.optional(),
        due_before: Due.optional(),
        page_token: z.string().max(500).optional(),
      }),
      async run(input, { api }) {
        const listed = await api.json<{ items?: Task[]; nextPageToken?: string }>({
          url: listPath(input.task_list),
          query: {
            showCompleted: input.include_completed,
            showHidden: input.include_completed,
            dueMin: dueDate(input.due_after),
            dueMax: dueDate(input.due_before),
            maxResults: 100,
            pageToken: input.page_token,
          },
        });
        return {
          tasks: (listed.items ?? []).map(task),
          ...(listed.nextPageToken ? { next_page_token: listed.nextPageToken } : {}),
        };
      },
    }),
    googleOperation({
      name: "google_tasks_create_task",
      description: "Add a task, optionally with notes and a due date.",
      requires: ["write"],
      readOnly: false,
      input: z.object({
        task_list: TaskList,
        title: z.string().trim().min(1).max(1_024),
        notes: z.string().max(8_000).optional(),
        due: Due.optional(),
        parent_task_id: z.string().max(200).optional().describe("Make this a subtask"),
      }),
      async run(input, { api }) {
        return task(
          await api.json<Task>({
            method: "POST",
            url: listPath(input.task_list),
            query: { parent: input.parent_task_id },
            json: definedFields({
              title: input.title,
              notes: input.notes,
              due: dueDate(input.due),
            }),
          }),
        );
      },
    }),
    googleOperation({
      name: "google_tasks_update_task",
      description: "Rename a task, change its notes or due date, or mark it done or not done.",
      requires: ["write"],
      readOnly: false,
      input: z.object({
        task_list: TaskList,
        task_id: z.string().min(1).max(200),
        title: z.string().trim().min(1).max(1_024).optional(),
        notes: z.string().max(8_000).optional(),
        due: Due.optional(),
        done: z.boolean().optional(),
      }),
      async run(input, { api }) {
        return task(
          await api.json<Task>({
            method: "PATCH",
            url: `${listPath(input.task_list)}/${encodeURIComponent(input.task_id)}`,
            json: {
              ...definedFields({ title: input.title, notes: input.notes, due: dueDate(input.due) }),
              ...(input.done === undefined
                ? {}
                : input.done
                  ? { status: "completed" }
                  : { status: "needsAction", completed: null }),
            },
            idempotent: true,
          }),
        );
      },
    }),
    googleOperation({
      name: "google_tasks_delete_task",
      description: "Delete a task.",
      requires: ["write"],
      readOnly: false,
      input: z.object({ task_list: TaskList, task_id: z.string().min(1).max(200) }),
      async run(input, { api }) {
        await api.request({
          method: "DELETE",
          url: `${listPath(input.task_list)}/${encodeURIComponent(input.task_id)}`,
          responseType: "none",
        });
        return { deleted: true, task_id: input.task_id };
      },
    }),
  ],
};
