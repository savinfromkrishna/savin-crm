import { formatTakeoverTimeLeft, takeoverSecondsLeft } from "@savingroup/core";
import { useEffect, useState } from "react";

/** Time left on the user's control lease; renders nothing without one. */
export function TakeoverTimeLeft({ expiresAt }: { expiresAt: string | null | undefined }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);
  const seconds = takeoverSecondsLeft(expiresAt, now);
  if (seconds === null) return null;
  return (
    <span role="timer" className="ms-1.5 tabular-nums opacity-80">
      {formatTakeoverTimeLeft(seconds)}
    </span>
  );
}
