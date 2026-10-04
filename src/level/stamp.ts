// Provenance stamp (§5.4, D13, D18).
import { canonicalJson, sha256Hex } from "../core/hash";
import type { CompiledLevel, Stamp } from "./types";
import { BUILDER_NAME, BUILDER_VERSION, SUPPORTED_VERSIONS } from "./version";

export function normalizeSourceText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export async function contentHashOf(levelWithoutStamp: object): Promise<string> {
  const copy = { ...(levelWithoutStamp as Record<string, unknown>) };
  delete copy.stamp;
  return "sha256:" + (await sha256Hex(canonicalJson(copy)));
}

export async function computeStamp(levelWithoutStamp: object, sourceText: string): Promise<Stamp> {
  return {
    builder: BUILDER_NAME,
    version: BUILDER_VERSION,
    sourceHash: "sha256:" + (await sha256Hex(normalizeSourceText(sourceText))),
    contentHash: await contentHashOf(levelWithoutStamp),
  };
}

export async function verifyStamp(level: CompiledLevel): Promise<{ ok: boolean; reason?: string }> {
  const s = (level as { stamp?: Stamp | null }).stamp;
  if (!s) return { ok: false, reason: "stamp missing" };
  if (s.builder !== BUILDER_NAME)
    return { ok: false, reason: `builder ${JSON.stringify(s.builder)} is not "${BUILDER_NAME}"` };
  if (!SUPPORTED_VERSIONS.includes(s.version)) {
    return {
      ok: false,
      reason: `builder version ${s.version} not in [${SUPPORTED_VERSIONS.join(", ")}]`,
    };
  }
  const h = await contentHashOf(level);
  if (h !== s.contentHash) return { ok: false, reason: `contentHash mismatch (expected ${h})` };
  return { ok: true };
}
