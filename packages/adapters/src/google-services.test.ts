import { connectorToolRequiresApproval } from "@savingroup/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { calendarEventId } from "./google-calendar.js";
import { documentText } from "./google-docs.js";
import { GOOGLE_SERVICES, googleOperationNamed } from "./google-services.js";
import { hasGooglePermission, pageText } from "./google-tools.js";

const operations = GOOGLE_SERVICES.flatMap((service) =>
  service.operations.map((operation) => ({ service, operation })),
);

describe("google service registry", () => {
  it("names every tool uniquely under its app's prefix", () => {
    const names = operations.map(({ operation }) => operation.name);
    expect(new Set(names).size).toBe(names.length);
    for (const { service, operation } of operations) {
      expect(operation.name.startsWith(`${service.slug}_`), operation.name).toBe(true);
      expect(googleOperationNamed(operation.name)?.service.slug).toBe(service.slug);
    }
  });

  it("lines up declared effects with the approval gate", () => {
    for (const { operation } of operations) {
      // Reads skip approval only through read verbs; writes always need it.
      expect(
        connectorToolRequiresApproval(operation.name, operation.readOnly),
        operation.name,
      ).toBe(!operation.readOnly);
    }
  });

  it("requires only permissions the app defines, and requests HTTPS scopes", () => {
    for (const service of GOOGLE_SERVICES) {
      const ids = new Set(service.permissions.map((permission) => permission.id));
      for (const id of service.defaultPermissions)
        expect(ids.has(id), `${service.slug} ${id}`).toBe(true);
      for (const operation of service.operations) {
        for (const id of operation.requires)
          expect(ids.has(id), `${operation.name} ${id}`).toBe(true);
      }
      for (const permission of service.permissions) {
        for (const scope of [...permission.scopes, ...(permission.coveredBy ?? [])]) {
          expect(scope, `${service.slug} ${permission.id}`).toMatch(/^https:\/\//);
        }
      }
    }
  });

  it("produces model schemas that leave the account parameter to the connector", () => {
    for (const { operation } of operations) {
      const schema = z.toJSONSchema(operation.input, { io: "input" }) as {
        type?: string;
        properties?: Record<string, unknown>;
      };
      expect(schema.type, operation.name).toBe("object");
      expect(Object.keys(schema.properties ?? {}), operation.name).not.toContain("account");
    }
  });

  it("treats broader granted scopes as covering narrower permissions", () => {
    const gmail = GOOGLE_SERVICES.find((service) => service.slug === "gmail")!;
    const read = gmail.permissions.find((permission) => permission.id === "read")!;
    expect(hasGooglePermission(read, ["https://www.googleapis.com/auth/gmail.modify"])).toBe(true);
    expect(hasGooglePermission(read, ["https://www.googleapis.com/auth/gmail.compose"])).toBe(
      false,
    );
  });
});

describe("google helpers", () => {
  it("pages text inside the tool result budget", () => {
    const text = "x".repeat(20_000);
    const first = pageText(text, 0, 50_000);
    expect(first.text).toHaveLength(9_000);
    expect(first.next_offset).toBe(9_000);
    expect(pageText(text, 19_990).next_offset).toBeUndefined();
  });

  it("derives a stable base32hex calendar event id from the call", () => {
    const id = calendarEventId("exec-1");
    expect(id).toMatch(/^[a-v0-9]{5,1024}$/);
    expect(calendarEventId("exec-1")).toBe(id);
    expect(calendarEventId("exec-2")).not.toBe(id);
  });

  it("keeps headings, bullets, and tables when reading a document", () => {
    expect(
      documentText([
        {
          paragraph: {
            paragraphStyle: { namedStyleType: "HEADING_1" },
            elements: [{ textRun: { content: "Plan\n" } }],
          },
        },
        { paragraph: { bullet: {}, elements: [{ textRun: { content: "Ship it\n" } }] } },
        {
          table: {
            tableRows: [
              {
                tableCells: [
                  { content: [{ paragraph: { elements: [{ textRun: { content: "A\n" } }] } }] },
                  { content: [{ paragraph: { elements: [{ textRun: { content: "B\n" } }] } }] },
                ],
              },
            ],
          },
        },
      ]),
    ).toBe("# Plan\n- Ship it\n| A | B |");
  });
});
