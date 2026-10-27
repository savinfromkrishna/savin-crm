import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

const catalog = [
  {
    connectorId: "google",
    slug: "gmail",
    name: "Gmail",
    logo: null,
    connected: true,
    noAuth: false,
  },
  {
    connectorId: "google",
    slug: "google_calendar",
    name: "Google Calendar",
    logo: null,
    connected: false,
    noAuth: false,
  },
  {
    connectorId: "google",
    slug: "google_drive",
    name: "Google Drive",
    logo: null,
    connected: false,
    noAuth: false,
  },
  {
    connectorId: "google",
    slug: "youtube",
    name: "YouTube",
    logo: null,
    connected: false,
    noAuth: false,
  },
];

const connections = [
  {
    id: "conn-work",
    connectorId: "google",
    provider: "gmail",
    displayName: "alice@example.test",
    status: "connected",
    capabilities: [],
    createdAt: "2026-10-11T00:00:00.000Z",
    account: {
      id: "account-alice",
      email: "alice@example.test",
      status: "ok",
      permissions: [
        { id: "read", label: "Read email", granted: true },
        { id: "compose", label: "Draft and send email", granted: false },
        { id: "organize", label: "Label, archive, and trash email", granted: false },
      ],
      error: null,
    },
  },
  {
    id: "conn-old",
    connectorId: "google",
    provider: "gmail",
    displayName: "Old account",
    status: "connected",
    capabilities: [],
    createdAt: "2026-10-01T00:00:00.000Z",
    account: {
      id: "account-old",
      email: "old@example.test",
      status: "reconnect",
      permissions: [{ id: "read", label: "Read email", granted: true }],
      error: "Token has been expired or revoked.",
    },
  },
];

test("Google accounts show granted permissions, reconnect, and recent activity", async ({
  page,
}, testInfo) => {
  const begun: unknown[] = [];
  await page.route("**/rpc/connections/catalog", (route) =>
    route.fulfill({ json: { json: catalog } }),
  );
  await page.route("**/rpc/connections/list", (route) =>
    route.fulfill({ json: { json: connections } }),
  );
  await page.route("**/rpc/connections/tools", (route) =>
    route.fulfill({
      json: {
        json: [
          { name: "gmail_search_messages", description: "Search Gmail" },
          { name: "gmail_get_message", description: "Read one message" },
        ],
      },
    }),
  );
  await page.route("**/rpc/connections/activity", (route) =>
    route.fulfill({
      json: {
        json: [
          {
            id: "a2",
            action: "gmail_search_messages",
            status: "failed",
            account: "old@example.test",
            error: "Google access for old@example.test expired or was revoked.",
            detail: null,
            createdAt: "2026-10-11T00:00:00.000Z",
          },
          {
            id: "a1",
            action: "authorize",
            status: "succeeded",
            account: "alice@example.test",
            error: null,
            detail: "Read email",
            createdAt: "2026-10-10T00:00:00.000Z",
          },
        ],
      },
    }),
  );
  await page.route("**/rpc/connections/begin", (route) => {
    begun.push(route.request().postDataJSON());
    return route.fulfill({
      status: 400,
      json: {
        json: { defined: false, code: "BAD_REQUEST", status: 400, message: "Stopped in test" },
      },
    });
  });

  await signup(
    page,
    `google-integrations-${Date.now()}@savingroup.test`,
    "password12",
    "Google Test",
  );
  await completeOnboarding(page);
  await page.getByText("Integrations").click();
  await page.getByTestId("connection-tile-gmail").click();

  const accounts = page.getByTestId("connection-accounts");
  await expect(accounts.getByText("Read email").first()).toBeVisible();
  await expect(accounts.getByRole("button", { name: "Allow Draft and send email" })).toBeVisible();
  await expect(accounts.getByText("old@example.test")).toBeVisible();
  await expect(accounts.getByRole("button", { name: "Reconnect", exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "google-accounts");

  const activity = page.getByTestId("connection-activity");
  await activity.getByRole("button", { name: "Activity" }).click();
  await expect(activity.getByText("Gmail search messages")).toBeVisible();
  await expect(activity.getByText("Authorization")).toBeVisible();
  await captureScreenshot(page, testInfo, "google-activity");

  await accounts.getByRole("button", { name: "Allow Draft and send email" }).click();
  await expect
    .poll(() => begun)
    .toEqual([
      {
        json: {
          connectorId: "google",
          provider: "gmail",
          displayName: "Gmail 3",
          permissions: ["compose"],
          accountHint: "alice@example.test",
        },
      },
    ]);
});

test("the connection result page explains a failed Google sign-in", async ({ page }, testInfo) => {
  await page.goto("/connections/done?connector=google&result=session&app=gmail");
  await expect(page.getByText("Couldn't connect")).toBeVisible();
  await expect(
    page.getByText(
      "Sign in to Savingroup in this browser as the person who started this, then try again.",
    ),
  ).toBeVisible();
  await captureScreenshot(page, testInfo, "google-connection-failed");
});
