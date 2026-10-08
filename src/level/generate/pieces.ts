// Generator v3 precision pieces (DECISIONS L26). Narrow, mostly rail-less geometry whose difficulty
// comes from steering and momentum: ropes, diagonal staircases, cambers, run-up gaps, sideways
// kickers, chicanes, hairpins, platform chains and hazards placed beside 1-wide paths.
// Same local frame and transactions as Layout (L15, L16).
import { ARROW_TO, DV, S, SLOPE_TO, turnDir, type Dir } from "./grid";
import { Layout } from "./layout";

export class Layout3 extends Layout {
  /** Remove every rail the cells of `piece` would get (all four edges open). */
  openPiece(piece = this.piece): void {
    const g = this.g;
    for (let y = 1; y < g.height - 1; y++)
      for (let x = 1; x < g.width - 1; x++) {
        const i = g.idx(x, y);
        if (g.owner[i] === piece && g.heights[i]! >= 0) g.openEdges(x, y, x, y, 15);
      }
  }

  /** Back to the base lane width for a few flat rows (the breather after a piece). */
  private exitLane(rows: number): void {
    this.setWidth(this.baseW);
    this.flat(rows);
  }

  /** A 1-wide (narrowW) rail-less rope, sometimes iced, sometimes with a gentle dip. */
  rope(): void {
    const t = this.tier;
    const len = this.intIn(t.rope[0], t.rope[1]);
    const ice = this.chance(t.iceRope);
    this.setWidth(t.narrowW);
    const v0 = this.v;
    this.wp(this.cu, v0, 0.7);
    if (this.canDrop && len >= 6 && this.chance(0.5)) {
      const a = (len - 2) >> 1;
      this.flat(a);
      this.ramp(2, false);
      this.flat(len - 2 - a);
    } else this.flat(len);
    this.railless(v0, this.v - 1);
    if (ice) this.surf(this.u, v0 + 1, this.u1, this.v - 2, "i");
    this.wp(this.cu, this.v - 1, 0.8);
    this.exitLane(2);
  }

  /**
   * A staircase tightrope running diagonally across the grid axes: row r covers the cells from
   * floor(r·m) to floor((r+1)·m) across, so consecutive rows share one edge. m = 1 is 45°.
   */
  diagonal(): void {
    const t = this.tier;
    const m = t.diagSlopes[this.rng.nextInt(t.diagSlopes.length)]!;
    const rows = m >= 2 ? this.intIn(3, 4) : m < 1 ? this.intIn(6, 8) : this.intIn(5, 7);
    // Like `jog`, sideways shifts in east/west runs go south, away from the tier above.
    const sign = this.d === S ? (this.chance(0.5) ? 1 : -1) : this.d === turnDir(S, 3) ? 1 : -1;
    this.setWidth(1);
    const c = this.u;
    this.wp(c, this.v, 0.5);
    this.flat(1);
    const at = (r: number) => c + sign * Math.floor(r * m);
    const v0 = this.v;
    for (let r = 0; r < rows; r++) {
      const a = at(r);
      const b = at(r + 1);
      this.fill(Math.min(a, b), v0 + r, Math.max(a, b), v0 + r, this.h);
    }
    const mid = (r: number) => (at(r) + at(r + 1)) / 2;
    this.guide(mid(0), v0);
    this.guide(mid(rows - 1), v0 + rows - 1);
    this.v = v0 + rows;
    this.u = at(rows);
    this.flat(1);
    this.wp(this.cu, this.v - 1, 0.5);
    this.openPiece();
    this.exitLane(2);
  }

  camber(): void {
    this.cambered(1);
  }

  /** Alternating cambers: the slope flips side every few rows (an S-bend of slope). */
  sbend(): void {
    this.cambered(this.intIn(2, 3));
  }

