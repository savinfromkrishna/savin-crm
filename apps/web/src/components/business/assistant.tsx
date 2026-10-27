import { useLingui } from "@lingui/react/macro";
import type {
  Bot,
  BusinessActionId,
  BusinessTeamRoleKey,
  MessageReaction,
  ThreadMessage,
} from "@savingroup/contracts";
import {
  ATTACHMENT_MAX_COUNT,
  attachmentSizeLabel,
  BUSINESS_TEAM_SPAWN_KEYS,
  businessToolName,
} from "@savingroup/contracts";
import type { ComposerMention } from "@savingroup/core";
import {
  inferAttachmentMimeType,
  isActive,
  latestAnswerableAskMessageId,
  userVisibleMessages,
} from "@savingroup/core";
import type { GroupAvatarMember } from "@savingroup/ui-web";
import {
  BotAvatar,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Spinner,
} from "@savingroup/ui-web";
import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  Building2,
  ChevronDown,
  Contact,
  Handshake,
  MessageSquare,
  ReceiptText,
  ShoppingCart,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { getMaxUploadSizeBytes } from "../../lib/bootstrap";
import { newClientId } from "../../lib/client-id";
import {
  getComposerEnterToSend,
  subscribeComposerEnterToSend,
} from "../../lib/composer-enter-to-send-pref";
import { readFileAsBase64, revokePendingAttachmentPreviews } from "../../lib/pending-attachments";
import { compactRosterStatusLabel } from "../../lib/roster-status";
import { rpc } from "../../lib/rpc";
import { readSeenRunErrorIds, rememberSeenRunErrorId } from "../../lib/run-error-storage";
import { activeThreadRuns, threadRunError } from "../../lib/thread-events";
import { getToolActivityEnabled, subscribeToolActivity } from "../../lib/tool-activity-preference";
import type { BotThread } from "../../lib/use-bot-thread";
import { useBotThread } from "../../lib/use-bot-thread";
import { errorText } from "../../lib/user-error";
import { ResizableSidePanel } from "../../pages/ResizableSidePanel";
import type { PendingAttachment } from "../../pages/Shell";
import { Composer, Transcript } from "../../pages/Shell";
import { lazyOverlay } from "../ErrorBoundary";
import { BusinessBotsContext } from "./records";
import type { BusinessApp } from "./shell";

const PeerMessagesOverlay = lazyOverlay(() =>
  import("../../pages/PeerMessagesOverlay").then((module) => module.PeerMessagesOverlay),
);

/**
 * The business assistant: the space's bots, docked beside CRM OS and ERP OS.
 * It is the bot's own chat thread, so what is asked here continues in chat,
 * and the bot works through the same permission-checked crm_* and erp_* tools.
 */

/** A record the person asked about. Messages carry its ref, which the bot looks up. */
export type AssistantRecord = {
  kind: "company" | "contact" | "lead" | "deal" | "product" | "order" | "invoice";
  /** Ref, SKU or name: what the bot searches by. */
  ref: string;
  /** Title or customer shown beside the ref. */
  name?: string | null;
  /** Lead status, deal stage, or order or invoice status, to offer what fits. */
  status?: string;
};

const RECORD_ICONS: Record<AssistantRecord["kind"], LucideIcon> = {
  company: Building2,
  contact: Contact,
  lead: Target,
  deal: Handshake,
  product: Boxes,
  order: ShoppingCart,
  invoice: ReceiptText,
};

const OPEN_KEY = "savingroup.business.assistantOpen";
const BOT_KEY = "savingroup.business.assistantBot";
const TEAM_ORDER: readonly BusinessTeamRoleKey[] = [
  "operator",
  "sales",
  "operations",
  "finance",
  "analyst",
  "steward",
];

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The choice only lasts this visit when storage is unavailable.
  }
}

/**
 * Open on wide screens until the person closes it, so the team is in view from
 * the first visit; on a phone the panel would cover the page.
 */
function readOpen(): boolean {
  if (readStored(OPEN_KEY) === "false") return false;
  return typeof window.matchMedia === "function" && window.matchMedia("(min-width: 48rem)").matches;
}

