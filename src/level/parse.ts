// YAML text → LevelSource, plus layer character decoding (§5.2).
import { isMap, isScalar, LineCounter, parseDocument, type Document } from "yaml";
import { diag, type Diagnostic } from "./diagnostics";
import { LevelSourceShapeSchema } from "./schema";
import { SLOPE, SURFACE, type LevelSource } from "./types";

export type ParseResult =
  | { ok: true; source: LevelSource; layerLines: LayerLines }
  | { ok: false; diagnostics: Diagnostic[] };

/** 1-based YAML line of the first row of each layer block scalar (for diagnostics). */
export type LayerLines = Partial<Record<LayerName, number>>;
export type LayerName = "heights" | "slopes" | "surfaces" | "walls";
export const LAYER_NAMES: readonly LayerName[] = ["heights", "slopes", "surfaces", "walls"];

export function parseSource(yamlText: string): ParseResult {
  const text = yamlText.replace(/\r\n?/g, "\n");
  const lc = new LineCounter();
  let doc: Document;
  try {
    doc = parseDocument(text, { lineCounter: lc, prettyErrors: false, version: "1.2" });
  } catch (e) {
    return { ok: false, diagnostics: [diag("E000", `YAML error: ${(e as Error).message}`)] };
  }
  if (doc.errors.length > 0) {
    return {
      ok: false,
      diagnostics: doc.errors.map((e) => {
        const pos = e.linePos?.[0];
        return diag("E000", `YAML error: ${e.message.split("\n")[0]}`, {
          line: pos?.line ?? null,
          col: pos?.col ?? null,
        });
      }),
    };
  }
  const raw = doc.toJS({ maxAliasCount: 100 }) as unknown;
  const layerLines: LayerLines = {};
  const layersNode = isMap(doc.contents) ? doc.contents.get("layers", true) : null;
  if (isMap(layersNode)) {
    for (const name of LAYER_NAMES) {
      const node = layersNode.get(name, true);
      if (isScalar(node) && node.range) {
        layerLines[name] = lc.linePos(node.range[0]).line + 1;
      }
    }
  }
  return sourceFromObject(raw, layerLines);
}

/** Validate the structural shape of an already-parsed object (e.g. JSON import, builder state). */
export function sourceFromObject(raw: unknown, layerLines: LayerLines = {}): ParseResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, diagnostics: [diag("E027", "level source must be a mapping")] };
  }
  const fmt = (raw as Record<string, unknown>).format;
  if (fmt !== "mm-level-source/1") {
    return {
      ok: false,
      diagnostics: [diag("E021", `unsupported format ${JSON.stringify(fmt)}; expected "mm-level-source/1"`)],
    };
  }
  const r = LevelSourceShapeSchema.safeParse(raw);
  if (!r.success) {
    return {
      ok: false,
      diagnostics: r.error.issues.map((iss) => {
        const path = iss.path.join(".");
        return diag(codeForPath(iss.path, iss.code), `${path || "(root)"}: ${iss.message}`);
      }),
    };
  }
  return { ok: true, source: raw as LevelSource, layerLines };
}

function codeForPath(path: ReadonlyArray<string | number>, issue: string): string {
  const head = String(path[0] ?? "");
  if (issue === "unrecognized_keys") return "E012";
  switch (head) {
    case "grid":
      return "E001";
    case "layers":
      return "E002";
    case "id":
    case "name":
    case "author":
      return "E016";
    case "timing":
      return "E015";
    case "theme":
    case "music":
      return "E025";
    case "physics":
      return "E022";
    case "course":
      return "E023";
    case "start":
      return "E005";
    case "goal":
      return "E006";
    case "entities":
      return "E012";
    case "solution":
      return "E019";
    default:
      return "E027";
  }
}

export interface DecodedLayers {
  heights: number[];
  slopes: number[];
  surfaces: number[];
  walls: number[];
}

const SLOPE_CHARS: Record<string, number> = {
  ".": SLOPE.flat,
  N: SLOPE.N,
  E: SLOPE.E,
  S: SLOPE.S,
  W: SLOPE.W,
  n: SLOPE.n,
  e: SLOPE.e,
  s: SLOPE.s,
  w: SLOPE.w,
};
const SURFACE_CHARS: Record<string, number> = {
  ".": SURFACE.normal,
  i: SURFACE.ice,
  a: SURFACE.acid,
  "^": SURFACE.speedN,
  ">": SURFACE.speedE,
  v: SURFACE.speedS,
  "<": SURFACE.speedW,
};

