import type { ThinkingLevel } from "@savingroup/contracts";
import { GROUP_MEMBER_MAX, GROUP_MEMBER_MIN } from "@savingroup/contracts";
import { connectedModelChoices, modelOptionKey, parseModelOptionKey } from "@savingroup/core";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, Text, TextInput, View } from "react-native";
import { BotMemberPicker } from "../components/bot-member-picker";
import { glassHeaderOptions } from "../components/glass-title";
import type { MenuPickerChoice } from "../components/menu-picker";
import { MenuPicker } from "../components/menu-picker";
import { NativeActionButton } from "../components/native-action-button";
import {
  type MobileBot,
  type MobileGroup,
  type MobileModel,
  type MobileModelCredential,
  rpc,
} from "../lib/api";
import { useI18n } from "../lib/i18n";
import { native, useMobileTokens } from "../lib/native";
import { thinkingLevelLabel } from "../lib/thinking-level";
import { errorText } from "../lib/user-error";

function groupModelKey(group: MobileGroup) {
  return group.modelProvider && group.modelId
    ? modelOptionKey(group.modelProvider, group.modelId)
    : "";
}

export default function GroupSettingsScreen() {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const router = useRouter();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const [group, setGroup] = useState<MobileGroup | null>(null);
  const [bots, setBots] = useState<MobileBot[]>([]);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [modelKey, setModelKey] = useState("");
  const [thinkingLevel, setThinkingLevel] = useState("");
  const [credentials, setCredentials] = useState<MobileModelCredential[]>([]);
  const [catalog, setCatalog] = useState<MobileModel[]>([]);
  const [modelMetaError, setModelMetaError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!groupId) return;
    void Promise.all([
      rpc<MobileGroup[]>("groups/list").then(
        (groups) => groups.find((row) => row.id === groupId) ?? null,
      ),
      rpc<MobileBot[]>("bots/list"),
    ])
      .then(([nextGroup, nextBots]) => {
        if (!nextGroup) throw new Error(t("Group not found"));
        setGroup(nextGroup);
        setName(nextGroup.name);
        setSelected(nextGroup.members.map((member) => member.botId));
        setModelKey(groupModelKey(nextGroup));
        setThinkingLevel(nextGroup.thinkingLevel ?? "");
        setBots(nextBots.filter((bot) => !bot.archivedAt));
      })
      .catch((err) => setError(errorText(err, t("Could not load group"))));
  }, [groupId]);

  useEffect(() => {
    void Promise.all([
      rpc<MobileModel[]>("models/list"),
      rpc<MobileModelCredential[]>("models/credentials"),
    ])
      .then(([nextCatalog, nextCredentials]) => {
        setCatalog(nextCatalog);
        setCredentials(nextCredentials);
        setModelMetaError(null);
      })
      .catch((err) => setModelMetaError(errorText(err, t("Could not load model settings"))));
  }, [t]);

  const connectedOptions = useMemo(
    () => connectedModelChoices(credentials, catalog),
    [catalog, credentials],
  );
  const selectedModel = modelKey ? parseModelOptionKey(modelKey) : null;
  const selectedEntry = selectedModel
    ? catalog.find(
        (entry) => entry.provider === selectedModel.provider && entry.id === selectedModel.modelId,
      )
    : undefined;
  const selectedCredential = credentials.find(
    (entry) =>
      entry.provider === selectedModel?.provider && entry.modelId === selectedModel?.modelId,
  );
  const thinkingOptions = (
    selectedCredential?.thinkingLevels ??
    selectedEntry?.thinkingLevels ??
    []
  ).filter((level) => level !== "off");

  const modelChoices: MenuPickerChoice[] = useMemo(() => {
    const choices: MenuPickerChoice[] = [{ key: "", label: t("Each bot's model") }];
    if (modelKey && !connectedOptions.some((option) => option.key === modelKey)) {
      choices.push({ key: modelKey, label: selectedModel?.modelId ?? modelKey });
    }
    for (const option of connectedOptions) {
      choices.push({ key: option.key, label: option.label });
    }
    return choices;
  }, [connectedOptions, modelKey, selectedModel?.modelId, t]);

  const thinkingChoices: MenuPickerChoice[] = [
    {
      key: "",
      label: t("Default ({level})", {
        level: thinkingLevelLabel(selectedCredential?.thinkingLevel ?? "medium", t),
      }),
    },
    ...thinkingOptions.map((level) => ({ key: level, label: thinkingLevelLabel(level, t) })),
  ];

  function selectModel(key: string) {
    if (key === modelKey) return;
    setModelKey(key);
    setThinkingLevel("");
  }

  async function save() {
    if (!groupId || !group || pending) return;
    setPending(true);
    setError(null);
    try {
      const input: {
        groupId: string;
        name?: string;
        botIds?: string[];
        modelProvider?: string | null;
        modelId?: string | null;
        thinkingLevel?: ThinkingLevel | null;
      } = { groupId };
      if (name.trim() !== group.name) input.name = name.trim();
      const memberIds = group.members.map((member) => member.botId).join(",");
      if (selected.join(",") !== memberIds) input.botIds = selected;
      if (modelKey !== groupModelKey(group) || thinkingLevel !== (group.thinkingLevel ?? "")) {
        // The thinking level belongs to the group's model, so they are saved together.
        input.modelProvider = selectedModel?.provider ?? null;
        input.modelId = selectedModel?.modelId ?? null;
        input.thinkingLevel =
          selectedModel && thinkingLevel ? (thinkingLevel as ThinkingLevel) : null;
      }
      if (Object.keys(input).length > 1) await rpc("groups/update", input);
      router.back();
    } catch (err) {
      setError(errorText(err, t("Could not save group")));
    } finally {
      setPending(false);
    }
  }

  function remove() {
    if (!groupId || !group) return;
    Alert.alert(group.name, t("Delete this group? Bots and their solo threads are kept."), [
      { text: t("Cancel"), style: "cancel" },
      {
        text: t("Delete"),
        style: "destructive",
        onPress: () =>
          void rpc("groups/remove", { groupId })
            .then(() => router.replace("/"))
            .catch((err) =>
              Alert.alert(t("Could not delete group"), errorText(err, t("Try again."))),
            ),
      },
    ]);
  }

  return (
    <>
      <Stack.Screen options={glassHeaderOptions(t("Group settings"))} />
      <ScrollView
        style={{ flex: 1, backgroundColor: tokens.background }}
        contentContainerStyle={{ padding: 24 }}
        contentInsetAdjustmentBehavior="automatic"
      >
        <Text style={{ color: tokens.mutedForeground, fontSize: 14 }}>{t("Name")}</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={t("Group name")}
          placeholderTextColor={tokens.mutedForeground}
          style={{
            marginTop: 8,
            backgroundColor: native.fill,
            borderRadius: 11,
            padding: 14,
            color: tokens.foreground,
            fontSize: 16,
          }}
        />
        <Text style={{ color: tokens.mutedForeground, fontSize: 14, marginTop: 20 }}>
          {t("Members")}
        </Text>
        <BotMemberPicker
          bots={bots}
          selected={selected}
          onChange={setSelected}
          disabled={pending}
        />
        <View
          style={{
            marginTop: 20,
            borderRadius: 14,
            backgroundColor: native.fill,
            overflow: "hidden",
          }}
        >
          <MenuPicker
            choices={modelChoices}
            label={t("Model")}
            onChange={selectModel}
            value={modelKey}
          />
          {thinkingOptions.length ? (
            <MenuPicker
              choices={thinkingChoices}
              divider
              label={t("Thinking")}
              onChange={setThinkingLevel}
              value={thinkingLevel}
            />
          ) : null}
        </View>
        {modelMetaError ? (
          <Text style={{ color: tokens.mutedForeground, marginTop: 12, fontSize: 13 }}>
            {modelMetaError}
          </Text>
        ) : null}
        {error ? <Text style={{ color: tokens.destructive, marginTop: 12 }}>{error}</Text> : null}
        <NativeActionButton
          disabled={
            !name.trim() ||
            selected.length < GROUP_MEMBER_MIN ||
            selected.length > GROUP_MEMBER_MAX ||
            pending
          }
          label={pending ? t("Saving…") : t("Save")}
          onPress={() => void save()}
          style={{ marginTop: 24 }}
        />
        <NativeActionButton
          label={t("Delete group")}
          onPress={remove}
          prominence="destructive"
          style={{ marginTop: 16 }}
        />
      </ScrollView>
    </>
  );
}
