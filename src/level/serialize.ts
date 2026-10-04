// LevelSource → YAML text with layers as block scalars (builder export, decompile).
import { Document, isMap, isScalar, isSeq, Scalar, visit } from "yaml";
import type { LevelSource } from "./types";

const KEY_ORDER = [
  "format",
  "id",
  "name",
  "author",
  "course",
  "theme",
  "music",
  "seed",
  "grid",
  "layers",
  "start",
  "goal",
  "checkpoints",
  "entities",
  "timing",
  "scoring",
  "physics",
  "solution",
];

function ordered(source: LevelSource): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const src = source as unknown as Record<string, unknown>;
  for (const k of KEY_ORDER) if (src[k] !== undefined) out[k] = src[k];
  for (const k of Object.keys(src)) if (!(k in out) && src[k] !== undefined) out[k] = src[k];
  return out;
}

/** Layers end with a newline so they serialize as `|` (clip) block scalars. */
function normLayer(s: string): string {
  const t = s.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  return t + "\n";
}

export function serializeSource(source: LevelSource): string {
  const obj = ordered(source);
  const layers = { ...(obj.layers as Record<string, string>) };
  for (const k of Object.keys(layers)) {
    if (layers[k] === undefined) delete layers[k];
    else layers[k] = normLayer(layers[k]!);
  }
  obj.layers = layers;
  const doc = new Document(obj, { version: "1.2" });
  visit(doc, {
    Seq(_key, node) {
      if (node.items.every((it) => isScalar(it))) node.flow = true;
    },
    Map(_key, node, path) {
      const parent = path[path.length - 1];
      if (!isSeq(parent)) {
        const allScalar = node.items.every((p) => isScalar(p.value) || (isSeq(p.value) && p.value.items.every(isScalar)));
        if (allScalar && node.items.length <= 4 && !node.items.some((p) => isScalar(p.value) && typeof p.value.value === "string" && p.value.value.includes("\n"))) {
          const k = isScalar(_key) ? String(_key.value) : String(_key);
          if (k === "grid" || k === "start" || k === "goal" || k === "timing" || k === "course") node.flow = true;
        }
        return;
      }
      node.flow = node.items.every(
        (p) => isScalar(p.value) || (isSeq(p.value) && p.value.items.every((i) => isScalar(i) || isSeq(i))),
      );
      if (node.flow) {
        visit(node, {
          Seq(_k, s) {
            s.flow = true;
          },
        });
      }
    },
  });
  const layersNode = isMap(doc.contents) ? doc.contents.get("layers", true) : null;
  if (isMap(layersNode)) {
    for (const pair of layersNode.items) {
      if (isScalar(pair.value)) (pair.value as Scalar).type = Scalar.BLOCK_LITERAL;
    }
  }
  return doc.toString({ lineWidth: 100, flowCollectionPadding: true });
}