function teamRole(bot: Pick<Bot, "spawnKey">): BusinessTeamRoleKey | undefined {
  return TEAM_ORDER.find((role) => BUSINESS_TEAM_SPAWN_KEYS[role] === bot.spawnKey);
}

/** The business team first, in role order, then the space's other bots. */
export function orderAssistantBots(bots: readonly Bot[]): Bot[] {
  const rank = (bot: Bot) => {
    const role = teamRole(bot);
    return role ? TEAM_ORDER.indexOf(role) : TEAM_ORDER.length;
  };
  return [...bots].sort((a, b) => rank(a) - rank(b));
}

/** Who answers by default: the Operator, else the role that owns the section. */
export function defaultAssistantBot(
  bots: readonly Bot[],
  app: BusinessApp,
  section: string,
): Bot | null {
  const owner: BusinessTeamRoleKey =
    app === "crm"
      ? section === "analytics"
        ? "analyst"
        : section === "agents" || section === "operations"
          ? "steward"
          : "sales"
      : section === "invoices" || section === "compliance"
        ? "finance"
        : "operations";
  for (const role of ["operator", owner, "analyst"] as const) {
    const bot = bots.find((candidate) => candidate.spawnKey === BUSINESS_TEAM_SPAWN_KEYS[role]);
    if (bot) return bot;
  }
  return bots[0] ?? null;
}

/** False when the bot's owner switched off a tool the request depends on. */
export function botCanRun(
  bot: Pick<Bot, "disabledBuiltinTools">,
  needs: readonly BusinessActionId[],
) {
  return needs.every((id) => !bot.disabledBuiltinTools.includes(businessToolName(id)));
}

type Prompt = { text: string; needs: readonly BusinessActionId[] };

/** Starting points for the page, limited to what the bot is allowed to do. */
function useAssistantPrompts(
  app: BusinessApp,
  section: string,
  record: AssistantRecord | null,
  bot: Bot,
): string[] {
  const { t } = useLingui();
  return useMemo(() => {
    const pipeline: Prompt = { text: t`Summarize the pipeline`, needs: ["crm.deal.search"] };
    const approvals: Prompt = { text: t`What needs my approval?`, needs: ["erp.order.search"] };
    const nextStep = (search: BusinessActionId): Prompt => ({
      text: t`Suggest the next step`,
      needs: [search],
    });
    let prompts: Prompt[];
    if (record) {
      switch (record.kind) {
        case "company":
          prompts = [
            { text: t`Summarize this account`, needs: ["crm.company.search", "crm.deal.search"] },
            { text: t`Draft a check-in email`, needs: ["crm.company.search"] },
          ];
          break;
        case "contact":
          prompts = [{ text: t`Draft an intro email`, needs: ["crm.contact.search"] }];
          break;
        case "lead":
          prompts = [
            nextStep("crm.lead.search"),
            { text: t`Draft a follow-up email`, needs: ["crm.lead.search"] },
          ];
          break;
        case "deal":
          prompts =
            record.status === "won" || record.status === "lost"
              ? []
              : [
                  nextStep("crm.deal.search"),
                  { text: t`Draft a proposal email`, needs: ["crm.deal.search"] },
                  {
                    text: t`Prepare a sales order`,
                    needs: ["crm.deal.search", "erp.order.create_draft"],
                  },
                ];
          break;
        case "product":
          prompts = [{ text: t`Suggest a reorder quantity`, needs: ["erp.inventory.check"] }];
          break;
        case "order":
          prompts =
            record.status === "draft"
              ? [
                  {
                    text: t`Check stock for each line`,
                    needs: ["erp.order.get", "erp.inventory.check"],
                  },
                ]
              : record.status === "pending_approval"
                ? [{ text: t`Summarize it for approval`, needs: ["erp.order.get"] }]
                : [];
          break;
        case "invoice":
          prompts =
            record.status === "issued"
              ? [{ text: t`Draft a payment reminder`, needs: ["erp.invoice.get"] }]
              : [];
          break;
      }
    } else if (app === "crm") {
      switch (section) {
        case "companies":
          prompts = [
            {
              text: t`Which accounts need attention?`,
              needs: ["crm.company.search", "crm.deal.search"],
            },
            {
              text: t`Find duplicate companies`,
              needs: ["crm.company.find_duplicates"],
            },
          ];
          break;
        case "contacts":
          prompts = [
            {
              text: t`Find duplicate contacts`,
              needs: ["crm.contact.find_duplicates"],
            },
          ];
          break;
        case "leads":
          prompts = [
            { text: t`Which leads should I work on first?`, needs: ["crm.lead.search"] },
            { text: t`Qualify the new leads`, needs: ["crm.lead.search", "crm.lead.qualify"] },
          ];
          break;
        case "deals":
          prompts = [{ text: t`Which deals are at risk?`, needs: ["crm.deal.search"] }, pipeline];
          break;
        case "activities":
        case "notes":
        case "calls":
          prompts = [{ text: t`What’s overdue?`, needs: ["crm.activity.list"] }];
          break;
        case "analytics":
          prompts = [
            pipeline,
            {
              text: t`Analyze win rate and conversion bottlenecks`,
              needs: ["crm.deal.search", "crm.lead.search"],
            },
          ];
          break;
        case "agents":
        case "operations":
        case "workspace":
          prompts = [
            {
              text: t`Audit CRM data hygiene and duplicates`,
              needs: ["crm.company.find_duplicates", "crm.contact.find_duplicates"],
            },
            {
              text: t`Which leads are unassigned or stale?`,
              needs: ["crm.lead.search"],
            },
          ];
          break;
        default:
          prompts = [
            pipeline,
            { text: t`What needs follow-up today?`, needs: ["crm.activity.list"] },
          ];
      }
    } else {
      switch (section) {
        case "products":
        case "inventory":
          prompts = [
            {
              text: t`Which products need restocking?`,
              needs: ["erp.product.search", "erp.inventory.check"],
            },
          ];
          break;
        case "orders":
          prompts = [
            approvals,
            {
              text: t`Which confirmed orders still need an invoice?`,
              needs: ["erp.order.search", "erp.invoice.search"],
            },
          ];
          break;
        case "invoices":
          prompts = [
            { text: t`Which invoices are unpaid?`, needs: ["erp.invoice.search"] },
            { text: t`Draft reminders for unpaid invoices`, needs: ["erp.invoice.search"] },
          ];
          break;
        default:
          prompts = [
            approvals,
            { text: t`Summarize this month’s sales`, needs: ["erp.order.search"] },
          ];
      }
    }
    return prompts.filter((prompt) => botCanRun(bot, prompt.needs)).map((prompt) => prompt.text);
  }, [app, bot, record, section, t]);
}

