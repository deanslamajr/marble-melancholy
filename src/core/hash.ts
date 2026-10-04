/** Canonical JSON: recursively sorted keys, no whitespace (D18). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue;
      out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

/** SHA-256 hex digest of a UTF-8 string via WebCrypto (Node 20+ and browsers). */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i]!.toString(16).padStart(2, "0");
  return hex;
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a 32-bit of a string's UTF-16 code units (low byte then high byte). */
export function fnv1a32(text: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h = Math.imul(h ^ (c & 0xff), FNV_PRIME);
    h = Math.imul(h ^ (c >>> 8), FNV_PRIME);
  }
  return h >>> 0;
}

/** Incremental FNV-1a 32-bit over an int32 stream (state hashing, §7.1). */
export class Fnv {
  h = FNV_OFFSET;

  int(v: number): this {
    const x = v | 0;
    this.h = Math.imul(this.h ^ (x & 0xff), FNV_PRIME);
    this.h = Math.imul(this.h ^ ((x >>> 8) & 0xff), FNV_PRIME);
    this.h = Math.imul(this.h ^ ((x >>> 16) & 0xff), FNV_PRIME);
    this.h = Math.imul(this.h ^ ((x >>> 24) & 0xff), FNV_PRIME);
    return this;
  }

  /** Fixed-point (×4096) rounding of a float into the stream. */
  fixed(v: number): this {
    return this.int(Math.round(v * 4096));
  }

  bool(b: boolean): this {
    return this.int(b ? 1 : 0);
  }

  hex(): string {
    return (this.h >>> 0).toString(16).padStart(8, "0");
  }
}
