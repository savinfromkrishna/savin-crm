import type { MessageReaction, ThreadMessage, ThreadSnapshot } from "@savingroup/contracts";
import {
  isRunTerminalEvent,
  runThreadSubscription,
  withLiveStreamingProgress,
} from "@savingroup/core";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { newClientId } from "./client-id";
import { getResponseStreamingEnabled, subscribeResponseStreaming } from "./response-streaming";
import { rpc } from "./rpc";
import {
  applyThreadSendReceipt,
  clearActiveThreadRuns,
  isThreadSnapshotEvent,
  prependThreadMessagePage,
  reconcileRefreshedThread,
  reduceThreadSnapshot,
} from "./thread-events";

/** A threads.get that hangs gives way to the subscription's head-and-retry path. */
const SNAPSHOT_TIMEOUT_MS = 2_000;
/** Ended runs remembered, so a late send receipt cannot bring one back. */
const ENDED_RUNS_KEPT = 100;

export type BotThreadMessage = {
  text?: string;
  clientNonce: string;
  artifactIds?: string[];
  replyToMessageId?: string;
  replyQuote?: string;
};

/**
 * One bot's conversation away from the chat page: the same snapshot, live
 * events and actions the chat uses, so a panel shows the same thread. A null
 * bot keeps it idle.
 */
export function useBotThread(botId: string | null) {
  const [latest, setLatest] = useState<ThreadSnapshot | null>(null);
  const snapshotRef = useRef<ThreadSnapshot | null>(null);
  const botRef = useRef(botId);
  botRef.current = botId;
  // Loading earlier messages marks the thread so a refresh keeps them.
  const expandedThread = useRef<string | null>(null);
  const endedRuns = useRef(new Set<string>());
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingOlderRef = useRef(false);
  const streamResponses = useSyncExternalStore(
    subscribeResponseStreaming,
    getResponseStreamingEnabled,
    () => false,
  );

  const commit = useCallback((next: ThreadSnapshot | null) => {
    snapshotRef.current = next;
    setLatest(next);
  }, []);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const id = botRef.current;
      if (!id) return null;
      const snap = await rpc.threads.get({ botId: id }, signal ? { signal } : undefined);
      if (botRef.current !== id) return snap;
      const previous = snapshotRef.current?.botId === id ? snapshotRef.current : null;
      commit(
        reconcileRefreshedThread(previous, snap, null, expandedThread.current === snap.threadId)
          .snapshot,
      );
      return snap;
    },
    [commit],
  );

  useEffect(() => {
    commit(null);
    expandedThread.current = null;
    if (!botId) return;
    const abort = new AbortController();
    const snapshotSignal = () =>
      AbortSignal.any([abort.signal, AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS)]);
    void runThreadSubscription({
      signal: abort.signal,
      loadInitial: () => load(snapshotSignal()),
      loadHead: () => rpc.threads.head({ botId }, { signal: snapshotSignal() }),
      refresh: () => load(snapshotSignal()),
      currentSnapshot: () => snapshotRef.current,
      subscribe: (cursor) => rpc.threads.subscribe({ botId, cursor }, { signal: abort.signal }),
      beforeEvent: (event) => {
        if (!isRunTerminalEvent(event) || !event.runId) return;
        endedRuns.current.add(event.runId);
        if (endedRuns.current.size > ENDED_RUNS_KEPT) {
          const oldest = endedRuns.current.values().next().value;
          if (oldest !== undefined) endedRuns.current.delete(oldest);
        }
      },
      applyEvent: (event) => {
        if (isThreadSnapshotEvent(event)) commit(reduceThreadSnapshot(snapshotRef.current, event));
      },
      onEvent: (event) => {
        // A paused or finished run settles its cards and reply in the stored thread.
        if (isRunTerminalEvent(event) || event.type === "run.waiting_input") {
          void load().catch(() => undefined);
        }
      },
    });
    return () => abort.abort();
  }, [botId, commit, load]);

  const refresh = useCallback(async () => {
    await load();
  }, [load]);

  const send = useCallback(
    async (message: BotThreadMessage) => {
      const id = botRef.current;
      if (!id) return;
      const sent = await rpc.threads.send({ botId: id, ...message });
      if (botRef.current !== id) return;
      commit(
        applyThreadSendReceipt(
          snapshotRef.current,
          { botId: id, runId: sent.runId, taskId: sent.taskId },
          endedRuns.current,
        ),
      );
      void load().catch(() => undefined);
    },
    [commit, load],
  );

  const stop = useCallback(async () => {
    const id = botRef.current;
    if (!id) return;
    await rpc.threads.stop({ botId: id });
    if (botRef.current !== id) return;
    // Clear the run now so an older refresh still in flight cannot bring it back.
    const current = snapshotRef.current;
    if (current?.botId === id) commit(clearActiveThreadRuns(current));
    await load().catch(() => undefined);
  }, [commit, load]);

  const answer = useCallback(
    async (message: ThreadMessage, text: string, username?: string) => {
      const id = botRef.current;
      if (!id) return;
      await rpc.threads.answer({
        botId: id,
        runId: message.runId ?? "",
        messageId: message.id,
        answer: text,
        ...(username ? { username } : {}),
      });
      if (botRef.current === id) await load();
    },
    [load],
  );

  const react = useCallback(async (message: ThreadMessage, reaction: MessageReaction) => {
    const id = botRef.current;
    if (!id) return;
    await rpc.threads.react({
      botId: id,
      messageId: message.id,
      reaction,
      clientNonce: newClientId(),
    });
  }, []);

  const loadOlder = useCallback(async () => {
    const id = botRef.current;
    const current = snapshotRef.current;
    if (!id || current?.botId !== id || current.olderCursor == null || loadingOlderRef.current) {
      return;
    }
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const page = await rpc.threads.messages({ botId: id, before: current.olderCursor });
      if (botRef.current !== id) return;
      expandedThread.current = page.threadId;
      commit(prependThreadMessagePage(snapshotRef.current, page));
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [commit]);

  const snapshot = useMemo(
    () => withLiveStreamingProgress(latest?.botId === botId ? latest : null, streamResponses),
    [botId, latest, streamResponses],
  );

  return { snapshot, loadingOlder, refresh, send, stop, answer, react, loadOlder };
}

export type BotThread = ReturnType<typeof useBotThread>;