/** How a message names the record: its kind, ref and title, e.g. "Lead L-3 (Line upgrade)". */
function useRecordReference(): (record: AssistantRecord) => string {
  const { t } = useLingui();
  return useCallback(
    (record) => {
      const kind = {
        company: t`Company`,
        contact: t`Contact`,
        lead: t`Lead`,
        deal: t`Deal`,
        product: t`Product`,
        order: t`Order`,
        invoice: t`Invoice`,
      }[record.kind];
      return record.name ? `${kind} ${record.ref} (${record.name})` : `${kind} ${record.ref}`;
    },
    [t],
  );
}

export type BusinessAssistant = {
  /** Null until the space's bots load, or when the space has none. */
  bot: Bot | null;
  bots: readonly Bot[];
  open: boolean;
  record: AssistantRecord | null;
  thread: BotThread;
  /** Live run status of the bot's thread once it is open, else the roster's. */
  status: string;
  /** Bumped by each explicit open, so the panel takes focus and offers prompts again. */
  openCount: number;
  toggle: () => void;
  close: () => void;
  ask: (record?: AssistantRecord) => void;
  pickBot: (botId: string) => void;
  clearRecord: () => void;
};

/** Panel state for a business page; the thread connects on first open. */
export function useBusinessAssistant(app: BusinessApp, section: string): BusinessAssistant {
  const roster = useContext(BusinessBotsContext);
  const bots = useMemo(() => orderAssistantBots(roster), [roster]);
  const botKey = `${BOT_KEY}.${app}`;
  const [chosenId, setChosenId] = useState(() => readStored(botKey));
  // The bot that answered when the panel opened stays for the visit, so moving
  // between sections does not swap one conversation for another.
  const [heldId, setHeldId] = useState<string | null>(null);
  const bot =
    bots.find((candidate) => candidate.id === chosenId) ??
    bots.find((candidate) => candidate.id === heldId) ??
    defaultAssistantBot(bots, app, section);
  const botId = bot?.id ?? null;
  const [open, setOpen] = useState(readOpen);
  const [connected, setConnected] = useState(open);
  const [record, setRecord] = useState<AssistantRecord | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const thread = useBotThread(connected ? botId : null);
  const runs = activeThreadRuns(thread.snapshot);
  const status = thread.snapshot
    ? (runs.find((run) => isActive(run.status))?.status ?? "idle")
    : (bot?.status ?? "idle");

  // Also holds the bot of a panel that reopened from the last visit.
  useEffect(() => {
    if (connected && botId) setHeldId((held) => held ?? botId);
  }, [botId, connected]);

  const show = useCallback(() => {
    setOpen(true);
    setConnected(true);
    setOpenCount((count) => count + 1);
    writeStored(OPEN_KEY, "true");
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    writeStored(OPEN_KEY, "false");
  }, []);
  const toggle = useCallback(() => {
    if (open) close();
    else show();
  }, [close, open, show]);
  const ask = useCallback(
    (next?: AssistantRecord) => {
      setRecord(next ?? null);
      show();
    },
    [show],
  );
  const pickBot = useCallback(
    (botId: string) => {
      setChosenId(botId);
      writeStored(botKey, botId);
    },
    [botKey],
  );
  const clearRecord = useCallback(() => setRecord(null), []);

  return {
    bot,
    bots,
    open,
    record,
    thread,
    status,
    openCount,
    toggle,
    close,
    ask,
    pickBot,
    clearRecord,
  };
}

