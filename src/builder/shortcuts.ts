// Editor keyboard shortcuts (§6.2 tool table). Tool-specific keys win over global ones.
import { SLOPE, SURFACE } from "../level/types";
import { deleteSelection, importInto, validate, zoomBy } from "./editor/actions";
import type { EditorState } from "./editor/EditorState";
import { TOOLS } from "./editor/tools";

const ARROWS: Record<string, "N" | "E" | "S" | "W"> = {
  ArrowUp: "N",
  ArrowRight: "E",
  ArrowDown: "S",
  ArrowLeft: "W",
};

const PAN_STEP_CELLS = 2;
const DIGIT_WINDOW_MS = 900;

function typing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function installShortcuts(ed: EditorState): () => void {
  let digitBuf = "";
  let digitAt = 0;

  const onKey = (e: KeyboardEvent) => {
    if (ed.playing.value) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;

    if (mod) {
      const lk = k.toLowerCase();
      if (lk === "s") {
        e.preventDefault();
        void ed.save();
      } else if (typing(e.target)) {
        return;
      } else if (lk === "z") {
        e.preventDefault();
        if (e.shiftKey) ed.redo();
        else ed.undo();
      } else if (lk === "y") {
        e.preventDefault();
        ed.redo();
      } else if (lk === "e") {
        e.preventDefault();
        ed.exportMenu.value = !ed.exportMenu.value;
      } else if (lk === "i") {
        e.preventDefault();
        void importInto(ed);
      }
      return;
    }
    if (typing(e.target) || e.altKey) return;

    const tool = ed.tool.value;
    const dir = ARROWS[k];

    // Tool-specific keys.
    if (tool === "setHeight" && /^\d$/.test(k)) {
      const now = performance.now();
      digitBuf = now - digitAt < DIGIT_WINDOW_MS ? (digitBuf + k).slice(-2) : k;
      digitAt = now;
      ed.heightValue.value = Math.min(35, Number(digitBuf));
      e.preventDefault();
      return;
    }
    if (tool === "slope" && dir) {
      ed.slopeValue.value = e.shiftKey
        ? SLOPE[dir.toLowerCase() as "n" | "e" | "s" | "w"]
        : SLOPE[dir];
      e.preventDefault();
      return;
    }
    if (tool === "surface") {
      if (dir) {
        ed.surfaceValue.value = SURFACE[`speed${dir}`];
        e.preventDefault();
        return;
      }
      const s =
        k === "." ? SURFACE.normal : k === "i" ? SURFACE.ice : k === "a" ? SURFACE.acid : null;
      if (s !== null) {
        ed.surfaceValue.value = s;
        e.preventDefault();
        return;
      }
    }

    if (dir) {
      const step = ed.zoom.value * PAN_STEP_CELLS;
      const d = { N: [0, step], S: [0, -step], E: [-step, 0], W: [step, 0] }[dir];
      ed.pan.value = { x: ed.pan.value.x + d[0]!, y: ed.pan.value.y + d[1]! };
      e.preventDefault();
      return;
    }

    switch (k) {
      case "Tab":
        e.preventDefault();
        ed.view.value = ed.view.value === "top" ? "iso" : "top";
        return;
      case "F5":
      case "t":
      case "T":
        e.preventDefault();
        ed.startTestPlay(false);
        return;
      case "r":
      case "R":
        e.preventDefault();
        ed.startTestPlay(true);
        return;
      case "a":
      case "A":
        e.preventDefault();
        ed.autoSolve();
        return;
      case "F7":
        e.preventDefault();
        validate(ed);
        return;
      case "[":
        ed.brush.value = ed.brush.value === 5 ? 3 : 1;
        return;
      case "]":
        ed.brush.value = ed.brush.value === 1 ? 3 : 5;
        return;
      case "+":
      case "=":
        zoomBy(ed, 1.25);
        return;
      case "-":
      case "_":
        zoomBy(ed, 0.8);
        return;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        deleteSelection(ed);
        return;
      case "Enter":
        if (ed.pendingPath.value !== null) {
          ed.pendingPath.value = null;
          ed.notify("Path finished");
        }
        return;
      case "Escape":
        if (ed.pendingPath.value !== null) ed.pendingPath.value = null;
        else if (ed.exportMenu.value) ed.exportMenu.value = false;
        else ed.selection.value = null;
        ed.marquee.value = null;
        return;
    }

    const t = TOOLS.find((x) => x.key === k.toLowerCase());
    if (t) {
      ed.tool.value = t.id;
      if (t.id !== "entity") ed.pendingPath.value = null;
      e.preventDefault();
    }
  };

  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
