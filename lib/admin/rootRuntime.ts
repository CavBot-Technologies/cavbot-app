import { isAdminHost, normalizeHost } from "./config";

export function shouldRenderSharedRootRuntime(host: string | null | undefined) {
  const normalizedHost = normalizeHost(String(host || ""));
  return !isAdminHost(normalizedHost);
}