const AssistantContext = createContext<BusinessAssistant | null>(null);
export const AssistantProvider = AssistantContext;

/** The page's assistant, or null outside a business page. */
export function useAssistant(): BusinessAssistant | null {
  return useContext(AssistantContext);
}

// Plain buttons: Button sizes every svg inside it, which would shrink the avatar.
const askClass =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[0.8rem] font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50";

/** Header control that opens the assistant. */
export function AssistantButton({ assistant }: { assistant: BusinessAssistant }) {
  const { t } = useLingui();
  const { bot } = assistant;
  if (!bot) return null;
  const waiting = assistant.status === "waiting_input";
  const name = bot.name;
  return (
    <button
      type="button"
      aria-pressed={assistant.open}
      data-testid="assistant-toggle"
      onClick={assistant.toggle}
      className={cn(
        askClass,
        "border",
        assistant.open
          ? "border-transparent bg-secondary text-secondary-foreground"
          : "border-border bg-background hover:bg-muted dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
      )}
    >
      <span className="relative">
        <BotAvatar color={bot.color} identity={bot.id} size={18} status={assistant.status} />
        {waiting ? (
          <span
            aria-hidden="true"
            className="absolute -inset-e-0.5 -top-0.5 size-2 rounded-full bg-warning ring-2 ring-background"
          />
        ) : null}
      </span>
      <span className="sr-only sm:not-sr-only">{t`Ask ${name}`}</span>
      {waiting ? (
        <span className="sr-only">{compactRosterStatusLabel("waiting_input")}</span>
      ) : null}
    </button>
  );
}

/** Opens the assistant about a record, from that record's dialog. */
export function AskAssistantButton({
  record,
  onAsk,
  className,
}: {
  record: AssistantRecord;
  /** Called first, so the dialog can close before the panel opens. */
  onAsk?: () => void;
  className?: string;
}) {
  const { t } = useLingui();
  const assistant = useAssistant();
  const bot = assistant?.bot;
  if (!assistant || !bot) return null;
  const name = bot.name;
  return (
    <button
      type="button"
      data-testid="assistant-ask"
      className={cn(askClass, "hover:bg-muted dark:hover:bg-muted/50", className)}
      onClick={() => {
        onAsk?.();
        assistant.ask(record);
      }}
    >
      <BotAvatar color={bot.color} identity={bot.id} size={16} />
      {t`Ask ${name}`}
    </button>
  );
}

