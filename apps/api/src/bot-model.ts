import type {
  AgentRunModel,
  ModelCredentialFailedState,
  ModelCredentialRetireReason,
  SecretStore,
} from "@savingroup/adapter-kit";
import {
  matchesFailedOAuthSecret,
  resolveModelAuth,
  serializeModelSecret,
  toOAuthCredential,
} from "@savingroup/adapters";
import type { PrismaClient } from "@savingroup/db";
import {
  findDefaultModelCredential,
  findModelCredential,
  retireModelCredential,
} from "@savingroup/db";

export interface BotModelDeps {
  prisma: PrismaClient;
  secrets: SecretStore;
  deploymentProvider: string;
  deploymentModel: string;
  deploymentModelKey?: string;
}

export interface BotModelScope {
  id: string;
  userId: string;
  spaceId: string;
  modelProvider?: string | null;
  modelId?: string | null;
}

/**
 * The model a bot would run with, for a short completion outside a run: the
 * bot's own choice when its Space holds a credential for it, else the Space
 * default, else the deployment default. Mirrors the run path's credential
 * refresh and retirement fences so a stale failure never deletes material a
 * concurrent reconnect persisted.
 */
export async function resolveBotRunModel(
  deps: BotModelDeps,
  bot: BotModelScope,
  options: { providerOverride?: string; modelOverride?: string; secretOperation?: string } = {},
): Promise<{ model: AgentRunModel } | null> {
  const settings = await deps.prisma.deploymentSettings.findUnique({ where: { id: "default" } });
  const scope = { userId: bot.userId, spaceId: bot.spaceId };
  const defaultCredential = await findDefaultModelCredential(deps.prisma, scope);
  const requestedProvider = options.providerOverride ?? bot.modelProvider;
  const requestedModel = options.modelOverride ?? bot.modelId;
  const overrideCredential = requestedProvider
    ? await findModelCredential(deps.prisma, scope, requestedProvider)
    : null;
  const explicitOverride = Boolean(options.providerOverride && options.modelOverride);
  const useOverride = Boolean(
    requestedProvider && requestedModel && (explicitOverride || overrideCredential),
  );
  const credential = useOverride ? overrideCredential : defaultCredential;
  const provider =
    (useOverride ? requestedProvider : null) ??
    credential?.provider ??
    settings?.defaultModelProvider ??
    deps.deploymentProvider;
  const modelId =
    (useOverride ? requestedModel : null) ??
    credential?.defaultModel ??
    settings?.defaultModelId ??
    deps.deploymentModel;
  if (!provider || !modelId) return null;

  if (!credential) {
    const apiKey = provider === deps.deploymentProvider ? deps.deploymentModelKey : undefined;
    return { model: { provider, id: modelId, ...(apiKey ? { apiKey } : {}) } };
  }

  const secret = await deps.prisma.secret.findFirst({
    where: { id: credential.secretId, userId: bot.userId, spaceId: null },
  });
  if (!secret) return null;
  const operation = options.secretOperation ?? "bot-model-credential";
  const persist = async (plaintext: string) => {
    const stored = await deps.secrets.put(
      plaintext,
      {
        operationId: operation,
        traceId: operation,
        spaceId: bot.spaceId,
        userId: bot.userId,
        botId: bot.id,
        signal: new AbortController().signal,
      },
      { recordId: secret.id },
    );
    await deps.prisma.secret.update({
      where: { id: secret.id },
      data: { ciphertext: stored.ciphertext },
    });
  };
  const retire = (
    _reason: ModelCredentialRetireReason,
    _detail: string | undefined,
    failed?: ModelCredentialFailedState,
  ) =>
    retireModelCredential(deps.prisma, {
      userId: bot.userId,
      credentialId: credential.id,
      secretId: credential.secretId,
      matchesFailedSecret: failed
        ? matchesFailedOAuthSecret(
            (ciphertext, secretId) => deps.secrets.load(ciphertext, secretId),
            failed,
          )
        : undefined,
    });
  const plaintext = await deps.secrets.load(secret.ciphertext, secret.id);
  const auth = await resolveModelAuth(plaintext, provider, { persist, retire });
  const parsed = auth.secret;
  const limit = parsed.maxTokens !== undefined ? { maxTokens: parsed.maxTokens } : {};
  const context =
    parsed.kind === "oauth"
      ? {}
      : { cacheCapabilities: parsed.cacheCapabilities, contextWindow: parsed.contextWindow };
  if (parsed.kind === "oauth") {
    return {
      model: {
        provider,
        id: modelId,
        ...limit,
        oauth: {
          credential: { ...parsed.credential },
          persist: async (credential) => {
            await persist(
              serializeModelSecret({
                kind: "oauth",
                credential: toOAuthCredential(credential),
                ...limit,
              }),
            );
          },
          retire,
        },
      },
    };
  }
  if (parsed.kind === "openai_compatible") {
    return {
      model: {
        provider,
        id: modelId,
        apiKey: parsed.apiKey,
        baseUrl: parsed.baseUrl,
        ...limit,
        ...context,
      },
    };
  }
  return { model: { provider, id: modelId, apiKey: auth.apiKey, ...limit, ...context } };
}
