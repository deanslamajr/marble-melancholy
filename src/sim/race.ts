// RaceSim: players, timers, deaths, respawn, goal, scoring, events (§7.4, §7.8, §7.9).
import { Fnv } from "../core/hash";
import { Rng } from "../core/rng";
import type { PlayableLevel } from "../level/types";
import { collideSpheres, type WallProvider } from "./collision";
import {
  COUNTDOWN_TICKS,
  DEATH_ANIM_TICKS,
  FINISH_WINDOW_TICKS,
  GOAL_SETTLE_TICKS,
  KILL_PLANE_BELOW_MIN,
  MARBLE_RADIUS,
  MARBLE_RESTITUTION,
  RESPAWN_DELAY_TICKS,
  RESPAWN_DROP,
  TICK_HZ,
} from "./constants";
import type { SimEntity } from "./entities/base";
import { CheckpointTrigger } from "./entities/checkpoint";
import { createEntity } from "./entities/factory";
import { integrateMarble, newMarble, type MarbleWorld } from "./marble";
import { Terrain } from "./terrain";
import type {
  DeathCause,
  InputFrame,
  MarbleStatus,
  PlayerSnapshot,
  PlayerState,
  SimEvent,
  SimSnapshot,
} from "./types";

export interface RaceOptions {
  players: 1 | 2;
  /** Starting timer per player in ticks (default timeLimit × 120). */
  startTimeTicks?: readonly number[];
  /** Run the 3 s countdown before GO (default false: tick 0 is GO). */
  countdown?: boolean;
  /** Players sitting out this race (timed out earlier in 2P). */
  sittingOut?: readonly boolean[];
  /** Score carried into this race per player. */
  baseScores?: readonly number[];
}

const STATUS_CODES: Record<MarbleStatus, number> = {
  alive: 1,
  dying: 2,
  waiting: 3,
  transit: 4,
  windup: 5,
  finished: 6,
  eliminated: 7,
};

type Command = { t: "leaveBehind"; player: number };

export class RaceSim implements MarbleWorld {
  readonly level: PlayableLevel;
  readonly terrain: Terrain;
  readonly entities: SimEntity[];
  readonly wallProviders: WallProvider[];
  readonly checkpoints: CheckpointTrigger[];
  readonly killPlane: number;
  readonly rng: Rng;
  readonly players: PlayerState[];
  readonly playerCount: 1 | 2;
  /** Race tick being / last simulated; increments after each racing step. */
  tick = 0;
  countdown: number;
  finishWindow = -1;
  firstFinisher = -1;
  over = false;
  private events: SimEvent[] = [];
  private commands: Command[] = [];

  constructor(level: PlayableLevel, opts: RaceOptions) {
    this.level = level;
    this.playerCount = opts.players;
    this.terrain = new Terrain(level);
    this.rng = new Rng((level.seed ^ opts.players) >>> 0);
    this.entities = level.entities.map((e) => createEntity(e, this));
    this.wallProviders = [];
    for (const e of this.entities) {
      if (e.groundPatch) this.terrain.patches.push(e as Required<Pick<SimEntity, "groundPatch">>);
      if (e.wallSegments) this.wallProviders.push(e as WallProvider);
    }
    this.checkpoints = level.checkpoints.map((c, i) => new CheckpointTrigger(i, c));
    this.killPlane = this.terrain.minZ - KILL_PLANE_BELOW_MIN;
    this.countdown = opts.countdown ? COUNTDOWN_TICKS : 0;
    this.players = [];
    for (let i = 0; i < opts.players; i++) {
      const start = i === 0 ? level.start.p1 : level.start.p2;
      const x = start[0] + 0.5;
      const y = start[1] + 0.5;
      const z = this.terrain.groundAt(x, y, 0)?.z ?? 0;
      const sitting = opts.sittingOut?.[i] ?? false;
      const marble = newMarble(x, y, z);
      if (sitting) marble.status = "eliminated";
      const base = opts.baseScores?.[i] ?? 0;
      this.players.push({
        index: i as 0 | 1,
        marble,
        timeTicks: opts.startTimeTicks?.[i] ?? level.timing.timeLimit * TICK_HZ,
        score: base,
        baseScore: base,
        progressBest: 0,
        progressScore: 0,
        activeCheckpoint: -1,
        deaths: 0,
        finishTick: -1,
        eliminated: sitting,
        firstHome: false,
      });
    }
    for (const e of this.entities) {
      if (e.type === "platform") e.update(this);
    }
  }

  emit(e: SimEvent): void {
    this.events.push(e);
  }

