import "server-only";

import { createHash, randomBytes } from "crypto";

import { encryptAesGcmB64 } from "@/lib/cryptoAesGcm.server";

export type ProjectKeyMaterial = {
  serverKeyRaw: string;
  serverKeyHash: string;
  serverKeyLast4: string;
  serverKeyEnc: string;
  serverKeyEncIv: string;
};

export async function createProjectKeyMaterial(rawKey?: string | null): Promise<ProjectKeyMaterial> {
  const serverKeyRaw = String(rawKey || "").trim() || `cavbot_sk_${randomBytes(24).toString("hex")}`;
  const serverKeyHash = createHash("sha256").update(serverKeyRaw).digest("hex");
  const serverKeyLast4 = serverKeyRaw.slice(-4);
  const encrypted = await encryptAesGcmB64(serverKeyRaw);

  return {
    serverKeyRaw,
    serverKeyHash,
    serverKeyLast4,
    serverKeyEnc: encrypted.encB64,
    serverKeyEncIv: encrypted.ivB64,
  };
}
