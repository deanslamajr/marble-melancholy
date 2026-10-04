import { useEffect, useRef } from "preact/hooks";
import { ENTITY_SPECS } from "../../../level/entities/specs";
import {
  SLOPE,
  SURFACE,
  WALL,
  type Cell,
  type EntitySource,
  type LevelSource,
} from "../../../level/types";
import { brushCells, gridOf, waypointsOf } from "../commands";
import type { EditorState } from "../EditorState";
import { TOOL_BY_ID, type ToolEvent } from "../tools";

const ZOOM_MIN = 8;
const ZOOM_MAX = 64;
const BRUSH_TOOLS = new Set(["height", "setHeight", "slope", "surface", "void"]);

function heightColor(h: number): string {
  const l = 16 + (h / 35) * 58;
  return `hsl(222, 22%, ${l.toFixed(1)}%)`;
}

const ARROW: Record<number, [number, number]> = {
  [SLOPE.N]: [0, -1],
  [SLOPE.E]: [1, 0],
  [SLOPE.S]: [0, 1],
  [SLOPE.W]: [-1, 0],
  [SLOPE.n]: [0, -1],
  [SLOPE.e]: [1, 0],
  [SLOPE.s]: [0, 1],
  [SLOPE.w]: [-1, 0],
};

const SPEED_DIR: Record<number, [number, number]> = {
  [SURFACE.speedN]: [0, -1],
  [SURFACE.speedE]: [1, 0],
  [SURFACE.speedS]: [0, 1],
  [SURFACE.speedW]: [-1, 0],
};

