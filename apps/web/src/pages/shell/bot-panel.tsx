import { Trans, useLingui } from "@lingui/react/macro";
import type {
  AgentSkillCatalogEntry,
  Bot,
  ComputerAccess,
  ComputerMode,
  ComputerToolGroup,
  Me,
  ModelCatalogEntry,
  ModelCredential,
  ThinkingLevel,
  VoiceInfo,
} from "@savingroup/contracts";
import {
  BOT_DESCRIPTION_MAX_LENGTH,
  BOT_NAME_MAX_LENGTH,
  BOT_TITLE_MAX_LENGTH,
  COMPUTER_TOOL_GROUP_NAMES,
  computerToolGroupEnabled,
  isBuiltinToolName,
  isComputerToolGroupName,
  setComputerToolGroup,
} from "@savingroup/contracts";
import {
  connectedModelChoices,
  modelOptionKey,
  parseModelOptionKey,
  resolveSelectableModelId,
} from "@savingroup/core";
import {
  Button,
  Input,
  NativeSelect,
  NativeSelectOption,
  Switch,
  Textarea,
  Toggle,
} from "@savingroup/ui-web";
import { X } from "lucide-react";
import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { ErrorBoundary, SectionLoadFailed } from "../../components/ErrorBoundary";
import { InstructionSettings } from "../../components/InstructionSettings";
import { botProfilePatch } from "../../lib/bot-profile-patch";
import { thinkingLevelLabel } from "../../lib/model-catalog";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";
import { AvatarStudioPopover } from "./avatar-studio-popover";
import { BotCredentialsSection } from "./bot-credentials";

const ScratchpadSection = lazy(() =>
  import("../ScratchpadSection").then((module) => ({ default: module.ScratchpadSection })),
);

const KnowledgeSection = lazy(() =>
  import("../KnowledgeSection").then((module) => ({ default: module.KnowledgeSection })),
);

const fieldLabelClass = "mt-4 block text-[14px] text-muted-foreground";

