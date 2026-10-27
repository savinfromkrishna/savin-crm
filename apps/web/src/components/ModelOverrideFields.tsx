import { Trans, useLingui } from "@lingui/react/macro";
import type { ModelCatalogEntry, ModelCredential } from "@savingroup/contracts";
import { cn, NativeSelect, NativeSelectOption } from "@savingroup/ui-web";
import { useEffect, useState } from "react";
import {
  connectedModelOptions,
  parseModelOptionKey,
  thinkingLevelLabel,
} from "../lib/model-catalog";
import { rpc } from "../lib/rpc";

/** An empty key keeps the model this choice would otherwise inherit. */
export type ModelOverride = { modelKey: string; thinkingLevel: string };

/** Picks a model that replaces an inherited one, then a thinking level it supports. */
export function ModelOverrideFields({
  id,
  inheritLabel,
  value,
  onChange,
  className,
}: {
  id: string;
  inheritLabel: string;
  value: ModelOverride;
  onChange: (next: ModelOverride) => void;
  className?: string;
}) {
  const { t } = useLingui();
  const [credentials, setCredentials] = useState<ModelCredential[]>([]);
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>([]);
  useEffect(() => {
    void Promise.all([rpc.models.credentials(), rpc.models.list()])
      .then(([nextCredentials, nextCatalog]) => {
        setCredentials(nextCredentials);
        setCatalog(nextCatalog);
      })
      .catch(() => undefined);
  }, []);
  const modelOptions = connectedModelOptions(credentials, catalog);
  const selectedModel = value.modelKey ? parseModelOptionKey(value.modelKey) : null;
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
  const defaultThinkingLevel = selectedCredential?.thinkingLevel ?? "medium";

  return (
    <>
      <label
        htmlFor={`${id}-model`}
        className={cn("block text-sm text-muted-foreground", className)}
      >
        <Trans>Model</Trans>
        <NativeSelect
          id={`${id}-model`}
          className="mt-2 w-full"
          value={value.modelKey}
          onChange={(event) => onChange({ modelKey: event.target.value, thinkingLevel: "" })}
        >
          <NativeSelectOption value="">{inheritLabel}</NativeSelectOption>
          {value.modelKey && !modelOptions.some((option) => option.key === value.modelKey) ? (
            <NativeSelectOption value={value.modelKey}>
              {selectedModel?.modelId ?? value.modelKey}
            </NativeSelectOption>
          ) : null}
          {modelOptions.map((option) => (
            <NativeSelectOption key={option.key} value={option.key}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      {thinkingOptions.length ? (
        <label htmlFor={`${id}-thinking`} className="mt-5 block text-sm text-muted-foreground">
          <Trans>Thinking</Trans>
          <NativeSelect
            id={`${id}-thinking`}
            className="mt-2 w-full"
            value={value.thinkingLevel}
            onChange={(event) => onChange({ ...value, thinkingLevel: event.target.value })}
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
    </>
  );
}
