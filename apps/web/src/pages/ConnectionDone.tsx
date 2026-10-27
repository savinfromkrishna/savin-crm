import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@savingroup/ui-web";
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

/** Popups opened to connect an app; the result page closes them itself. */
const CONNECT_POPUPS = new Set(["savingroup-plugin-connect", "savingroup-app-connect"]);

/** Where the server sends the browser after an app connection finishes or fails. */
export function ConnectionDonePage() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const result = params.get("result");
  const connected = result === "connected";
  const popup = CONNECT_POPUPS.has(window.name);
  useEffect(() => {
    // The opener polls the connection, so the popup has nothing left to show.
    if (connected && popup) window.close();
  }, [connected, popup]);
  const messages: Record<string, string> = {
    expired: t`This sign-in expired. Start again from Savingroup.`,
    session: t`Sign in to Savingroup in this browser as the person who started this, then try again.`,
    denied: t`Access wasn't granted.`,
    not_granted: t`No permissions were granted. Try again and allow access.`,
    offline: t`Google didn't allow ongoing access. Remove Savingroup from your Google Account's third-party connections, then connect again.`,
    removed: t`The connection was removed before sign-in finished.`,
  };
  return (
    <div className="grid min-h-screen place-items-center bg-background p-6 text-center">
      <div>
        <div className="text-lg text-foreground">
          {connected ? <Trans>Connected</Trans> : <Trans>Couldn't connect</Trans>}
        </div>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          {connected ? (
            <Trans>You can close this window.</Trans>
          ) : (
            (messages[result ?? ""] ?? t`Something went wrong. Try again.`)
          )}
        </p>
        {popup ? null : (
          <Button type="button" className="mt-5" onClick={() => navigate("/app")}>
            <Trans>Return to Savingroup</Trans>
          </Button>
        )}
      </div>
    </div>
  );
}