  /** Queue a left-behind kill for the next tick (the one render→sim command, §7.7). */
  leaveBehind(player: number): void {
    this.commands.push({ t: "leaveBehind", player });
  }

  die(p: PlayerState, cause: DeathCause): void {
    const m = p.marble;
    if (m.status === "finished") {
      m.frozen = true;
      m.vx = 0;
      m.vy = 0;
      m.vz = 0;
      return;
    }
    if (m.status !== "alive" && m.status !== "transit" && m.status !== "windup") return;
    m.status = "dying";
    m.statusTicks = DEATH_ANIM_TICKS[cause];
    m.deathCause = cause;
    m.vx = 0;
    m.vy = 0;
    m.vz = 0;
    m.holder = -1;
    m.carrierVx = 0;
    m.carrierVy = 0;
    p.deaths++;
    this.emit({ t: "death", player: p.index, cause, x: m.x, y: m.y, z: m.z });
  }

  /** Advance exactly one tick. Returns the events emitted during the tick. */
  step(inputs: readonly InputFrame[]): SimEvent[] {
    this.events = [];
    if (this.countdown > 0) {
      if (this.countdown % TICK_HZ === 0) {
        this.emit({ t: "countdown", n: this.countdown / TICK_HZ });
      }
      this.countdown--;
      if (this.countdown === 0) this.emit({ t: "go" });
      return this.events;
    }

    for (const c of this.commands) this.applyCommand(c);
    this.commands.length = 0;

    // 1. timers
    for (const p of this.players) {
      if (p.eliminated || p.marble.status === "finished") continue;
      p.timeTicks--;
      if (p.timeTicks <= 0) {
        p.timeTicks = 0;
        p.eliminated = true;
        p.marble.status = "eliminated";
        p.marble.statusTicks = 0;
        this.emit({ t: "timeout", player: p.index });
      }
    }

    // 2. entities
    for (const e of this.entities) e.update(this);

    // 3. marbles
    for (const p of this.players) {
      const m = p.marble;
      if (m.status === "alive" || (m.status === "finished" && !m.frozen)) {
        integrateMarble(this, p, inputs[p.index] ?? { ax: 0, ay: 0 });
      }
    }

    // 4. interactions
    for (const e of this.entities) {
      for (const p of this.players) e.interact(this, p);
    }
    for (const c of this.checkpoints) {
      for (const p of this.players) c.interact(this, p);
    }
    for (const p of this.players) this.checkGoal(p);

    // 5. marble–marble
    if (this.players.length === 2) {
      const a = this.players[0]!.marble;
      const b = this.players[1]!.marble;
      const ok = (s: MarbleStatus) => s === "alive" || s === "finished";
      if (ok(a.status) && ok(b.status)) {
        const impact = collideSpheres(a, b, 2 * MARBLE_RADIUS, 1, 1, MARBLE_RESTITUTION);
        if (impact >= 1.5) this.emit({ t: "clack", player: 0, impact });
      }
    }

    // 6. status timers
    for (const p of this.players) this.statusTimers(p);

    // 7. finish window / race over
    this.updateRaceOver();

    this.tick++;
    return this.events;
  }

  private applyCommand(c: Command): void {
    const p = this.players[c.player];
    if (!p || p.marble.status !== "alive") return;
    const leader = this.players.find((q) => q !== p && !q.eliminated);
    if (leader) {
      const leaderProg = 1000 - leader.progressBest;
      let best = -1;
      for (let i = 0; i < this.level.checkpoints.length; i++) {
        const cp = this.level.checkpoints[i]!;
        const prog = this.level.cells.progress[cp.at[1] * this.level.grid.width + cp.at[0]] ?? -1;
        if (prog >= leaderProg) best = i;
      }
      p.activeCheckpoint = best;
    }
    this.die(p, "left-behind");
  }

  private checkGoal(p: PlayerState): void {
    const m = p.marble;
    if (m.status !== "alive") return;
    const g = this.level.goal;
    const dx = m.x - (g.at[0] + 0.5);
    const dy = m.y - (g.at[1] + 0.5);
    if (dx * dx + dy * dy >= g.radius * g.radius) return;
    const gz = this.terrain.groundAt(g.at[0] + 0.5, g.at[1] + 0.5, this.tick)?.z ?? m.z;
    if (m.z > gz + 1.0) return;
    const first = this.firstFinisher < 0;
    if (first) this.firstFinisher = p.index;
    m.status = "finished";
    m.statusTicks = GOAL_SETTLE_TICKS;
    m.inputLocked = true;
    p.finishTick = this.tick;
    const sc = this.level.scoring;
    p.score += sc.goal + Math.ceil(p.timeTicks / TICK_HZ) * sc.perSecond;
    if (first && this.playerCount === 2) {
      p.score += sc.firstHome;
      p.firstHome = true;
    }
    if (first && this.playerCount === 2) this.finishWindow = FINISH_WINDOW_TICKS;
    this.emit({ t: "goal", player: p.index, tick: this.tick, first });
  }