  /**
   * A narrow rail-less path sloping sideways toward one edge, so the player leans against it.
   * Across a block, each cell sits one half-unit below its uphill neighbour so the surface is
   * continuous; each flip drops the path by its width so no edge steps up (no hidden walls).
   */
  private cambered(blocks: number): void {
    const cw = this.tier.camberW;
    this.setWidth(cw);
    const v0 = this.v;
    this.wp(this.cu, v0, 0.6);
    let side = this.chance(0.5) ? 1 : -1;
    for (let b = 0; b < blocks; b++) {
      const rows = blocks === 1 ? this.intIn(5, 7) : this.intIn(3, 4);
      const vb = this.v;
      const ch = SLOPE_TO[turnDir(this.d, side > 0 ? 1 : 3)]!;
      for (let u = this.u; u <= this.u1; u++) {
        const hu = this.h - (side > 0 ? u - this.u : this.u1 - u);
        this.fill(u, vb, u, vb + rows - 1, hu);
        for (let r = 0; r < rows; r++) {
          const [x, y] = this.cell(u, vb + r);
          this.g.setSlope(x, y, ch);
        }
      }
      this.v += rows;
      this.h -= cw;
      this.wp(this.cu, this.v - 1, 0.6);
      side = -side;
    }
    this.railless(v0, this.v - 1);
    this.exitLane(2);
  }

  /** Momentum gate: a narrow rail-less run-up, a two-cell gap that needs near top speed. */
  runup(): void {
    if (!this.canDrop) return this.fail("level");
    const t = this.tier;
    this.setWidth(t.narrowW);
    const v0 = this.v;
    this.flat(6);
    this.railless(v0, this.v - 1);
    const edge = this.v - 1;
    this.open(this.u, edge, this.u1, edge, "F");
    this.wp(this.cu, v0, 0.8);
    this.wp(this.cu, edge, 1);
    this.v += 2;
    this.h -= t.runupDrop;
    this.setWidth(t.landW);
    const land = this.v;
    this.flat(4);
    this.open(this.u, land, this.u1, land, "B");
    if (this.extreme) this.railless(land, this.v - 1);
    this.wp(this.cu, land + 1, 0.8, 0.8);
    this.exitLane(1);
  }

  /** Sideways speed strips across a narrow rail-less lane: each throws the marble at an edge. */
  kicker(): void {
    const t = this.tier;
    this.setWidth(Math.min(3, t.narrowW + 1));
    const v0 = this.v;
    this.flat(3 + 3 * t.kickers);
    this.railless(v0, this.v - 1);
    let side = this.chance(0.5) ? 1 : 3;
    for (let k = 0; k < t.kickers; k++) {
      const sv = v0 + 2 + 3 * k;
      this.surf(this.u, sv, this.u1, sv, ARROW_TO[turnDir(this.d, side)]!);
      side = side === 1 ? 3 : 1;
    }
    this.wp(this.cu, v0, 0.7);
    this.wp(this.cu, this.v - 1, 0.7);
    this.exitLane(1);
  }

  /** A narrow rail-less path that steps sideways 2–3 cells every few rows (two right angles each). */
  chicane(): void {
    const cw = this.tier.narrowW;
    this.setWidth(cw);
    const turns = this.intIn(3, 4);
    let c = this.u;
    let v = this.v;
    let sign = this.chance(0.5) ? 1 : -1;
    const mid = () => c + (cw >> 1);
    this.wp(mid(), v, 0.5);
    for (let i = 0; i < turns; i++) {
      const a = this.intIn(2, 3) + cw - 1;
      this.fill(c, v, c + cw - 1, v + a - 1, this.h);
      const du = sign * this.intIn(2, 3);
      this.fill(Math.min(c, c + du), v + a - cw, Math.max(c, c + du) + cw - 1, v + a - 1, this.h);
      const vc = v + a - 1 - (cw >> 1);
      this.wp(mid(), vc, 0.4, 0.45);
      c += du;
      this.wp(mid(), vc, 0.4, 0.45);
      v += a;
      sign = -sign;
    }
    const a = this.intIn(2, 3);
    this.fill(c, v, c + cw - 1, v + a - 1, this.h);
    this.u = c;
    this.v = v + a;
    this.rest = this.cell(this.cu, this.v - 1);
    this.wp(this.cu, this.v - 1, 0.6);
    this.openPiece();
    this.exitLane(2);
  }