/** Asks about one record straight from its row in a list or an overview. */
export function AskRowButton({ record }: { record: AssistantRecord }) {
  const { t } = useLingui();
  const assistant = useAssistant();
  const bot = assistant?.bot;
  if (!assistant || !bot) return null;
  const name = bot.name;
  return (
    <button
      type="button"
      data-testid="assistant-ask-row"
      aria-label={t`Ask ${name}`}
      title={t`Ask ${name}`}
      onClick={(event) => {
        // The row opens the record; this asks about it instead.
        event.stopPropagation();
        assistant.ask(record);
      }}
      className="grid size-7 place-items-center rounded-lg outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <BotAvatar color={bot.color} identity={bot.id} size={18} />
    </button>
  );
}

/** The docked panel; resizable on wide screens, over the page on phones. */
export function AssistantPanel({
  assistant,
  app,
  section,
}: {
  assistant: BusinessAssistant;
  app: BusinessApp;
  section: string;
}) {
  return (
    <ResizableSidePanel open={assistant.open} panel="assistant" label={assistant.bot?.name}>
      {assistant.open && assistant.bot ? (
        <AssistantConversation
          key={assistant.bot.id}
          assistant={assistant}
          bot={assistant.bot}
          app={app}
          section={section}
        />
      ) : null}
    </ResizableSidePanel>
  );
}

const iconButtonClass =
  "grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50";