function ChoiceToggles<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; testId?: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset
      aria-label={label}
      className={`mt-2 grid min-w-0 gap-2 ${options.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}
    >
      {options.map((option) => (
        <Toggle
          key={option.value}
          variant="outline"
          pressed={value === option.value}
          data-testid={option.testId}
          onPressedChange={(pressed) => {
            if (pressed) onChange(option.value);
          }}
          className="aria-pressed:border-foreground/40 aria-pressed:text-foreground"
        >
          {option.label}
        </Toggle>
      ))}
    </fieldset>
  );
}

function ComputerModePicker({
  value,
  onChange,
  teamTestId,
  privateTestId,
}: {
  value: ComputerMode;
  onChange: (value: ComputerMode) => void;
  teamTestId?: string;
  privateTestId?: string;
}) {
  const { t } = useLingui();
  return (
    <div className="mt-4">
      <div className="text-[14px] text-muted-foreground">
        <Trans>Computer</Trans>
      </div>
      <ChoiceToggles
        label={t`Computer`}
        value={value}
        onChange={onChange}
        options={[
          { value: "team", label: t`Team`, testId: teamTestId },
          { value: "dedicated", label: t`Private`, testId: privateTestId },
        ]}
      />
    </div>
  );
}

function computerToolGroupLabel(
  group: ComputerToolGroup,
  t: (strings: TemplateStringsArray) => string,
) {
  switch (group) {
    case "screen":
      return t`Screen`;
    case "browser":
      return t`Browser`;
    case "files":
      return t`Files`;
    case "shell":
      return t`Shell`;
  }
}

export function CreateBotForm({
  onCreate,
  onCancel,
}: {
  onCreate: (input: {
    name: string;
    title: string;
    description: string;
    computerMode: ComputerMode;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const ids = useId();
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [computerMode, setComputerMode] = useState<ComputerMode>("team");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!name.trim() || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await onCreate({
        name: name.trim(),
        title: title.trim(),
        description: description.trim(),
        computerMode,
      });
    } catch (err) {
      setError(errorText(err, t`Could not create bot`));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div data-testid="create-bot-form">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[13.5px] text-muted-foreground">
          <Trans>New bot</Trans>
        </span>
        <Button variant="ghost" size="icon-sm" aria-label={t`Cancel new bot`} onClick={onCancel}>
          <X size={16} strokeWidth={1.8} />
        </Button>
      </div>
      {error ? (
        <p
          role="alert"
          data-testid="create-bot-error"
          className="mb-3 text-[13px] text-destructive"
        >
          {error}
        </p>
      ) : null}
      <label htmlFor={`${ids}-name`} className="mt-6 block text-[14px] text-muted-foreground">
        <Trans>Name</Trans>
        <Input
          id={`${ids}-name`}
          value={name}
          maxLength={BOT_NAME_MAX_LENGTH}
          onChange={(e) => setName(e.target.value)}
          placeholder={t`Name this bot`}
          className="mt-2"
        />
      </label>
      <label htmlFor={`${ids}-title`} className={fieldLabelClass}>
        <Trans>Title</Trans>
        <Input
          id={`${ids}-title`}
          value={title}
          maxLength={BOT_TITLE_MAX_LENGTH}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t`Describe what this bot does`}
          className="mt-2"
        />
      </label>
      <label htmlFor={`${ids}-description`} className={fieldLabelClass}>
        <Trans>Description</Trans>
        <Textarea
          id={`${ids}-description`}
          value={description}
          maxLength={BOT_DESCRIPTION_MAX_LENGTH}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t`What this bot is for`}
          rows={4}
          className="mt-2"
        />
      </label>
      <div data-testid="create-bot-computer">
        <ComputerModePicker
          value={computerMode}
          onChange={setComputerMode}
          teamTestId="create-bot-team"
          privateTestId="create-bot-private"
        />
      </div>
      <Button
        className="mt-5"
        disabled={!name.trim() || submitting}
        onClick={() => void handleSubmit()}
      >
        {submitting ? <Trans>Creating…</Trans> : <Trans>Create</Trans>}
      </Button>
    </div>
  );
}

export function BotSettings({
  bot,
  memoryProviderConfigured,
  onSkillsChange,
  onSave,
  onComputerModeChange,
  onExport,
  onClear,
}: {
  bot: Bot;
  onSkillsChange: (skills: AgentSkillCatalogEntry[]) => void;
  memoryProviderConfigured: boolean;
  onSave: (patch: {
    name?: string;
    title?: string;
    description?: string;
    instructions?: string;
    color?: string;
    notifyOnFinish?: boolean;
    computerAccess?: ComputerAccess;
    memoryScope?: "isolated" | "shared" | null;
    autoSpeak?: boolean;
    voiceId?: string | null;
    modelProvider?: string | null;
    modelId?: string | null;
    thinkingLevel?: ThinkingLevel | null;
    disabledBuiltinTools?: string[];
  }) => Promise<void>;
  /** Switches Team/Private on its own so a refused switch never blocks other edits. */
  onComputerModeChange: (mode: ComputerMode) => Promise<void>;
  onExport: () => Promise<void>;
  onClear: () => void;
}) {
  const { t } = useLingui();
  const [advancedOpened, setAdvancedOpened] = useState(false);
  const ids = useId();
  const [name, setName] = useState(bot.name);
  const [title, setTitle] = useState(bot.title);
  const [description, setDescription] = useState(bot.description);
  // A roster refresh can skip replacing bots while a reorder is in flight, so
  // this prop keeps the description from when the panel opened. Later saves
  // compare against the description last saved here; otherwise a model or
  // voice change treats that stale text as an edit and overwrites instructions.
  const savedDescriptionRef = useRef(bot.description ?? "");
  const [color, setColor] = useState(bot.color);
  const [notifyOnFinish, setNotifyOnFinish] = useState(bot.notifyOnFinish ?? true);
  const [computerMode, setComputerMode] = useState(bot.computerMode);
  const [computerAccess, setComputerAccess] = useState(bot.computerAccess);
  const [memoryScope, setMemoryScope] = useState(bot.memoryScope);
  const [autoSpeak, setAutoSpeak] = useState(bot.autoSpeak);
  const [voiceId, setVoiceId] = useState(bot.voiceId ?? "");
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [modelKey, setModelKey] = useState(
    bot.modelProvider && bot.modelId ? modelOptionKey(bot.modelProvider, bot.modelId) : "",
  );
  const [thinkingLevel, setThinkingLevel] = useState(bot.thinkingLevel ?? "");
  const [disabledBuiltinTools, setDisabledBuiltinTools] = useState<string[]>(
    bot.disabledBuiltinTools ?? [],
  );
  // The list on screen is updated before the save returns. This stays on the
  // last list the server accepted so a rejection can undo that preview.
  const persistedDisabledToolsRef = useRef(disabledBuiltinTools);
  const serverDisabledToolsRef = useRef(disabledBuiltinTools);
  const pendingSavesRef = useRef(0);
  useEffect(() => {
    const next = bot.disabledBuiltinTools ?? [];
    if (serverDisabledToolsRef.current === next) return;
    serverDisabledToolsRef.current = next;
    persistedDisabledToolsRef.current = next;
    if (pendingSavesRef.current === 0) setDisabledBuiltinTools(next);
  }, [bot.disabledBuiltinTools]);
  const [toolNameDraft, setToolNameDraft] = useState("");
  const [credentials, setCredentials] = useState<ModelCredential[]>([]);
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [modelMetaReady, setModelMetaReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveQueueRef = useRef(Promise.resolve());
  const executeSaveRef = useRef<
    (patchOverrides?: {
      name?: string;
      title?: string;
      description?: string;
      color?: string;
      notifyOnFinish?: boolean;
      disabledBuiltinTools?: string[];
      baseDisabledBuiltinTools?: string[];
    }) => Promise<void>
  >(async () => undefined);
  useEffect(() => {
    void rpc.voice
      .voices({})
      .then(setVoices)
      .catch(() => setVoices([]));
    void Promise.all([rpc.models.credentials(), rpc.models.list(), rpc.me()])
      .then(([nextCredentials, nextCatalog, nextMe]) => {
        setCredentials(nextCredentials);
        setCatalog(nextCatalog);
        setMe(nextMe);
        // Only mark ready on success — a failed catalog load must not clear
        // an existing thinkingLevel override on save.
        setModelMetaReady(true);
      })
      .catch(() => undefined);
  }, []);

  const connectedOptions = connectedModelChoices(credentials, catalog);
  const storedModel = modelKey ? parseModelOptionKey(modelKey) : null;
  const selectedModel = storedModel
    ? {
        provider: storedModel.provider,
        modelId: resolveSelectableModelId(catalog, storedModel.provider, storedModel.modelId),
      }
    : null;
  const selectedModelKey = selectedModel
    ? modelOptionKey(selectedModel.provider, selectedModel.modelId)
    : "";

  const effectiveProvider = selectedModel?.provider ?? me?.defaultProvider ?? null;
  const effectiveModelId = selectedModel?.modelId ?? me?.defaultModel ?? null;
  const effectiveEntry =
    effectiveProvider && effectiveModelId
      ? catalog.find(
          (entry) =>
            entry.provider === effectiveProvider &&
            resolveSelectableModelId(catalog, entry.provider, entry.id) === effectiveModelId,
        )
      : undefined;
  const effectiveCredential = credentials.find(
    (entry) => entry.provider === effectiveProvider && entry.modelId === effectiveModelId,
  );
  const thinkingOptions = (
    effectiveCredential?.thinkingLevels ??
    effectiveEntry?.thinkingLevels ??
    []
  ).filter((level) => level !== "off");
  const defaultThinkingLevel = effectiveCredential?.thinkingLevel ?? "medium";

  async function executeSave(patchOverrides?: {
    name?: string;
    title?: string;
    description?: string;
    color?: string;
    notifyOnFinish?: boolean;
    disabledBuiltinTools?: string[];
    baseDisabledBuiltinTools?: string[];
  }) {
    const selected = selectedModel;
    const nextName = (patchOverrides?.name !== undefined ? patchOverrides.name : name).trim();
    const nextTitle = (patchOverrides?.title !== undefined ? patchOverrides.title : title).trim();
    const nextDescription = (
      patchOverrides?.description !== undefined ? patchOverrides.description : description
    ).trim();
    const nextColor = patchOverrides?.color !== undefined ? patchOverrides.color : color;
    const nextNotify =
      patchOverrides?.notifyOnFinish !== undefined ? patchOverrides.notifyOnFinish : notifyOnFinish;

    if (nextName) setName(nextName);
    setTitle(nextTitle);
    setDescription(nextDescription);

    try {
      setSaving(true);
      setError(null);
      const patch = {
        name: nextName || bot.name,
        title: nextTitle,
        // Keep untouched profile fields off the wire.
        ...botProfilePatch(savedDescriptionRef.current, nextDescription),
        // Unchanged color stays off the wire so a legacy named value cannot fail a name save.
        ...(nextColor !== bot.color ? { color: nextColor } : {}),
        notifyOnFinish: nextNotify,
        memoryScope,
        autoSpeak,
        voiceId: voiceId || null,
        modelProvider: selected?.provider ?? null,
        modelId: selected?.modelId ?? null,
        ...(modelMetaReady
          ? {
              thinkingLevel: thinkingOptions.length
                ? ((thinkingLevel || null) as ThinkingLevel | null)
                : null,
            }
          : {}),
      };
      const requestedTools = patchOverrides?.disabledBuiltinTools;
      const baseTools = patchOverrides?.baseDisabledBuiltinTools ?? [];
      // Preserve this edit's additions/removals against any refreshed server list.
      // Retry if a refresh arrives while the request is in flight.
      for (;;) {
        const serverTools = serverDisabledToolsRef.current;
        const nextTools =
          requestedTools === undefined
            ? undefined
            : [
                ...persistedDisabledToolsRef.current.filter(
                  (name) => !baseTools.includes(name) || requestedTools.includes(name),
                ),
                ...requestedTools.filter(
                  (name) =>
                    !baseTools.includes(name) && !persistedDisabledToolsRef.current.includes(name),
                ),
              ];
        // Unrelated saves omit the list, preserving changes from other sessions.
        await onSave({
          ...patch,
          ...(nextTools !== undefined ? { disabledBuiltinTools: nextTools } : {}),
        });
        if (nextTools === undefined) break;
        if (
          serverTools !== serverDisabledToolsRef.current &&
          !sameStringList(nextTools, serverDisabledToolsRef.current)
        )
          continue;
        persistedDisabledToolsRef.current = nextTools;
        break;
      }
      savedDescriptionRef.current = nextDescription;
    } catch (err) {
      setError(errorText(err, t`Could not save`));
    } finally {
      pendingSavesRef.current -= 1;
      if (pendingSavesRef.current === 0) {
        setDisabledBuiltinTools([...persistedDisabledToolsRef.current]);
      }
      setSaving(pendingSavesRef.current > 0);
    }
  }
  executeSaveRef.current = executeSave;

  function disableBuiltinTool(raw: string) {
    const name = raw.trim();
    if (!name) return;
    if (!isBuiltinToolName(name)) {
      setError(t`Unknown tool`);
      return;
    }
    setToolNameDraft("");
    setError(null);
    if (disabledBuiltinTools.includes(name)) return;
    const next = [...disabledBuiltinTools, name];
    setDisabledBuiltinTools(next);
    void enqueueSave({ disabledBuiltinTools: next });
  }

  function changeComputerAccess(next: ComputerAccess) {
    if (next === computerAccess) return;
    const previous = computerAccess;
    setComputerAccess(next);
    setError(null);
    // Queued behind field saves; a refusal puts the control back where the server has it.
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(() => onSave({ computerAccess: next }))
      .catch((err: unknown) => {
        setComputerAccess(previous);
        setError(errorText(err, t`Could not save`));
      });
  }

  async function changeComputerMode(next: ComputerMode) {
    if (next === computerMode) return;
    const previous = computerMode;
    setComputerMode(next);
    setError(null);
    try {
      await onComputerModeChange(next);
    } catch (err) {
      setComputerMode(previous);
      setError(errorText(err, t`Could not save`));
    }
  }

  function setToolGroup(group: ComputerToolGroup, enabled: boolean) {
    const next = setComputerToolGroup(disabledBuiltinTools, group, enabled);
    setDisabledBuiltinTools(next);
    void enqueueSave({ disabledBuiltinTools: next });
  }

  function enqueueSave(patchOverrides?: {
    name?: string;
    title?: string;
    description?: string;
    color?: string;
    notifyOnFinish?: boolean;
    disabledBuiltinTools?: string[];
  }) {
    // Serialize full-object auto-saves so an older in-flight request cannot
    // finish after a newer one and clobber fields. Always call through a ref so
    // queued work reads the latest field values, not a stale render closure.
    pendingSavesRef.current += 1;
    const queuedPatch =
      patchOverrides?.disabledBuiltinTools === undefined
        ? patchOverrides
        : {
            ...patchOverrides,
            baseDisabledBuiltinTools: [...persistedDisabledToolsRef.current],
          };
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(() => executeSaveRef.current(queuedPatch));
    return saveQueueRef.current;
  }

  return (
    <div data-testid="bot-settings">
      <div className="flex justify-center py-4">
        <AvatarStudioPopover
          value={color}
          identity={bot.id}
          status={bot.status}
          size={76}
          onChange={(newColor) => {
            setColor(newColor);
            void enqueueSave({ color: newColor });
          }}
        />
      </div>
      <label htmlFor={`${ids}-name`} className="mt-4 block text-[13.5px] text-muted-foreground/80">
        <Trans>Name</Trans>
        <Input
          id={`${ids}-name`}
          value={name}
          maxLength={BOT_NAME_MAX_LENGTH}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void enqueueSave()}
          className="mt-1.5"
        />
      </label>
      <label htmlFor={`${ids}-title`} className={fieldLabelClass}>
        <Trans>Title</Trans>
        <Input
          id={`${ids}-title`}
          value={title}
          maxLength={BOT_TITLE_MAX_LENGTH}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => void enqueueSave()}
          placeholder={t`e.g. Hivenet Agent, Presales, Timesheets bot`}
          className="mt-1.5"
        />
      </label>
      <label htmlFor={`${ids}-description`} className={fieldLabelClass}>
        <Trans>Description</Trans>
        <Textarea
          id={`${ids}-description`}
          value={description}
          maxLength={BOT_DESCRIPTION_MAX_LENGTH}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => void enqueueSave()}
          rows={3}
          className="mt-1.5"
        />
      </label>
      <div className="mt-6 flex items-center justify-between pt-4 border-t border-border/20">
        <div className="space-y-0.5 pe-4">
          <div
            id={`${ids}-notify-finish-label`}
            className="text-[13.5px] font-medium text-foreground"
          >
            <Trans>Notifications</Trans>
          </div>
          <div id={`${ids}-notify-finish-desc`} className="text-[12px] text-muted-foreground/70">
            <Trans>Get notified when this Bot finishes or needs input</Trans>
          </div>
        </div>
        <Switch
          id={`${ids}-notify-finish`}
          checked={notifyOnFinish}
          aria-labelledby={`${ids}-notify-finish-label`}
          aria-describedby={`${ids}-notify-finish-desc`}
          onCheckedChange={(checked) => {
            setNotifyOnFinish(checked);
            void enqueueSave({ notifyOnFinish: checked });
          }}
        />
      </div>
      <div className="mt-4 text-[13.5px] font-medium text-foreground">
        <Trans>Computer</Trans>
      </div>
      <ChoiceToggles
        label={t`Computer access`}
        value={computerAccess}
        onChange={changeComputerAccess}
        options={[
          { value: "off", label: t`Off`, testId: "computer-access-off" },
          { value: "ask", label: t`Ask first`, testId: "computer-access-ask" },
          { value: "full", label: t`Full`, testId: "computer-access-full" },
        ]}
      />
      <details
        data-testid="bot-settings-advanced"
        className="group mt-5"
        onToggle={(event) => {
          if (event.currentTarget.open) setAdvancedOpened(true);
        }}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[14px] text-muted-foreground">
          <span className="text-muted-foreground">
            <Trans>Advanced</Trans>
          </span>
          <span aria-hidden="true" className="transition-transform group-open:rotate-90">
            ›
          </span>
        </summary>
        <InstructionSettings key={bot.id} bot={bot} />
        {computerAccess !== "off" ? (
          <>
            <ComputerModePicker value={computerMode} onChange={changeComputerMode} />
            {COMPUTER_TOOL_GROUP_NAMES.map((group) => (
              <label
                key={group}
                htmlFor={`${ids}-computer-${group}`}
                className="mt-3 flex items-center justify-between gap-3 text-[14px] text-foreground/75"
              >
                {computerToolGroupLabel(group, t)}
                <Switch
                  id={`${ids}-computer-${group}`}
                  checked={computerToolGroupEnabled(disabledBuiltinTools, group)}
                  onCheckedChange={(checked) => setToolGroup(group, checked)}
                />
              </label>
            ))}
          </>
        ) : null}
        <ErrorBoundary fallback={<SectionLoadFailed />}>
          <Suspense fallback={null}>
            <ScratchpadSection botId={bot.id} />
          </Suspense>
        </ErrorBoundary>
        {advancedOpened ? (
          <ErrorBoundary fallback={<SectionLoadFailed />}>
            <Suspense fallback={null}>
              <KnowledgeSection botId={bot.id} onSkillsChange={onSkillsChange} />
            </Suspense>
          </ErrorBoundary>
        ) : null}
        <label htmlFor={`${ids}-model`} className={fieldLabelClass}>
          <Trans>Model</Trans>
          <NativeSelect
            id={`${ids}-model`}
            className="mt-2 w-full"
            value={selectedModelKey}
            onChange={(event) => {
              setModelKey(event.target.value);
              setThinkingLevel("");
            }}
          >
            <NativeSelectOption value="">
              {t`Space default`}
              {me?.defaultModel
                ? ` (${catalogLabel(catalog, me.defaultProvider, me.defaultModel) ?? me.defaultModel})`
                : ""}
            </NativeSelectOption>
            {selectedModelKey &&
            !connectedOptions.some((option) => option.key === selectedModelKey) ? (
              <NativeSelectOption value={selectedModelKey}>
                {selectedModel?.modelId ?? selectedModelKey}
              </NativeSelectOption>
            ) : null}
            {connectedOptions.map((option) => (
              <NativeSelectOption key={option.key} value={option.key}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        {thinkingOptions.length ? (
          <label htmlFor={`${ids}-thinking`} className={fieldLabelClass}>
            <Trans>Thinking</Trans>
            <NativeSelect
              id={`${ids}-thinking`}
              className="mt-2 w-full"
              value={thinkingLevel}
              onChange={(event) => setThinkingLevel(event.target.value)}
            >
              <NativeSelectOption value="">
                {t`Default (${thinkingLevelLabel(defaultThinkingLevel)})`}
              </NativeSelectOption>
              {thinkingOptions.map((level) => (
                <NativeSelectOption key={level} value={level}>
                  {thinkingLevelLabel(level)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        ) : null}
        {memoryProviderConfigured ? (
          <div className="mt-4 text-[14px] text-muted-foreground">
            <Trans>Memory scope</Trans>
            <div className="mt-2 flex gap-2">
              {(
                [
                  { value: null, label: t`Inherit default` },
                  { value: "isolated" as const, label: t`Isolated` },
                  { value: "shared" as const, label: t`Shared` },
                ] satisfies Array<{ value: "isolated" | "shared" | null; label: string }>
              ).map((option) => (
                <Toggle
                  key={option.label}
                  variant="outline"
                  size="sm"
                  pressed={memoryScope === option.value}
                  onPressedChange={(pressed) => {
                    if (pressed) setMemoryScope(option.value);
                  }}
                  className="flex-1 aria-pressed:border-foreground/40 aria-pressed:text-foreground"
                >
                  {option.label}
                </Toggle>
              ))}
            </div>
          </div>
        ) : null}
        <label
          htmlFor={`${ids}-auto-speak`}
          className="mt-5 flex cursor-pointer items-center gap-3 text-[14px] text-foreground/75"
        >
          <Switch
            id={`${ids}-auto-speak`}
            checked={autoSpeak}
            onCheckedChange={(checked) => setAutoSpeak(checked)}
          />
          <Trans>Read replies aloud</Trans>
        </label>
        {voices.length ? (
          <label htmlFor={`${ids}-voice`} className={fieldLabelClass}>
            <Trans>Voice</Trans>
            <NativeSelect
              id={`${ids}-voice`}
              className="mt-2 w-full"
              value={voiceId}
              onChange={(event) => setVoiceId(event.target.value)}
            >
              <NativeSelectOption value="">{t`Account default`}</NativeSelectOption>
              {voices.map((voice) => (
                <NativeSelectOption key={voice.id} value={voice.id}>
                  {voice.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        ) : null}
        <label htmlFor={`${ids}-disabled-tools`} className={fieldLabelClass}>
          <Trans>Disabled tools</Trans>
          <Input
            id={`${ids}-disabled-tools`}
            value={toolNameDraft}
            placeholder="web_search"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(event) => {
              setToolNameDraft(event.target.value);
              // This message is about the name being typed. Leave other save errors alone.
              setError((current) => (current === t`Unknown tool` ? null : current));
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              disableBuiltinTool(event.currentTarget.value);
            }}
            onBlur={(event) => {
              if (event.currentTarget.value.trim()) disableBuiltinTool(event.currentTarget.value);
            }}
            className="mt-1.5 font-mono"
          />
        </label>
        {disabledBuiltinTools
          .filter((toolName) => !isComputerToolGroupName(toolName))
          .map((toolName) => (
            <label
              key={toolName}
              htmlFor={`${ids}-disabled-${toolName}`}
              className="mt-2 flex items-center justify-between gap-3 text-[13px] text-foreground/80"
            >
              <span className="font-mono">{toolName}</span>
              <Switch
                id={`${ids}-disabled-${toolName}`}
                checked
                onCheckedChange={(checked) => {
                  if (checked) return;
                  const next = disabledBuiltinTools.filter((entry) => entry !== toolName);
                  setDisabledBuiltinTools(next);
                  void enqueueSave({ disabledBuiltinTools: next });
                }}
              />
            </label>
          ))}
        {advancedOpened ? <BotCredentialsSection botId={bot.id} /> : null}
      </details>
      {error ? <p className="mt-2 text-[13px] text-destructive">{error}</p> : null}
      <div className="mt-5 flex flex-col items-start gap-3">
        <Button
          disabled={saving}
          onClick={() => {
            void enqueueSave({
              name,
              title,
              description,
              color,
              notifyOnFinish,
            });
          }}
        >
          <Trans>Save</Trans>
        </Button>
        <Button variant="ghost" size="sm" className="-ms-2.5" onClick={() => void onExport()}>
          <Trans>Export</Trans>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="-ms-2.5 text-destructive hover:text-destructive"
          onClick={onClear}
        >
          <Trans>Clear conversation</Trans>
        </Button>
      </div>
    </div>
  );
}

function sameStringList(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function catalogLabel(
  catalog: ModelCatalogEntry[],
  provider: string | null | undefined,
  modelId: string,
) {
  if (!provider) return undefined;
  return catalog.find((entry) => entry.provider === provider && entry.id === modelId)?.label;
}