  /** A narrow rail-less U-turn inside an east or west run: two corners close together. */
  hairpin(): void {
    if (this.d === S) return this.fail("hairpin");
    const back = turnDir(this.d, 2) as Dir;
    const hw = this.extreme ? this.tier.narrowW : 2;
    const ice = this.chance(this.tier.corner.ice);
    this.setWidth(hw);
    this.flat(2);
    this.turn(S, { railless: true, ice });
    this.flat(hw + 2);
    this.turn(back, { railless: true, ice });
    this.flat(2);
    this.openPiece();
    this.exitLane(2);
  }

  /** Two shuttling platforms over void with a small island between them; timing matters. */
  chain(): void {
    const t = this.tier;
    const ps = t.chainSize;
    this.setWidth(Math.max(ps, 2));
    this.flat(2);
    const pu = this.u + ((this.w - ps) >> 1);
    const pcu = pu + (ps >> 1);
    const legs: Array<[from: number, to: number]> = [];
    let edge = this.v - 1;
    this.wp(pcu, edge, 0.4, 0.3);
    for (let k = 0; k < 2; k++) {
      this.open(pu, edge, pu + ps - 1, edge, "F");
      this.v += this.intIn(3, 4);
      const land = this.v;
      legs.push([edge + 1, land - 1]);
      this.flat(k === 0 ? 2 : 3);
      this.open(pu, land, pu + ps - 1, land, "B");
      if (k === 0) {
        this.open(pu, land + 1, pu + ps - 1, land + 1, "F");
        this.railless(land, land + 1);
      }
      this.wpAt(this.cell(pcu, land), 0.4, 0.35, "both", true);
      edge = this.v - 1;
    }
    for (const [from, to] of legs) {
      const a = this.rect(pu, from, pu + ps - 1, from);
      const b = this.rect(pu, to, pu + ps - 1, to);
      this.entities.push({
        type: "platform",
        at: [a[0], a[1]],
        size: [a[2] - a[0] + 1, a[3] - a[1] + 1],
        top: this.h,
        path: [
          [a[0], a[1]],
          [b[0], b[1]],
        ],
        speed: t.ferry.speed,
        pause: t.ferry.pause,
        phase: this.rng.nextInt(10) / 10,
      });
    }
    this.wp(this.cu, this.v - 1, 0.6);
  }

  /** A wave floor rolling across a narrow rail-less path, pushing the marble side to side. */
  waveRope(): void {
    const t = this.tier;
    this.setWidth(Math.min(3, t.narrowW + 1));
    const v0 = this.v;
    this.flat(9);
    this.railless(v0, this.v - 1);
    const l = DV[turnDir(this.d, 1)]!;
    this.entities.push({
      type: "wave",
      rect: this.rect(this.u, v0 + 1, this.u1, v0 + 7),
      amplitude: t.waveRopeAmp,
      wavelength: 3,
      speed: 1.5,
      dir: [l[0], l[1]],
    });
    this.wp(this.cu, v0, 0.6);
    this.wp(this.cu, this.v - 1, 0.6);
    this.exitLane(2);
  }

  /** A rope with a hoover on a pedestal beside it, pulling toward the void in pulses. */
  hooverRope(): void {
    const t = this.tier;
    this.setWidth(t.narrowW);
    const v0 = this.v;
    this.flat(9);
    this.railless(v0, this.v - 1);
    const side = this.chance(0.5) ? 1 : -1;
    const gap = this.extreme ? 2 : 3;
    const pu = side > 0 ? this.u1 + gap : this.u - gap;
    const [px, py] = this.cell(pu, v0 + 4);
    this.put(px, py, this.h);
    this.entities.push({
      type: "hoover",
      at: [px, py],
      pullRadius: 5,
      pullStrength: t.hooverRopePull,
      killRadius: 0.4,
      onTime: 1.2,
      offTime: 1.2,
      phase: this.rng.nextInt(24) / 10,
    });
    this.wp(this.cu, v0, 0.6);
    this.wp(this.cu, this.v - 1, 0.6);
    this.exitLane(2);
  }

