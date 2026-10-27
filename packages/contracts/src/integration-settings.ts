import * as z from "zod";

/** Catalog order: the native Google connector lists before hosted catalogs that also offer Google apps. */
export const IntegrationProviderIdSchema = z.enum(["google", "composio", "pipedream"]);
export const IntegrationProviderConfigSchema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("composio"), apiKey: z.string().trim().min(1).max(16384) }),
  z.object({
    provider: z.literal("pipedream"),
    clientId: z.string().trim().min(1).max(512),
    clientSecret: z.string().trim().min(1).max(16384),
    projectId: z.string().trim().min(1).max(512),
    environment: z.enum(["production", "development"]).default("production"),
  }),
  z.object({
    provider: z.literal("google"),
    clientId: z.string().trim().min(1).max(512),
    clientSecret: z.string().trim().min(1).max(16384),
  }),
]);
export type IntegrationProviderConfig = z.infer<typeof IntegrationProviderConfigSchema>;
export type IntegrationProviderId = z.infer<typeof IntegrationProviderIdSchema>;
export const IntegrationSetupStateSchema = z.object({
  canConfigure: z.boolean(),
  needsSetup: z.boolean(),
  webUrl: z.string().url(),
  providers: z.array(
    z.object({
      id: IntegrationProviderIdSchema,
      configured: z.boolean(),
      /** OAuth redirect URI to register with the provider, when it calls back to Savingroup. */
      callbackUrl: z.string().url().optional(),
    }),
  ),
});
export type IntegrationSetupState = z.infer<typeof IntegrationSetupStateSchema>;
