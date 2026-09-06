// The computer opponent. It aims by running the very same ballistics the
// player's arc preview uses: for each candidate target it binary-searches the
// charge for a spread of elevations, simulates the result, and takes the shot
// that promises the most damage — then spoils it a little, by difficulty.

import { launchVelocity, makeEnv, simulatePath } from './physics.js';
import { ECONOMY, MAT } from './config.js';
import { cannonCost } from './economy.js';
import { clamp } from '../core/math.js';

const ANGLES = [26, 34, 42, 50, 58, 67, 75];

// power/angle: how badly the first shots are spoiled. calibrate/floor: how fast
// the crew walks the shots in, and how good they ever get. wind: how much they
// misjudge the breeze. guns: how many cannons they will pay for.
const DIFFICULTY = {
  easy:   { power: 9.0, angle: 5.5, calibrate: 0.94, floor: 0.78, reserve: 40,
            guns: 2, iron: false, wind: 0.55, masonAt: 0.45 },
  normal: { power: 3.6, angle: 2.1, calibrate: 0.82, floor: 0.30, reserve: 90,
            guns: 3, iron: true, wind: 0.16, masonAt: 0.66 },
  hard:   { power: 1.9, angle: 1.1, calibrate: 0.72, floor: 0.17, reserve: 140,
            guns: 3, iron: true, wind: 0.06, masonAt: 0.75 },
};

export class AI {
  constructor(game, index, difficulty = 'normal') {
    this.game = game;
    this.index = index;
    this.cfg = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.state = 'idle';
    this.timer = 0;
    this.calibration = 1;
    this.plan = null;
  }

  get player() { return this.game.players[this.index]; }
  get castle() { return this.game.castles[this.index]; }
  get enemy() { return this.game.castles[1 - this.index]; }

  beginTurn() {
    if (this.game.activePlayer !== this.index) return;
    this.state = 'shop';
    this.timer = 0.85;
  }

  update(dt) {
    if (this.game.activePlayer !== this.index || this.game.phase !== 'aim') {
      if (this.state !== 'idle' && this.game.phase === 'flight') this.state = 'idle';
      return;
    }
    this.timer -= dt;

    if (this.state === 'shop') {
      if (this.timer > 0) return;
      // the quartermaster is visited once a turn, not once per gun
      if (this.game.shotsThisTurn === 0) this.doShopping();
      this.plan = this.decideShot();
      this.state = this.plan ? 'aim' : 'pass';
      this.timer = this.plan ? 1.15 : 0.6;
      if (this.plan) {
        this.game.selectCannon(this.plan.cannon);
        this.aimStart = { angle: this.plan.cannon.angle, power: this.plan.cannon.power ?? 58 };
        this.aimT = 0;
      }
      return;
    }

    if (this.state === 'aim') {
      // sweep the barrel onto the solution so the player can read the threat
      this.aimT = Math.min(1, this.aimT + dt / 1.0);
      const e = 1 - Math.pow(1 - this.aimT, 3);
      const a = this.aimStart.angle + (this.plan.angle - this.aimStart.angle) * e;
      const p = this.aimStart.power + (this.plan.power - this.aimStart.power) * e;
      this.game.setAim(a, p);
      if (this.timer <= 0) {
        this.game.setAim(this.plan.angle, this.plan.power);
        this.state = 'idle';
        this.calibration = Math.max(this.cfg.floor, this.calibration * this.cfg.calibrate);
        this.game.fire();
      }
      return;
    }

    if (this.state === 'pass' && this.timer <= 0) {
      this.state = 'idle';
      this.game.endTurn(true);
    }
  }

  /* ── purchasing ──────────────────────────────────────────────────── */

  doShopping() {
    const g = this.game;
    const p = this.player;
    const shotCost = ECONOMY.powderPerShot(70);

    // a silenced castle buys a gun before anything else
    if (!this.castle.liveCannons.length) g.buy('cannon');
    // and never spends down past the price of replacing its last one
    const rearm = this.castle.liveCannons.length <= 1 ? cannonCost(0) : 0;
    const spare = () => p.gold - rearm;

    let guard = 0;
    while (p.powder < shotCost * 3 && spare() >= 70 && guard++ < 4) {
      if (!g.buy('powder')) break;
    }

    if (this.castle.integrity < this.cfg.masonAt && spare() >= 200 + this.cfg.reserve) g.buy('masons');

    const cannons = this.castle.liveCannons.length;
    if (cannons < this.cfg.guns && spare() >= cannonCost(cannons) + this.cfg.reserve) {
      g.buy('cannon');
    }

    if (this.cfg.iron && spare() >= 430 && !p.ironShot) g.buy('ironshot');

    while (p.powder < shotCost * 5 && spare() >= 70 + this.cfg.reserve && guard++ < 8) {
      if (!g.buy('powder')) break;
    }
  }

  /* ── shot selection ──────────────────────────────────────────────── */