export function TopDownView(props: { ed: EditorState }) {
  const { ed } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: "tool" | "pan"; lastX: number; lastY: number; cell: string } | null>(
    null,
  );
  const spaceDown = useRef(false);

  // Redraw whenever any signal used by draw() changes.
  const src = ed.source.value;
  const deps = [
    src,
    ed.zoom.value,
    ed.pan.value,
    ed.hover.value,
    ed.selection.value,
    ed.layers.value,
    ed.solve.value,
    ed.tool.value,
    ed.brush.value,
    ed.focusCell.value,
    ed.marquee.value,
    ed.version.value,
  ];

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, w, h, ed, src);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    const onResize = () => ed.version.value++;
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(onResize) : null;
    if (wrapRef.current && ro) ro.observe(wrapRef.current);
    const kd = (e: KeyboardEvent) => {
      if (e.code === "Space" && (e.target as HTMLElement)?.tagName !== "INPUT")
        spaceDown.current = true;
    };
    const ku = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceDown.current = false;
    };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => {
      ro?.disconnect();
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
    };
  }, [ed]);

  // Fit the whole grid on first open.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || ed.fitted) return;
    ed.fitted = true;
    const { width, height } = ed.src.grid;
    const margin = 24;
    const z = Math.floor(
      Math.min((wrap.clientWidth - margin * 2) / width, (wrap.clientHeight - margin * 2) / height),
    );
    const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
    ed.zoom.value = zoom;
    ed.pan.value = {
      x: (wrap.clientWidth - width * zoom) / 2,
      y: (wrap.clientHeight - height * zoom) / 2,
    };
  }, [ed]);

  // Centre the focused cell (diagnostic click).
  useEffect(() => {
    const c = ed.focusCell.value;
    const wrap = wrapRef.current;
    if (!c || !wrap) return;
    const z = ed.zoom.value;
    ed.pan.value = {
      x: wrap.clientWidth / 2 - (c[0] + 0.5) * z,
      y: wrap.clientHeight / 2 - (c[1] + 0.5) * z,
    };
  }, [ed, ed.focusCell.value]);

  const toCell = (
    ev: PointerEvent | WheelEvent,
  ): { cell: Cell; fx: number; fy: number; mx: number; my: number } => {
    const r = canvasRef.current!.getBoundingClientRect();
    const mx = ev.clientX - r.left;
    const my = ev.clientY - r.top;
    const z = ed.zoom.value;
    const gx = (mx - ed.pan.value.x) / z;
    const gy = (my - ed.pan.value.y) / z;
    const cx = Math.floor(gx);
    const cy = Math.floor(gy);
    return { cell: [cx, cy], fx: gx - cx, fy: gy - cy, mx, my };
  };

  const inside = (c: Cell) =>
    c[0] >= 0 && c[1] >= 0 && c[0] < ed.src.grid.width && c[1] < ed.src.grid.height;

  const toolEvent = (ev: PointerEvent, p: ReturnType<typeof toCell>): ToolEvent => ({
    ed,
    cell: p.cell,
    fx: p.fx,
    fy: p.fy,
    button: ev.button === 2 || (ev.buttons & 2) !== 0 ? 2 : 0,
    shift: ev.shiftKey,
    alt: ev.altKey,
  });

  const onDown = (ev: PointerEvent) => {
    (ev.target as HTMLElement).setPointerCapture(ev.pointerId);
    const p = toCell(ev);
    if (ev.button === 1 || spaceDown.current) {
      drag.current = { kind: "pan", lastX: ev.clientX, lastY: ev.clientY, cell: "" };
      return;
    }
    if (!inside(p.cell)) return;
    const tool = TOOL_BY_ID[ed.tool.value];
    if (tool.stroke) ed.beginStroke();
    drag.current = {
      kind: "tool",
      lastX: ev.clientX,
      lastY: ev.clientY,
      cell: `${p.cell[0]},${p.cell[1]}`,
    };
    tool.down(toolEvent(ev, p));
  };

  const onMove = (ev: PointerEvent) => {
    const p = toCell(ev);
    const hv = ed.hover.value;
    if (!hv || hv[0] !== p.cell[0] || hv[1] !== p.cell[1])
      ed.hover.value = inside(p.cell) ? p.cell : null;
    const d = drag.current;
    if (!d) return;
    if (d.kind === "pan") {
      ed.pan.value = {
        x: ed.pan.value.x + ev.clientX - d.lastX,
        y: ed.pan.value.y + ev.clientY - d.lastY,
      };
      d.lastX = ev.clientX;
      d.lastY = ev.clientY;
      return;
    }
    const key = `${p.cell[0]},${p.cell[1]}`;
    const tool = TOOL_BY_ID[ed.tool.value];
    if (inside(p.cell) && (key !== d.cell || tool.id === "wall")) {
      d.cell = key;
      tool.drag?.(toolEvent(ev, p));
    }
  };

  const onUp = (ev: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.kind !== "tool") return;
    const tool = TOOL_BY_ID[ed.tool.value];
    tool.up?.(toolEvent(ev, toCell(ev)));
    if (tool.stroke) ed.endStroke();
  };

  const onWheel = (ev: WheelEvent) => {
    ev.preventDefault();
    const p = toCell(ev);
    const z0 = ed.zoom.value;
    const z1 = Math.max(
      ZOOM_MIN,
      Math.min(ZOOM_MAX, Math.round(z0 * (ev.deltaY < 0 ? 1.15 : 1 / 1.15))),
    );
    if (z1 === z0) return;
    const k = z1 / z0;
    ed.zoom.value = z1;
    ed.pan.value = { x: p.mx - (p.mx - ed.pan.value.x) * k, y: p.my - (p.my - ed.pan.value.y) * k };
  };

  return (
    <div class="viewport" ref={wrapRef} data-testid="topdown-view">
      <canvas
        ref={canvasRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => (ed.hover.value = null)}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
        style={{ cursor: spaceDown.current ? "grab" : "crosshair" }}
      />
    </div>
  );
}