  /** A rail-less bridge shared with a patrolling steelie. */
  steelieBridge(): void {
    const len = 9;
    const speed = (20 + this.rng.nextInt(10)) / 10;
    if (this.tier.narrowW === 1) {
      // Two wide: the steelie runs the length of one column, the marble keeps to the other.
      this.setWidth(2);
      const v0 = this.v;
      this.flat(len);
      this.railless(v0, this.v - 1);
      const left = this.chance(0.5);
      const col = left ? this.u : this.u1;
      const free = left ? this.u1 : this.u;
      const a = this.cell(col, v0 + 1);
      const b = this.cell(col, v0 + len - 2);
      this.entities.push({ type: "steelie", at: a, mode: "patrol", path: [a, b], speed });
      this.wp(free, v0, 0.6);
      this.wp(free, v0 + len - 1, 0.7);
    } else {
      // Three wide: the steelie sweeps across the middle row like a gate.
      this.setWidth(3);
      const v0 = this.v;
      this.flat(len);
      this.railless(v0, this.v - 1);
      const a = this.cell(this.u, v0 + 4);
      const b = this.cell(this.u1, v0 + 4);
      this.entities.push({ type: "steelie", at: a, mode: "patrol", path: [a, b], speed });
      this.wp(this.cu, v0, 0.6);
      this.wp(this.cu, v0 + len - 1, 0.7);
    }
    this.exitLane(2);
  }

  /** A hammer gauntlet on a 1-wide rail-less rope: stop precisely between the hammers. */
  hammerRope(): void {
    const n = this.extreme ? 4 : 3;
    this.setWidth(1);
    const v0 = this.v;
    this.flat(2 + 3 * n);
    this.railless(v0, this.v - 1);
    this.wp(this.cu, v0, 0.35, 0.4);
    for (let i = 0; i < n; i++) {
      const gv = v0 + 2 + 3 * i;
      const period = (20 + this.rng.nextInt(9)) / 10;
      this.entities.push({
        type: "hammer",
        at: this.cell(this.cu, gv),
        period,
        phase: this.rng.nextInt(20) / 10,
      });
      this.wpAt(this.cell(this.cu, gv + 1), i === n - 1 ? 0.7 : 0.55, 0.4, "both", true);
    }
    this.wp(this.cu, this.v - 1, 0.7);
    this.exitLane(2);
  }

  /** A funnel whose exit is the start of a rope, so the marble lands moving on a 1-wide path. */
  funnelRope(): void {
    this.setWidth(5);
    const v0 = this.v;
    this.flat(5);
    const centre = this.cell(this.cu, v0 + 2);
    this.v += 2;
    this.h -= this.intIn(2, 3);
    this.setWidth(this.tier.narrowW);
    const r0 = this.v;
    const exit = this.cell(this.cu, r0);
    this.flat(this.intIn(this.tier.rope[0], this.tier.rope[1]));
    this.railless(r0, this.v - 1);
    this.entities.push({
      type: "funnel",
      at: centre,
      radius: 2,
      depth: 1,
      exit,
      exitVelocity: [...this.vec(2.5), 0],
      travelTime: 0.8,
    });
    this.wpAt(centre, 0.6, 0.2);
    this.wp(this.cu, this.v - 1, 0.7);
    this.exitLane(2);
  }

  /** A pipe that throws the marble onto a narrow rope with a sideways kick to correct. */
  pipeTarget(): void {
    this.setWidth(Math.max(2, this.baseW));
    const v0 = this.v;
    this.flat(3);
    const entry = this.cell(this.cu, v0 + 2);
    this.v += 2;
    this.h -= this.intIn(2, 3);
    this.setWidth(this.tier.narrowW);
    const r0 = this.v;
    const exit = this.cell(this.cu, r0);
    this.flat(7);
    this.railless(r0, this.v - 1);
    const fwd = this.vec(4.5);
    const l = DV[turnDir(this.d, this.chance(0.5) ? 1 : 3)]!;
    const kick = this.extreme ? 1.2 : 0.6;
    this.entities.push({
      type: "pipe",
      entry,
      exit,
      exitVelocity: [fwd[0] + l[0] * kick, fwd[1] + l[1] * kick, 0],
      travelTime: (8 + this.rng.nextInt(5)) / 10,
    });
    this.wpAt(entry, 0.4, 0.2);
    this.wp(this.cu, this.v - 1, 0.6);
    this.exitLane(2);
  }
}
