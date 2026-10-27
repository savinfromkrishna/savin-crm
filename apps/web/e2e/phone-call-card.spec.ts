import { expect, test } from "@playwright/test";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

// Harness pins TELEPHONY_PROVIDER=emulator (see packages/testkit); no real number is dialed.
// phone_call_place is consequential but runs without a confirmation by default (optional in settings).
test("renders a phone call card that completes from the emulator", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `phone-call-${stamp}@savingroup.test`, "password12", "Phone Call");
  await completeOnboarding(page);

  const botId = activeBotId(page);
  const composer = page.getByPlaceholder(/Message/);
  await composer.fill("place a phone call to confirm the booking");
  await page.keyboard.press("Enter");

  const card = page.getByTestId("phone-call-card");
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card).toContainText(/Confirm the booking/i);
  await expect(card).toContainText("completed", { timeout: 60_000 });
  await captureScreenshot(page, testInfo, "phone-call-card");

  await card.getByRole("button", { name: "Transcript" }).click();
  await expect(card.getByRole("list", { name: "Call transcript" })).toBeVisible();

  await expect
    .poll(
      async () => {
        const history = await rpc<{
          messages: Array<{ blocks: Array<{ kind: string; status?: string }> }>;
        }>(page, "threads/messages", { botId });
        return history.messages
          .flatMap((message) => message.blocks)
          .some((block) => block.kind === "phone_call" && block.status === "completed");
      },
      { timeout: 30_000 },
    )
    .toBe(true);
});