function AssistantConversation({
  assistant,
  bot,
  app,
  section,
}: {
  assistant: BusinessAssistant;
  bot: Bot;
  app: BusinessApp;
  section: string;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const { record, bots, openCount, clearRecord } = assistant;
  const { snapshot, loadingOlder, refresh, send, stop, answer, react, loadOlder } =
    assistant.thread;
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sendingRef = useRef(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const pendingRef = useRef(pendingAttachments);
  pendingRef.current = pendingAttachments;
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<ThreadMessage | null>(null);
  const [replyQuote, setReplyQuote] = useState<string | null>(null);
  const [scrollRequest, setScrollRequest] = useState<{ messageId: string; nonce: number } | null>(
    null,
  );
  const jumpCount = useRef(0);
  const [dismissedRunErrorIds, setDismissedRunErrorIds] =
    useState<ReadonlySet<string>>(readSeenRunErrorIds);
  const [peer, setPeer] = useState<{ peerBotId: string; peerBotName: string } | null>(null);
  // Prompts help start a conversation; a send or an answer puts them away until the next open.
  const [promptsUsedAt, setPromptsUsedAt] = useState<number | null>(null);
  const showToolActivity = useSyncExternalStore(
    subscribeToolActivity,
    getToolActivityEnabled,
    () => true,
  );
  const enterToSend = useSyncExternalStore(
    subscribeComposerEnterToSend,
    getComposerEnterToSend,
    () => false,
  );
  const prompts = useAssistantPrompts(app, section, record, bot);
  const reference = useRecordReference();

  const runs = activeThreadRuns(snapshot);
  const workingRuns = runs.filter((run) => ["running", "queued", "leased"].includes(run.status));
  const composerRunning = runs.some((run) => isActive(run.status));
  const messages = useMemo(
    () => userVisibleMessages(snapshot?.messages ?? [], { includePeerReceipts: true }),
    [snapshot?.messages],
  );
  const answerableAskMessageId = latestAnswerableAskMessageId(snapshot);
  const runError = threadRunError(snapshot, dismissedRunErrorIds);
  const displayedRunError = sendError ? null : runError;
  const displayedRunErrorId = displayedRunError ? (snapshot?.run?.id ?? null) : null;
  const artifactTarget = useMemo(() => ({ botId: bot.id }), [bot.id]);
  const peerBot = useCallback(
    (botId: string) => bots.find((candidate) => candidate.id === botId),
    [bots],
  );
  const workingBots: GroupAvatarMember[] = workingRuns.map((run) => {
    const runBot = peerBot(run.botId) ?? bot;
    return { botId: run.botId, color: runBot.color, name: runBot.name, status: run.status };
  });

  useEffect(() => {
    if (!openCount) return;
    const frame = window.requestAnimationFrame(() =>
      panelRef.current?.querySelector("textarea")?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [openCount]);

  // Reading the reply here reads it in chat too.
  const lastBotMessageId = useMemo(
    () =>
      messages.findLast((message) => message.role === "bot" && !message.id.includes(":"))?.id ??
      null,
    [messages],
  );
  useEffect(() => {
    if (!lastBotMessageId || document.visibilityState !== "visible") return;
    void rpc.threads.markRead({ botId: bot.id }).catch(() => undefined);
  }, [bot.id, lastBotMessageId]);

  useEffect(() => () => revokePendingAttachmentPreviews(pendingRef.current), []);

  const sendMessage = useCallback(
    async (text: string, _mentions: ComposerMention[], clientNonce: string) => {
      if (sendingRef.current) return false;
      const attachments = pendingAttachments;
      const trimmed = text.trim();
      if (!trimmed && attachments.length === 0) return false;
      sendingRef.current = true;
      setSending(true);
      setSendError(null);
      try {
        const artifactIds: string[] = [];
        for (const pending of attachments) {
          const mimeType = inferAttachmentMimeType(pending.file.name, pending.file.type);
          if (!mimeType) throw new Error(t`Unsupported file type: ${pending.file.name}`);
          const artifact = await rpc.artifacts.create({
            botId: bot.id,
            name: pending.file.name,
            mimeType,
            contentBase64: await readFileAsBase64(pending.file),
          });
          artifactIds.push(artifact.id);
        }
        const about = record ? reference(record) : null;
        const body = about ? (trimmed ? `${about}: ${trimmed}` : about) : trimmed;
        await send({
          clientNonce,
          text: body || undefined,
          artifactIds: artifactIds.length ? artifactIds : undefined,
          replyToMessageId: replyTarget?.id,
          replyQuote: replyTarget ? (replyQuote ?? undefined) : undefined,
        });
        revokePendingAttachmentPreviews(attachments);
        setPendingAttachments([]);
        setAttachmentNotice(null);
        setReplyTarget(null);
        setReplyQuote(null);
        setPromptsUsedAt(openCount);
        clearRecord();
        return true;
      } catch (error) {
        setSendError(errorText(error, t`Failed to send message`));
        return false;
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [
      bot.id,
      clearRecord,
      openCount,
      pendingAttachments,
      record,
      reference,
      replyQuote,
      replyTarget,
      send,
      t,
    ],
  );

  const stopRun = useCallback(async () => {
    setSendError(null);
    try {
      await stop();
    } catch (error) {
      setSendError(errorText(error, t`Failed to stop`));
    }
  }, [stop, t]);

  const pickAttachments = useCallback(
    (files: FileList | null) => {
      if (!files?.length) return false;
      const existing = pendingAttachments;
      const maxBytes = getMaxUploadSizeBytes();
      const next: PendingAttachment[] = [];
      const skipped: string[] = [];
      for (const file of Array.from(files)) {
        if (existing.length + next.length >= ATTACHMENT_MAX_COUNT) {
          skipped.push(t`${file.name} (max ${ATTACHMENT_MAX_COUNT} attachments)`);
          continue;
        }
        if (file.size > maxBytes) {
          skipped.push(t`${file.name} (over ${attachmentSizeLabel(maxBytes)})`);
          continue;
        }
        const mimeType = inferAttachmentMimeType(file.name, file.type);
        if (!mimeType) {
          skipped.push(file.name);
          continue;
        }
        next.push({
          id: `${file.name}-${file.size}-${file.lastModified}-${next.length}`,
          threadKey: bot.id,
          file,
          previewUrl: mimeType.startsWith("image/") ? URL.createObjectURL(file) : undefined,
        });
      }
      if (next.length) setPendingAttachments((current) => [...current, ...next]);
      setAttachmentNotice(skipped.length ? t`Skipped ${skipped.join(", ")}` : null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return next.length > 0;
    },
    [bot.id, pendingAttachments, t],
  );
  const removeAttachment = useCallback((attachment: PendingAttachment) => {
    revokePendingAttachmentPreviews([attachment]);
    setPendingAttachments((current) => current.filter((item) => item.id !== attachment.id));
  }, []);

  const dismissError = useCallback(() => {
    setSendError(null);
    if (!displayedRunErrorId) return;
    rememberSeenRunErrorId(displayedRunErrorId);
    setDismissedRunErrorIds((current) => new Set(current).add(displayedRunErrorId));
  }, [displayedRunErrorId]);
  const presentRunError = useCallback((runId: string) => rememberSeenRunErrorId(runId), []);

  const loadEarlier = useCallback(async () => {
    const previousHeight = scrollRef.current?.scrollHeight ?? 0;
    await loadOlder();
    // Keep the reader's place while the older page lands above it.
    window.requestAnimationFrame(() => {
      const element = scrollRef.current;
      if (element) element.scrollTop += element.scrollHeight - previousHeight;
    });
  }, [loadOlder]);
  const answerCard = useCallback(
    async (message: ThreadMessage, text: string, username?: string) => {
      await answer(message, text, username);
      setPromptsUsedAt(openCount);
    },
    [answer, openCount],
  );
  const reactTo = useCallback(
    async (message: ThreadMessage, reaction: MessageReaction) => {
      try {
        await react(message, reaction);
      } catch (error) {
        setSendError(errorText(error, t`Could not update reaction`));
      }
    },
    [react, t],
  );
  const replyTo = useCallback((message: ThreadMessage) => {
    setReplyTarget(message);
    setReplyQuote(null);
  }, []);
  const quote = useCallback((message: ThreadMessage, text: string) => {
    setReplyTarget(message);
    setReplyQuote(text);
  }, []);
  const clearReply = useCallback(() => {
    setReplyTarget(null);
    setReplyQuote(null);
  }, []);
  const jumpTo = useCallback((messageId: string) => {
    if (!scrollRef.current?.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)) return;
    jumpCount.current += 1;
    setScrollRequest({ messageId, nonce: jumpCount.current });
  }, []);
  const clearScrollRequest = useCallback(() => setScrollRequest(null), []);
  // Computers, routines and other bots live in chat; those cards hand over to it.
  const openChat = useCallback(
    (botId?: string) => navigate(`/app/${botId ?? bot.id}`),
    [bot.id, navigate],
  );
  const openRoutineInChat = useCallback(() => navigate(`/app/${bot.id}`), [bot.id, navigate]);
  const speakNothing = useCallback(() => undefined, []);

  const showPrompts =
    promptsUsedAt !== openCount && !composerRunning && !sending && prompts.length > 0;
  const RecordIcon = record ? RECORD_ICONS[record.kind] : null;

  return (
    <div ref={panelRef} data-testid="business-assistant" className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-sidebar-border ps-2 pe-2">
        <BotSwitcher bot={bot} bots={bots} status={assistant.status} onPick={assistant.pickBot} />
        <Link
          to={`/app/${bot.id}`}
          aria-label={t`Open chat`}
          title={t`Open chat`}
          className={iconButtonClass}
        >
          <MessageSquare className="size-4" strokeWidth={1.75} aria-hidden="true" />
        </Link>
        <button
          type="button"
          aria-label={t`Close`}
          title={t`Close`}
          onClick={assistant.close}
          className={iconButtonClass}
        >
          <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      {!snapshot ? (
        <div className="grid flex-1 place-items-center">
          <Spinner className="text-muted-foreground" />
        </div>
      ) : messages.length === 0 && workingRuns.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <BotAvatar color={bot.color} identity={bot.id} size={40} />
          <p className="text-sm font-medium">{bot.name}</p>
          {bot.description ? (
            <p className="max-w-xs text-[13px] text-muted-foreground">{bot.description}</p>
          ) : null}
        </div>
      ) : (
        <Transcript
          compact
          key={snapshot.threadId}
          scrollRef={scrollRef}
          scrollRequest={scrollRequest}
          onScrollRequestHandled={clearScrollRequest}
          artifactTarget={artifactTarget}
          messages={messages}
          showToolActivity={showToolActivity}
          olderCursor={snapshot.olderCursor}
          loadingOlder={loadingOlder}
          answerableAskMessageId={answerableAskMessageId}
          running={workingRuns.length > 0}
          workingBots={workingBots}
          onLoadOlder={loadEarlier}
          onOpenBot={openChat}
          onAnswer={answerCard}
          onReply={replyTo}
          onQuote={quote}
          onReact={reactTo}
          onJumpToMessage={jumpTo}
          onOpenPeerMessages={setPeer}
          peerBot={peerBot}
          onRefresh={refresh}
          onBotChanged={refresh}
          onAddRoutine={openRoutineInChat}
          voiceReady={false}
          speakingMessageId={null}
          onSpeak={speakNothing}
          onOpenComputer={openChat}
        />
      )}

      {record && RecordIcon ? (
        <div
          data-testid="assistant-record"
          className="mx-3 mt-2 flex items-center gap-2 rounded-lg border bg-muted/40 py-1 ps-2.5 pe-1 text-[13px]"
        >
          <RecordIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span
            className={cn(
              "shrink-0",
              record.kind !== "company" && record.kind !== "contact" && "font-mono text-xs",
            )}
          >
            {record.ref}
          </span>
          {record.name ? (
            <span className="min-w-0 truncate text-muted-foreground">{record.name}</span>
          ) : null}
          <button
            type="button"
            aria-label={t`Remove`}
            title={t`Remove`}
            onClick={clearRecord}
            className="ms-auto grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {showPrompts ? (
        <div data-testid="assistant-prompts" className="flex flex-wrap gap-1.5 px-3 pt-2">
          {prompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => void sendMessage(prompt, [], newClientId())}
              className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-start text-[13px] text-foreground/85 outline-none transition-colors hover:border-foreground/20 hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Sparkles
                className="size-3.5 shrink-0 text-muted-foreground"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              {prompt}
            </button>
          ))}
        </div>
      ) : null}

      <Composer
        draftKey={`bot:${bot.id}`}
        enterToSend={enterToSend}
        activeName={bot.name}
        running={composerRunning}
        pendingAttachments={pendingAttachments}
        attachmentNotice={attachmentNotice}
        sendError={sendError}
        runError={displayedRunError}
        runErrorId={displayedRunErrorId}
        onRunErrorPresented={presentRunError}
        onDismissError={dismissError}
        sending={sending}
        fileInputRef={fileInputRef}
        onAttachmentPick={pickAttachments}
        onRemoveAttachment={removeAttachment}
        onSend={sendMessage}
        onStop={stopRun}
        artifactTarget={artifactTarget}
        replyTarget={replyTarget}
        replyQuote={replyQuote}
        replyTargetName={replyTarget?.role === "user" ? t`You` : bot.name}
        onClearReply={clearReply}
      />

      <Suspense fallback={null}>
        {peer ? (
          <PeerMessagesOverlay
            botId={bot.id}
            botName={bot.name}
            botColor={bot.color}
            peerBotId={peer.peerBotId}
            peerBotName={peer.peerBotName}
            peerBotColor={peerBot(peer.peerBotId)?.color ?? bot.color}
            onClose={() => setPeer(null)}
          />
        ) : null}
      </Suspense>
    </div>
  );
}

function BotSwitcher({
  bot,
  bots,
  status,
  onPick,
}: {
  bot: Bot;
  bots: readonly Bot[];
  status: string;
  onPick: (botId: string) => void;
}) {
  const { t } = useLingui();
  const subtitle = compactRosterStatusLabel(status) ?? bot.title;
  const identity = (
    <>
      <BotAvatar color={bot.color} identity={bot.id} size={26} status={status} />
      <span className="min-w-0 text-start">
        <span className="block truncate text-sm font-medium">{bot.name}</span>
        {subtitle ? (
          <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
        ) : null}
      </span>
    </>
  );
  if (bots.length < 2) {
    return <div className="flex min-w-0 flex-1 items-center gap-2.5 px-1">{identity}</div>;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title={t`Switch bot`}
        data-testid="assistant-bot-switcher"
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1 py-1 text-start outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {identity}
        <ChevronDown
          className="ms-auto size-4 shrink-0 text-muted-foreground"
          strokeWidth={1.75}
          aria-hidden="true"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuRadioGroup value={bot.id} onValueChange={(value) => onPick(String(value))}>
          {bots.map((candidate) => (
            <DropdownMenuRadioItem key={candidate.id} value={candidate.id} className="gap-2">
              <BotAvatar color={candidate.color} identity={candidate.id} size={20} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{candidate.name}</span>
                {candidate.title ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {candidate.title}
                  </span>
                ) : null}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