export function heightChar(h: number): string {
  if (h < 0) return ".";
  if (h < 10) return String(h);
  return String.fromCharCode(65 + h - 10);
}
export function decodeHeightChar(c: string): number | null {
  if (c === ".") return -1;
  if (c >= "0" && c <= "9") return c.charCodeAt(0) - 48;
  if (c >= "A" && c <= "Z") return c.charCodeAt(0) - 55;
  return null;
}
export const SLOPE_TO_CHAR = [".", "N", "E", "S", "W", "n", "e", "s", "w"] as const;
export const SURFACE_TO_CHAR = [".", "i", "a", "^", ">", "v", "<"] as const;
export function wallChar(w: number): string {
  return w === 0 ? "." : w.toString(16).toUpperCase();
}

function layerRows(text: string): string[] {
  const rows = text.replace(/\r\n?/g, "\n").split("\n");
  while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
  return rows;
}

/** Decode the ASCII layers into flat arrays; reports E002/E003/E004. */
export function decodeLayers(
  source: LevelSource,
  layerLines: LayerLines = {},
): { layers: DecodedLayers; diagnostics: Diagnostic[] } {
  const W = source.grid.width;
  const H = source.grid.height;
  const n = W * H;
  const out: DecodedLayers = {
    heights: new Array<number>(n).fill(-1),
    slopes: new Array<number>(n).fill(0),
    surfaces: new Array<number>(n).fill(0),
    walls: new Array<number>(n).fill(0),
  };
  const diags: Diagnostic[] = [];
  for (const name of LAYER_NAMES) {
    const text = source.layers[name];
    if (text === undefined) continue;
    const rows = layerRows(text);
    const base = layerLines[name];
    if (rows.length !== H) {
      diags.push(
        diag("E002", `layer ${name} has ${rows.length} rows; expected ${H}`, {
          layer: name,
          line: base ?? null,
        }),
      );
      continue;
    }
    for (let y = 0; y < H; y++) {
      const row = rows[y]!;
      const line = base !== undefined ? base + y : null;
      if (row.length !== W) {
        diags.push(
          diag("E002", `layer ${name} row ${y} has width ${row.length}; expected ${W}`, {
            layer: name,
            line,
            cell: [0, y],
          }),
        );
        continue;
      }
      for (let x = 0; x < W; x++) {
        const c = row[x]!;
        const i = y * W + x;
        let v: number | null | undefined;
        switch (name) {
          case "heights":
            v = decodeHeightChar(c);
            break;
          case "slopes":
            v = SLOPE_CHARS[c];
            break;
          case "surfaces":
            v = SURFACE_CHARS[c];
            break;
          case "walls":
            v = c === "." ? 0 : /^[0-9A-Fa-f]$/.test(c) ? parseInt(c, 16) : null;
            break;
        }
        if (v === null || v === undefined) {
          diags.push(
            diag("E003", `invalid character ${JSON.stringify(c)} in layer ${name} at row ${y}, col ${x}`, {
              layer: name,
              line,
              col: x + 1,
              cell: [x, y],
            }),
          );
          continue;
        }
        out[name][i] = v;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    if (out.heights[i]! >= 0) continue;
    const x = i % W;
    const y = Math.floor(i / W);
    for (const [name, arr] of [
      ["slopes", out.slopes],
      ["surfaces", out.surfaces],
      ["walls", out.walls],
    ] as const) {
      if (arr[i]! !== 0) {
        diags.push(diag("E004", `${name} set on void cell (${x},${y})`, { layer: name, cell: [x, y] }));
      }
    }
  }
  return { layers: out, diagnostics: diags };
}

/** Re-encode flat arrays into layer strings (decompile, builder). */
export function encodeLayers(
  W: number,
  H: number,
  layers: DecodedLayers,
): { heights: string; slopes: string; surfaces: string; walls: string } {
  const enc = (f: (i: number) => string) => {
    let s = "";
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) s += f(y * W + x);
      s += "\n";
    }
    return s;
  };
  return {
    heights: enc((i) => heightChar(layers.heights[i]!)),
    slopes: enc((i) => SLOPE_TO_CHAR[layers.slopes[i]!] ?? "."),
    surfaces: enc((i) => SURFACE_TO_CHAR[layers.surfaces[i]!] ?? "."),
    walls: enc((i) => wallChar(layers.walls[i]!)),
  };
}
