// AudioEngine music cues and background suspend/resume, against a fake AudioContext.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const started: string[] = [];
const stopped: string[] = [];

vi.mock("../../../src/audio/music/sequencer", () => ({
  Sequencer: class {
    constructor(
      _ctx: unknown,
      _dest: unknown,
      readonly track: { id?: string; bpm: number },
    ) {}
    start() {
      started.push(String(this.track.bpm));
    }
    stop() {
      stopped.push(String(this.track.bpm));
    }
  },
}));

const { AudioEngine } = await import("../../../src/audio/AudioEngine");

function param() {
  return {
    value: 1,
    setTargetAtTime() {},
    setValueAtTime() {},
    cancelScheduledValues() {},
    linearRampToValueAtTime() {},
  };
}

class FakeCtx {
  static last: FakeCtx | null = null;
  state: "suspended" | "running" | "closed" = "suspended";
  currentTime = 0;
  destination = {};
  resumes = 0;
  suspends = 0;
  /** When false, resume() rejects as it does outside a user gesture. */
  static allowResume = true;
  constructor() {
    FakeCtx.last = this;
  }
  createGain() {
    return { gain: param(), connect: (n: unknown) => n, disconnect() {} };
  }
  resume() {
    this.resumes++;
    if (!FakeCtx.allowResume) return Promise.reject(new Error("not allowed"));
    this.state = "running";
    return Promise.resolve();
  }
  suspend() {
    this.suspends++;
    this.state = "suspended";
    return Promise.resolve();
  }
}

const g = globalThis as { AudioContext?: unknown };

beforeEach(() => {
  started.length = 0;
  stopped.length = 0;
  FakeCtx.last = null;
  FakeCtx.allowResume = true;
  g.AudioContext = FakeCtx;
});

afterEach(() => {
  delete g.AudioContext;
});

describe("AudioEngine music cues", () => {
  it("starts music requested before unlock exactly once, and repeat unlocks never restart it", async () => {
    const a = new AudioEngine();
    a.startMusic("m1-first-steps", 0.4, "menu");
    expect(started).toHaveLength(0);
    await a.unlock();
    expect(started).toHaveLength(1);
    // Every click / key / pointerup calls unlock() again, and the controller re-syncs its screen.
    for (let i = 0; i < 5; i++) {
      await a.unlock();
      a.startMusic("m1-first-steps", 0.4, "menu");
    }
    expect(started).toHaveLength(1);
    expect(stopped).toHaveLength(0);
  });

  it("a new cue (new race) or a new track restarts; a call without a cue always restarts", async () => {
    const a = new AudioEngine();
    await a.unlock();
    a.startMusic("m4-skyways", 1, "race1");
    a.startMusic("m4-skyways", 1, "race1");
    expect(started).toHaveLength(1);
    a.startMusic("m4-skyways", 1, "race2");
    expect(started).toHaveLength(2);
    a.startMusic("m1-first-steps", 0.4, "race2");
    expect(started).toHaveLength(3);
    a.startMusic("m1-first-steps", 0.4);
    expect(started).toHaveLength(4);
  });

  it("stopMusic clears the cue so the same screen can start again later", async () => {
    const a = new AudioEngine();
    await a.unlock();
    a.startMusic("m1-first-steps", 0.4, "menu");
    a.stopMusic();
    a.startMusic("m1-first-steps", 0.4, "menu");
    expect(started).toHaveLength(2);
  });
});

describe("AudioEngine background", () => {
  it("suspends a running context when backgrounded and resumes it on return", async () => {
    const a = new AudioEngine();
    await a.unlock();
    const ctx = FakeCtx.last!;
    expect(ctx.state).toBe("running");
    a.setBackground(true);
    expect(ctx.state).toBe("suspended");
    a.setBackground(true);
    expect(ctx.suspends).toBe(1);
    a.setBackground(false);
    expect(ctx.state).toBe("running");
  });

  it("never creates or resumes a context that no gesture unlocked", async () => {
    const a = new AudioEngine();
    a.startMusic("m1-first-steps", 0.4, "menu");
    a.setBackground(true);
    a.setBackground(false);
    expect(FakeCtx.last).toBeNull();
    expect(a.unlocked).toBe(false);

    // A context whose first resume was refused (no real activation) stays suspended.
    FakeCtx.allowResume = false;
    await a.unlock();
    const ctx = FakeCtx.last!;
    const resumes = ctx.resumes;
    a.setBackground(true);
    a.setBackground(false);
    expect(ctx.resumes).toBe(resumes);
    expect(ctx.state).toBe("suspended");
  });
});