  candidateTargets() {
    const e = this.enemy;
    const list = [];
    if (e.kingAlive && e.king) {
      const p = e.cellWorld(e.king.gx, e.king.gy);
      list.push({ ...p, kind: 'king', weight: 130 });
    }
    const mag = e.magazine.find((m) => e.matAt(m.gx, m.gy) === MAT.POWDER);
    if (mag) {
      const p = e.cellWorld(mag.gx, mag.gy);
      list.push({ ...p, kind: 'magazine', weight: 120 });
    }
    for (const c of e.liveCannons) list.push({ x: c.x, y: c.y + 6, kind: 'cannon', weight: 58 });
    // the face of the keep nearest us — always the high side in layout space
    if (e.king) {
      const p = e.cellWorld(Math.min(e.cols - 1, e.king.gx + 3), e.king.gy + 1);
      list.push({ ...p, kind: 'breach', weight: 52 });
    }
    // and whatever is still standing at the front, to open a path
    const front = e.layout;
    list.push({ ...e.cellWorld(front.wall1, front.wallH), kind: 'wall', weight: 34 });
    return list;
  }

  decideShot() {
    const g = this.game;
    const castle = this.castle;
    const cannon = castle.liveCannons.find((c) => !c.firedThisTurn);
    if (!cannon) return null;
    if (this.player.powder < ECONOMY.powderPerShot(20)) return null;

    const muzzle = castle.muzzle(cannon);
    // the crew reads the banner imperfectly, so they solve for the wrong wind
    const believedWind = g.wind + g.rng.gauss() * this.cfg.wind * this.calibration;
    const env = makeEnv(believedWind);
    const hitTest = g._makeHitTest(castle, cannon);
    let best = null;

    for (const target of this.candidateTargets()) {
      for (const angle of ANGLES) {
        const solved = this.searchPower(muzzle, castle, angle, target, env, hitTest);
        if (!solved) continue;
        const score = this.scoreShot(solved.hit, target) - Math.abs(angle - 45) * 0.06;
        if (!best || score > best.score) {
          best = { cannon, angle, power: solved.power, score, target };
        }
      }
    }
    if (!best) {
      best = { cannon, angle: 45, power: 60, score: 0, target: this.candidateTargets()[0] };
    }

    // spoil the aim: a fresh gun crew, walking their shots in over the match
    const spread = this.calibration;
    const rng = g.rng;
    best.power = clamp(best.power + rng.gauss() * this.cfg.power * spread, 5, 100);
    best.angle = clamp(best.angle + rng.gauss() * this.cfg.angle * spread, 8, 86);
    if (this.player.powder < ECONOMY.powderPerShot(best.power)) {
      best.power = clamp(this.player.powder * 6, 5, 100);
    }
    return best;
  }

  /** Binary search the charge that drops the shot onto the target column. */
  searchPower(muzzle, castle, angle, target, env, hitTest) {
    const facing = castle.facing;
    const run = (power) => {
      const v = launchVelocity(angle, power, facing);
      const r = simulatePath(muzzle.x, muzzle.y, v.vx, v.vy, env, hitTest,
        { sampleEvery: 0.4, maxPoints: 120 });
      return r;
    };
    let lo = 8, hi = 100;
    const rLo = run(lo);
    const rHi = run(hi);
    const errOf = (r) => ((r.hit ? r.hit.x : r.ball.x) - target.x) * facing;
    if (errOf(rLo) > 0) return { power: lo, hit: rLo.hit, path: rLo };
    if (errOf(rHi) < 0) return null;                 // out of reach at this elevation
    for (let i = 0; i < 13; i++) {
      const mid = (lo + hi) / 2;
      if (errOf(run(mid)) < 0) lo = mid; else hi = mid;
    }
    const power = (lo + hi) / 2;
    const final = run(power);
    return { power, hit: final.hit, path: final };
  }

  scoreShot(hit, target) {
    if (!hit) return -60;
    const e = this.enemy;
    if (hit.type === 'out' || hit.type === 'spent') return -50;
    if (hit.type === 'castle' && hit.castle === this.castle) return -140;
    if (hit.type === 'cannon' && hit.castle === this.castle) return -140;

    const d = Math.hypot(hit.x - target.x, hit.y - target.y);
    let score = -d * 0.22;

    if (hit.type === 'terrain') {
      // still worth something if it lands right against the enemy wall
      const near = Math.abs(hit.x - e.centreX);
      return score + (near < 170 ? 6 : -14);
    }
    if (hit.type === 'cannon') score += 52;
    if (hit.type === 'castle') {
      score += 26;
      const c = e.worldToCell(hit.x, hit.y);
      if (e.king) {
        const kd = Math.abs(c.gx - e.king.gx) + Math.abs(c.gy - e.king.gy);
        if (kd <= 2) score += 90;
        else if (kd <= 5) score += 34;
      }
      for (const m of e.magazine) {
        if (e.matAt(m.gx, m.gy) !== MAT.POWDER) continue;
        const md = Math.abs(c.gx - m.gx) + Math.abs(c.gy - m.gy);
        if (md <= 2) { score += 110; break; }
      }
      // reward chipping at whatever is already weakened
      const i = e.idx(clamp(c.gx, 0, e.cols - 1), clamp(c.gy, 0, e.rows - 1));
      if (e.maxHp[i] && e.hp[i] / e.maxHp[i] < 0.6) score += 18;
    }
    score += target.weight * 0.12;
    return score;
  }
}
