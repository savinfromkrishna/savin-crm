import { waitForModelOAuthCompletion } from "@savingroup/core";
import { rpc } from "./rpc";

export type { ModelCatalogEntry, ModelCredential, ModelOAuthBegin } from "@savingroup/contracts";
export { cancelModelOAuthAttempt, finishModelOAuthAttempt } from "@savingroup/core";

export async function waitForModelOAuth(loginId: string, signal?: AbortSignal) {
  return waitForModelOAuthCompletion(() => rpc.models.completeOAuth({ loginId }, { signal }), {
    signal,
  });
}