  private statusTimers(p: PlayerState): void {
    const m = p.marble;
    switch (m.status) {
      case "dying":
        if (--m.statusTicks <= 0) {
          m.status = "waiting";
          m.statusTicks = RESPAWN_DELAY_TICKS;
        }
        break;
      case "waiting":
        if (--m.statusTicks <= 0) this.respawn(p);
        break;
      case "transit":
      case "windup":
        if (--m.statusTicks <= 0) {
          const holder = this.entities[m.holder];
          if (holder?.release) holder.release(this, p);
          else m.status = "alive";
        }
        break;
      case "finished":
        if (!m.frozen && m.statusTicks > 0 && --m.statusTicks <= 0) m.frozen = true;
        break;
      default:
        break;
    }
  }

  private respawn(p: PlayerState): void {
    const m = p.marble;
    const cp = p.activeCheckpoint >= 0 ? this.level.checkpoints[p.activeCheckpoint] : undefined;
    const cell = cp ? cp.respawnAt : p.index === 0 ? this.level.start.p1 : this.level.start.p2;
    const x = cell[0] + 0.5;
    const y = cell[1] + 0.5;
    const g = this.terrain.groundAt(x, y, this.tick);
    m.x = x;
    m.y = y;
    m.z = (g?.z ?? 0) + RESPAWN_DROP;
    m.vx = 0;
    m.vy = 0;
    m.vz = 0;
    m.grounded = false;
    m.fallStartZ = m.z;
    m.respawnDrop = true;
    m.inputLocked = true;
    m.catapultFlight = false;
    m.status = "alive";
    m.statusTicks = 0;
    m.deathCause = null;
    m.carrierVx = 0;
    m.carrierVy = 0;
    m.lastStrip = -1;
    for (const e of this.entities) e.onRespawn?.(this, x, y);
    this.emit({ t: "respawn", player: p.index });
  }

  private updateRaceOver(): void {
    if (this.over) return;
    if (this.finishWindow > 0) {
      this.finishWindow--;
      if (this.finishWindow === 0) {
        this.over = true;
        this.emit({ t: "raceOver" });
        return;
      }
    }
    const done = this.players.every((p) => p.eliminated || p.marble.status === "finished");
    if (done) {
      this.over = true;
      this.emit({ t: "raceOver" });
    }
  }

  /** FNV-1a over the int32 state stream (§7.1). */
  hash(): string {
    const h = new Fnv();
    h.int(this.tick).int(this.rng.state | 0);
    for (const p of this.players) {
      const m = p.marble;
      h.int(STATUS_CODES[m.status]);
      h.fixed(m.x).fixed(m.y).fixed(m.z).fixed(m.vx).fixed(m.vy).fixed(m.vz);
      h.int(p.deaths).int(p.finishTick).int(p.score).int(p.timeTicks).int(p.activeCheckpoint);
    }
    for (const e of this.entities) e.hashInto(h);
    return h.hex();
  }

  snapshot(): SimSnapshot {
    const players: PlayerSnapshot[] = this.players.map((p) => {
      const m = p.marble;
      const g = this.terrain.groundAt(m.x, m.y, this.tick);
      return {
        index: p.index,
        x: m.x,
        y: m.y,
        z: m.z,
        vx: m.vx + m.carrierVx,
        vy: m.vy + m.carrierVy,
        vz: m.vz,
        status: m.status,
        deathCause: m.deathCause,
        statusTicks: m.statusTicks,
        rollPhase: m.rollPhase,
        grounded: m.grounded,
        groundZ: g ? g.z : null,
        eliminated: p.eliminated,
        timeTicks: p.timeTicks,
        score: p.score,
        deaths: p.deaths,
        activeCheckpoint: p.activeCheckpoint,
        progressBest: p.progressBest,
      };
    });
    return {
      tick: this.tick,
      countdown: this.countdown,
      players,
      entities: this.entities.map((e) => e.snapshot(this)),
      checkpointOwners: this.checkpoints.map((c) => c.owner),
    };
  }
}
