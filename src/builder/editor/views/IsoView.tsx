import { useEffect, useRef, useState } from "preact/hooks";
import type { AudioEngine } from "../../../audio/AudioEngine";
import { InputManager } from "../../../input/InputManager";
import { VIEW_H, VIEW_W } from "../../../render/iso";
import { Camera } from "../../../render/camera";
import { Renderer } from "../../../render/Renderer";
import { loadSettings } from "../../../storage/settings";
import type { EditorState } from "../EditorState";
import { TestPlay } from "../../testplay/TestPlay";

/** Iso preview (free camera) and the surface test-play runs on (§6.2). */
export function IsoView(props: { ed: EditorState; audio: AudioEngine }) {
  const { ed, audio } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rig = useRef<{ renderer: Renderer; camera: Camera; input: InputManager } | null>(null);
  const play = useRef<TestPlay | null>(null);
  const centred = useRef(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const version = ed.version.value;
  const playing = ed.playing.value;
  const solve = ed.solve.value;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const renderer = new Renderer(canvas, { debug: false });
    const s = loadSettings();
    const input = new InputManager({
      mouseSensitivity: s.mouseSensitivity,
      keyboardMapping: s.keyboardMapping,
      p2Keys: s.p2Keys,
    });
    input.attach(canvas);
    const camera = new Camera({
      minSx: -VIEW_W / 2,
      maxSx: VIEW_W / 2,
      minSy: -VIEW_H / 2,
      maxSy: VIEW_H / 2,
    });
    camera.free = true;
    camera.setView(renderer.viewW, renderer.viewH);
    rig.current = { renderer, camera, input };
    const onResize = () => {
      renderer.resize();
      camera.setView(renderer.viewW, renderer.viewH);
    };
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(onResize) : null;
    ro?.observe(canvas);
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!play.current) renderer.drawStatic(camera, dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      play.current?.dispose();
      play.current = null;
      input.detach();
      renderer.dispose();
      rig.current = null;
    };
  }, []);

  // Rebuild the preview level after edits (debounced).
  useEffect(() => {
    if (playing) return;
    const t = setTimeout(() => {
      const r = rig.current;
      if (!r) return;
      const level = ed.playable();
      if (!level) {
        setBlocked("Fix validation errors to preview");
        return;
      }
      setBlocked(null);
      r.renderer.setLevel(level);
      r.camera.setBounds(level.bounds);
      if (!centred.current) {
        centred.current = true;
        const sx = (level.start.p1[0] - level.start.p1[1]) * 32;
        const sy = (level.start.p1[0] + level.start.p1[1] + 1) * 16;
        r.camera.cx = sx;
        r.camera.cy = sy;
      }
    }, 200);
    return () => clearTimeout(t);
  }, [ed, version, playing]);

  useEffect(() => {
    const r = rig.current;
    if (!r) return;
    r.renderer.setPathOverlay(
      solve && solve.path.length > 1 ? solve.path.map((c) => [c[0] + 0.5, c[1] + 0.5]) : null,
    );
  }, [solve]);

  // Start / stop test-play.
  useEffect(() => {
    const r = rig.current;
    if (!r || !playing) return;
    const level = ed.playable();
    if (!level) {
      ed.notify("Fix validation errors before test-play");
      ed.playing.value = null;
      return;
    }
    r.renderer.setPathOverlay(null);
    audio.unlock();
    const tp = new TestPlay(
      level,
      {
        renderer: r.renderer,
        camera: r.camera,
        input: r.input,
        audio,
        onHud: (t) => (ed.playHud.value = t),
        onEnd: (res) => {
          play.current = null;
          r.camera.free = true;
          ed.finishTestPlay(res);
        },
      },
      playing.record,
    );
    play.current = tp;
    canvasRef.current?.focus();
    tp.start();
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        tp.stop();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (play.current === tp) {
        tp.dispose();
        play.current = null;
        r.camera.free = true;
      }
    };
  }, [ed, audio, playing]);

  const dragRef = useRef<{ x: number; y: number } | null>(null);

  return (
    <div class="viewport iso" data-testid="iso-view">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        onPointerDown={(e) => {
          if (play.current) return;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          dragRef.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          const r = rig.current;
          if (!d || !r || play.current) return;
          const { k } = r.renderer.clientToView(e.clientX, e.clientY);
          r.camera.pan((e.clientX - d.x) * k, (e.clientY - d.y) * k);
          dragRef.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={() => (dragRef.current = null)}
        onWheel={(e) => {
          const r = rig.current;
          if (!r || play.current) return;
          e.preventDefault();
          const p = r.renderer.clientToView(e.clientX, e.clientY);
          r.camera.zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, p.X, p.Y);
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
      {blocked && !playing && <div class="iso-note">{blocked}</div>}
      {playing && <div class="play-hud">{ed.playHud.value}</div>}
    </div>
  );
}