function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  ed: EditorState,
  src: LevelSource,
): void {
  const z = ed.zoom.value;
  const { x: ox, y: oy } = ed.pan.value;
  const vis = ed.layers.value;
  const g = gridOf(src);
  ctx.fillStyle = "#0a0b16";
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.translate(ox, oy);

  // grid backdrop
  ctx.fillStyle = "#121427";
  ctx.fillRect(0, 0, g.w * z, g.h * z);

  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const i = y * g.w + x;
      const hh = g.heights[i]!;
      const px = x * z;
      const py = y * z;
      if (hh < 0) continue;
      ctx.fillStyle = vis.heights ? heightColor(hh) : "#3a3f5c";
      ctx.fillRect(px, py, z, z);
      if (vis.surfaces) drawSurface(ctx, g.surfaces[i]!, px, py, z);
      if (vis.slopes) drawSlope(ctx, g.slopes[i]!, px, py, z);
      if (vis.heights && z >= 18) {
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.font = `${Math.floor(z * 0.32)}px monospace`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(String(hh), px + 2, py + 1);
      }
    }
  }

  // grid lines
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= g.w; x++) {
    ctx.moveTo(x * z + 0.5, 0);
    ctx.lineTo(x * z + 0.5, g.h * z);
  }
  for (let y = 0; y <= g.h; y++) {
    ctx.moveTo(0, y * z + 0.5);
    ctx.lineTo(g.w * z, y * z + 0.5);
  }
  ctx.stroke();

  if (vis.walls) {
    ctx.strokeStyle = "#ffe08a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const wv = g.walls[y * g.w + x]!;
        if (!wv) continue;
        const px = x * z;
        const py = y * z;
        const seg = (x0: number, y0: number, x1: number, y1: number) => {
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
        };
        if (wv & WALL.N) seg(px, py + 1.5, px + z, py + 1.5);
        if (wv & WALL.S) seg(px, py + z - 1.5, px + z, py + z - 1.5);
        if (wv & WALL.W) seg(px + 1.5, py, px + 1.5, py + z);
        if (wv & WALL.E) seg(px + z - 1.5, py, px + z - 1.5, py + z);
      }
    }
    ctx.stroke();
  }

  // solve overlay
  const sv = ed.solve.value;
  if (sv && sv.path.length > 1) {
    ctx.strokeStyle = sv.ok ? "rgba(123,224,138,0.8)" : "rgba(255,90,79,0.8)";
    ctx.lineWidth = Math.max(2, z * 0.12);
    ctx.beginPath();
    sv.path.forEach((c, k) => {
      const X = (c[0] + 0.5) * z;
      const Y = (c[1] + 0.5) * z;
      if (k === 0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    });
    ctx.stroke();
    for (const c of sv.deathCells) glyph(ctx, "✕", c, z, "#ff5a4f");
  }

  // markers
  const cps = src.checkpoints ?? [];
  cps.forEach((cp, k) => {
    const sel = ed.selection.value;
    ring(
      ctx,
      cp.at,
      (cp.radius ?? 1) * z,
      z,
      sel?.kind === "checkpoint" && sel.index === k ? "#6fd3ff" : "#ffd447",
    );
    glyph(ctx, "✚", cp.at, z, "#ffd447");
  });
  glyph(ctx, "1", src.start.p1, z, "#2f6df6", true);
  glyph(ctx, "2", src.start.p2, z, "#f29a2e", true);
  glyph(ctx, "★", src.goal.at, z, "#ffd447", true);
  ring(ctx, src.goal.at, (src.goal.radius ?? 0.8) * z, z, "rgba(255,212,71,0.7)");

  if (vis.entities) {
    const sel = ed.selection.value;
    (src.entities ?? []).forEach((e, k) => {
      const selected = sel?.kind === "entities" && sel.indices.includes(k);
      drawEntity(ctx, e, z, selected);
    });
  }

  if (vis.waypoints) {
    const wps = waypointsOf(src);
    if (wps.length > 0) {
      ctx.strokeStyle = "rgba(111,211,255,0.6)";
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo((src.start.p1[0] + 0.5) * z, (src.start.p1[1] + 0.5) * z);
      for (const p of wps) ctx.lineTo((p.at[0] + 0.5) * z, (p.at[1] + 0.5) * z);
      ctx.stroke();
      ctx.setLineDash([]);
      const sel = ed.selection.value;
      wps.forEach((p, k) => {
        const on = sel?.kind === "waypoint" && sel.index === k;
        ctx.fillStyle = on ? "#6fd3ff" : "rgba(111,211,255,0.85)";
        ctx.beginPath();
        ctx.arc((p.at[0] + 0.5) * z, (p.at[1] + 0.5) * z, Math.max(5, z * 0.28), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#08101a";
        ctx.font = `bold ${Math.max(8, Math.floor(z * 0.3))}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(k), (p.at[0] + 0.5) * z, (p.at[1] + 0.5) * z);
      });
    }
  }

  const mq = ed.marquee.value;
  if (mq) {
    const x0 = Math.min(mq.a[0], mq.b[0]);
    const y0 = Math.min(mq.a[1], mq.b[1]);
    const x1 = Math.max(mq.a[0], mq.b[0]) + 1;
    const y1 = Math.max(mq.a[1], mq.b[1]) + 1;
    ctx.fillStyle = "rgba(111,211,255,0.12)";
    ctx.fillRect(x0 * z, y0 * z, (x1 - x0) * z, (y1 - y0) * z);
    ctx.strokeStyle = "#6fd3ff";
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 * z + 0.5, y0 * z + 0.5, (x1 - x0) * z - 1, (y1 - y0) * z - 1);
    ctx.setLineDash([]);
  }

  // hover
  const hv = ed.hover.value;
  if (hv) {
    const size = BRUSH_TOOLS.has(ed.tool.value) ? ed.brush.value : 1;
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 1.5;
    for (const c of brushCells(hv, size, g.w, g.h))
      ctx.strokeRect(c[0] * z + 0.5, c[1] * z + 0.5, z - 1, z - 1);
    if (ed.tool.value === "wall") {
      ctx.strokeStyle = "#ffe08a";
      ctx.lineWidth = 3;
      ctx.strokeRect(hv[0] * z + 3, hv[1] * z + 3, z - 6, z - 6);
    }
  }
  ctx.restore();
}

function drawSurface(
  ctx: CanvasRenderingContext2D,
  s: number,
  px: number,
  py: number,
  z: number,
): void {
  if (s === SURFACE.normal) return;
  ctx.save();
  if (s === SURFACE.ice) {
    ctx.fillStyle = "rgba(190,230,255,0.35)";
    ctx.fillRect(px, py, z, z);
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0.25; k < 1; k += 0.25) {
      ctx.moveTo(px + k * z, py);
      ctx.lineTo(px, py + k * z);
    }
    ctx.stroke();
  } else if (s === SURFACE.acid) {
    ctx.fillStyle = "#3fae4a";
    ctx.fillRect(px, py, z, z);
    ctx.fillStyle = "#2a7a32";
    for (const [a, b] of [
      [0.3, 0.3],
      [0.7, 0.5],
      [0.4, 0.75],
    ] as const) {
      ctx.beginPath();
      ctx.arc(px + a * z, py + b * z, z * 0.09, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    const d = SPEED_DIR[s] ?? [0, 1];
    ctx.strokeStyle = "rgba(255,212,71,0.9)";
    ctx.lineWidth = Math.max(1, z * 0.08);
    for (const off of [-0.2, 0.1]) {
      const cx = px + z / 2 + d[0] * off * z;
      const cy = py + z / 2 + d[1] * off * z;
      ctx.beginPath();
      ctx.moveTo(cx - d[0] * 0.12 * z - d[1] * 0.2 * z, cy - d[1] * 0.12 * z - d[0] * 0.2 * z);
      ctx.lineTo(cx + d[0] * 0.12 * z, cy + d[1] * 0.12 * z);
      ctx.lineTo(cx - d[0] * 0.12 * z + d[1] * 0.2 * z, cy - d[1] * 0.12 * z + d[0] * 0.2 * z);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawSlope(
  ctx: CanvasRenderingContext2D,
  s: number,
  px: number,
  py: number,
  z: number,
): void {
  const d = ARROW[s];
  if (!d) return;
  const steep = s >= SLOPE.n;
  const cx = px + z / 2;
  const cy = py + z / 2;
  const L = z * 0.32;
  ctx.strokeStyle = steep ? "#ff9d5c" : "rgba(255,255,255,0.75)";
  ctx.lineWidth = steep ? 2 : 1.5;
  ctx.beginPath();
  // Arrow points downhill; the slope code names the descending direction.
  const [dx, dy] = d;
  ctx.moveTo(cx - dx * L, cy - dy * L);
  ctx.lineTo(cx + dx * L, cy + dy * L);
  ctx.lineTo(cx + dx * L * 0.4 - dy * L * 0.5, cy + dy * L * 0.4 - dx * L * 0.5);
  ctx.moveTo(cx + dx * L, cy + dy * L);
  ctx.lineTo(cx + dx * L * 0.4 + dy * L * 0.5, cy + dy * L * 0.4 + dx * L * 0.5);
  ctx.stroke();
}

function glyph(
  ctx: CanvasRenderingContext2D,
  t: string,
  c: Cell,
  z: number,
  color: string,
  disc = false,
): void {
  const X = (c[0] + 0.5) * z;
  const Y = (c[1] + 0.5) * z;
  if (disc) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath();
    ctx.arc(X, Y, z * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = color;
  ctx.font = `bold ${Math.max(9, Math.floor(z * 0.6))}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(t, X, Y + 1);
}

function ring(ctx: CanvasRenderingContext2D, c: Cell, r: number, z: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc((c[0] + 0.5) * z, (c[1] + 0.5) * z, r, 0, Math.PI * 2);
  ctx.stroke();
}

function drawEntity(
  ctx: CanvasRenderingContext2D,
  e: EntitySource,
  z: number,
  selected: boolean,
): void {
  const color = selected ? "#6fd3ff" : "#ff7ad9";
  const spec = ENTITY_SPECS[e.type];
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = selected ? 2.5 : 1.5;
  switch (e.type) {
    case "wave": {
      const [x0, y0, x1, y1] = e.rect;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(x0 * z, y0 * z, (x1 - x0 + 1) * z, (y1 - y0 + 1) * z);
      ctx.setLineDash([]);
      glyph(ctx, "~", [x0, y0], z, color);
      break;
    }
    case "platform": {
      const [sw, sh] = e.size ?? [2, 2];
      ctx.strokeRect(e.at[0] * z, e.at[1] * z, sw * z, sh * z);
      pathLine(ctx, e.path, z, color, sw, sh);
      glyph(ctx, "▭", e.at, z, color);
      break;
    }
    case "pipe": {
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo((e.entry[0] + 0.5) * z, (e.entry[1] + 0.5) * z);
      ctx.lineTo((e.exit[0] + 0.5) * z, (e.exit[1] + 0.5) * z);
      ctx.stroke();
      ctx.setLineDash([]);
      glyph(ctx, "◎", e.entry, z, color, true);
      glyph(ctx, "○", e.exit, z, color);
      break;
    }
    case "funnel": {
      ring(ctx, e.at, (e.radius ?? 2.5) * z, z, color);
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo((e.at[0] + 0.5) * z, (e.at[1] + 0.5) * z);
      ctx.lineTo((e.exit[0] + 0.5) * z, (e.exit[1] + 0.5) * z);
      ctx.stroke();
      ctx.setLineDash([]);
      glyph(ctx, "◉", e.at, z, color, true);
      glyph(ctx, "○", e.exit, z, color);
      break;
    }
    default: {
      if ("path" in e && e.path && e.path.length > 1) pathLine(ctx, e.path, z, color, 1, 1);
      if (e.type === "hoover") ring(ctx, e.at, (e.pullRadius ?? 3) * z, z, "rgba(255,122,217,0.4)");
      glyph(ctx, spec.glyph, e.at, z, color, true);
    }
  }
  ctx.restore();
}

function pathLine(
  ctx: CanvasRenderingContext2D,
  path: Cell[],
  z: number,
  color: string,
  w: number,
  h: number,
): void {
  if (path.length < 2) return;
  ctx.strokeStyle = color;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  path.forEach((c, k) => {
    const X = (c[0] + w / 2) * z;
    const Y = (c[1] + h / 2) * z;
    if (k === 0) ctx.moveTo(X, Y);
    else ctx.lineTo(X, Y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
}
