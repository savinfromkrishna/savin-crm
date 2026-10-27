import { Trans, useLingui } from "@lingui/react/macro";
import type { MessageBlock, PhoneCall } from "@savingroup/contracts";
import { isPhoneCallTerminal } from "@savingroup/contracts";
import { maskPhoneNumber, phoneCallDurationLabel } from "@savingroup/core";
import { Button } from "@savingroup/ui-web";
import { Badge } from "@savingroup/ui-web/components/ui/badge";
import { Card, CardContent } from "@savingroup/ui-web/components/ui/card";
import { useState } from "react";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

function StatusLabel({ status }: { status: PhoneCall["status"] }) {
  switch (status) {
    case "queued":
      return <Trans>queued</Trans>;
    case "ringing":
      return <Trans>ringing</Trans>;
    case "in_progress":
      return <Trans>on the call</Trans>;
    case "completed":
      return <Trans>completed</Trans>;
    case "no_answer":
      return <Trans>no answer</Trans>;
    case "busy":
      return <Trans>busy</Trans>;
    case "cancelled":
      return <Trans>cancelled</Trans>;
    default:
      return <Trans>failed</Trans>;
  }
}

export function PhoneCallCard({ block }: { block: Extract<MessageBlock, { kind: "phone_call" }> }) {
  const { t } = useLingui();
  const [call, setCall] = useState<PhoneCall | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = !isPhoneCallTerminal(block.status);

  async function hangUp() {
    setBusy(true);
    setError(null);
    try {
      await rpc.phoneCalls.hangup({ callId: block.callId });
    } catch (cause) {
      setError(errorText(cause, t`Could not hang up`));
    } finally {
      setBusy(false);
    }
  }

  async function loadTranscript() {
    setBusy(true);
    setError(null);
    try {
      setCall(await rpc.phoneCalls.get({ callId: block.callId }));
    } catch (cause) {
      setError(errorText(cause, t`Could not load the transcript`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card size="sm" className="w-80 max-w-full" data-testid="phone-call-card">
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <span className="font-medium" dir="auto">
            {block.purpose}
          </span>
          <Badge
            variant="secondary"
            className={
              block.status === "failed" || block.status === "no_answer" || block.status === "busy"
                ? "text-destructive"
                : block.status === "completed"
                  ? "text-success"
                  : "text-muted-foreground"
            }
          >
            <StatusLabel status={block.status} />
          </Badge>
        </div>
        <span className="text-muted-foreground" dir="ltr">
          {maskPhoneNumber(block.to)}
          {block.durationSec !== undefined ? ` · ${phoneCallDurationLabel(block.durationSec)}` : ""}
        </span>
        {block.summary ? <p dir="auto">{block.summary}</p> : null}
        {error ? (
          <p role="alert" className="text-[13px] text-destructive">
            {error}
          </p>
        ) : null}
        {live ? (
          <Button
            size="sm"
            variant="outline"
            className="self-start"
            disabled={busy}
            onClick={() => void hangUp()}
          >
            <Trans>Hang up</Trans>
          </Button>
        ) : call ? (
          <ol className="flex flex-col gap-1 text-[13px]" aria-label={t`Call transcript`}>
            {call.transcript.map((turn, index) => (
              <li key={`${turn.at}-${index}`} dir="auto">
                <span className="text-muted-foreground">
                  {turn.role === "bot" ? <Trans>Bot</Trans> : <Trans>Callee</Trans>}
                </span>{" "}
                {turn.text}
              </li>
            ))}
          </ol>
        ) : block.status === "completed" ? (
          <Button
            size="sm"
            variant="ghost"
            className="self-start"
            disabled={busy}
            onClick={() => void loadTranscript()}
          >
            <Trans>Transcript</Trans>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
