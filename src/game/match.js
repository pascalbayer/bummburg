// The match: turn order, shooting, damage resolution, economy and victory.
// It owns the simulation and announces what happened through events; the shell
// turns those into camera moves, sound and HUD updates.

import { Emitter } from '../core/events.js';
import { makeRng } from '../core/rng.js';
import { Terrain } from './terrain.js';
import { Castle } from './castle.js';
import { Particles } from './particles.js';
import { advance, makeBall, launchVelocity, makeEnv, simulatePath } from './physics.js';
import { SHOP, makePlayer, roundIncome, cannonCost } from './economy.js';
import { WORLD, DAMAGE, ECONOMY, MAT, PHYSICS } from './config.js';
import { SKY_PALETTES } from '../render/sky.js';
import * as FX from '../render/effects.js';
import { clamp } from '../core/math.js';
import { AI } from './ai.js';

const RESOLVE_PAUSE = 1.25;
const SECOND_MOVER_PURSE = 90;
const MAX_ROUNDS = 40;
const TRAIL_POINTS = 26;

export class Game extends Emitter {
  constructor({ mode = 'ai', difficulty = 'normal', assist = 'partial', seed } = {}) {
    super();
    this.mode = mode;
    this.difficulty = difficulty;
    this.assist = assist;
    this.seed = seed ?? (Math.random() * 0xffffffff) >>> 0;
    this.rng = makeRng(this.seed);
    this.phase = 'idle';
    this.time = 0;
    this.ball = null;
    this.ballTrail = [];
    this.preview = null;
    this.pending = [];
    this.wind = 0;
    this.round = 0;
    this.turnIndex = 0;
    this.activePlayer = 0;
    this.activeCannon = null;
    this.lastImpact = null;
  }

  /* ── setup ───────────────────────────────────────────────────────── */

  setup(sprites) {
    this.terrain = new Terrain(this.rng);
    this.castles = [new Castle(0, this.rng, this.terrain), new Castle(1, this.rng, this.terrain)];
    this.palette = this.rng.pick(SKY_PALETTES);
    this.particles = new Particles(sprites);
    this.players = [
      makePlayer(0, 'Player 1', false),
      makePlayer(1, this.mode === 'ai' ? 'Computer' : 'Player 2', this.mode === 'ai'),
    ];
    for (const castle of this.castles) {
      castle.addCannon();
      castle.addCannon();
      for (const c of castle.cannons) { c.power = 58; c.angle = 45; }
    }
    this.ai = this.mode === 'ai' ? new AI(this, 1, this.difficulty) : null;
    // Two players toss for the first shot; against the computer the human opens.
    this.firstPlayer = this.mode === 'hotseat' && this.rng.chance(0.5) ? 1 : 0;
    // whoever shoots second is paid a purse to offset the opening advantage
    this.players[1 - this.firstPlayer].gold += SECOND_MOVER_PURSE;
    this.turnIndex = 0;
    this.activePlayer = this.firstPlayer;
    this.beginTurn();
    return this;
  }

  /* ── turn flow ───────────────────────────────────────────────────── */

  beginTurn() {
    if (this.phase === 'over') return;
    this.activePlayer = (this.turnIndex + this.firstPlayer) % 2;
    const p = this.players[this.activePlayer];
    const castle = this.castles[this.activePlayer];

    if (this.turnIndex % 2 === 0) this._beginRound();

    for (const c of castle.cannons) c.firedThisTurn = false;
    this.shotsLeft = Math.min(castle.liveCannons.length, ECONOMY.maxShotsPerTurn);
    this.shotsThisTurn = 0;
    this.ironActive = false;
    this.phase = 'aim';
    this.ball = null;
    this.ballTrail.length = 0;

    if (!castle.liveCannons.length) {
      const canPlace = castle.mounts.some((m) => !m.used && castle.matAt(m.gx, m.gy) !== MAT.EMPTY);
      if (!canPlace) {
        this._end(1 - this.activePlayer, 'disarmed');
        return;
      }
      if (p.gold < cannonCost(0)) {
        // silenced but not beaten: levy the townsfolk and try again next round
        p.silenced++;
        if (p.silenced >= 3) {
          this._end(1 - this.activePlayer, 'disarmed');
          return;
        }
        p.gold += 150;
        this.emit('toast', {
          text: `${p.name} has no guns and no coin — the town is levied for 150 gold`, kind: 'bad',
        });
        this.emit('stats');
        this.emit('turn', { player: this.activePlayer, round: this.round, shots: 0 });
        this.schedule(1.6, () => this.endTurn(true));
        return;
      }
      this.emit('toast', { text: `${p.name} has no guns left — the walls need a cannon`, kind: 'bad' });
      this.emit('needshop', { player: this.activePlayer });
    }

    this.selectCannon(castle.liveCannons.find((c) => !c.firedThisTurn) || null);
    this.emit('turn', { player: this.activePlayer, round: this.round, shots: this.shotsLeft });
    this._checkStalled();
    if (p.isAI && this.phase === 'aim') this.ai.beginTurn();
  }

  _beginRound() {
    if (this.round >= MAX_ROUNDS) { this._endOnPoints(); return; }
    this.round++;
    this.wind = clamp(this.rng.gauss() * 0.5, -1, 1);
    if (Math.abs(this.wind) < 0.06) this.wind = 0;
    if (this.round > 1) {
      for (let i = 0; i < 2; i++) {
        const income = roundIncome(this.castles[i]);
        this.players[i].gold += income;
        this.emit('income', { player: i, amount: income });
      }
    }
    this.emit('round', { round: this.round, wind: this.wind });
  }

  /** Nobody has fallen after a long siege: the sounder castle carries the day. */
  _endOnPoints() {
    const [a, b] = this.castles.map((c) => c.integrity);
    let winner;
    if (Math.abs(a - b) > 0.01) winner = a > b ? 0 : 1;
    else winner = this.players[0].gold >= this.players[1].gold ? 0 : 1;
    this.emit('toast', { text: 'The siege has dragged on — the stronger castle prevails', kind: 'big' });
    this._end(winner, 'siege');
  }

  /** A player with guns but no powder and no coin can only scavenge and wait. */
  _checkStalled() {
    if (this.phase !== 'aim') return;
    const p = this.players[this.activePlayer];
    if (p.powder >= ECONOMY.powderPerShot(5)) return;
    if (p.gold >= 70) {
      this.emit('toast', { text: `${p.name} is out of powder — buy a barrel`, kind: 'bad' });
      this.emit('needshop', { player: this.activePlayer });
      return;
    }
    p.gold += 55;
    p.passes++;
    this.emit('toast', { text: `${p.name} has no powder and no coin — scavenging for scrap`, kind: 'bad' });
    if (p.passes >= 3) { this._end(1 - this.activePlayer, 'attrition'); return; }
    this.schedule(1.4, () => this.endTurn(true));
  }

  selectCannon(cannon) {
    this.activeCannon = cannon;
    if (cannon && cannon.power === undefined) cannon.power = 58;
    this.updatePreview();
    this.emit('aim', this.aimState);
  }

  cycleCannon() {
    const castle = this.castles[this.activePlayer];
    const list = castle.liveCannons.filter((c) => !c.firedThisTurn);
    if (list.length < 2) return;
    const i = list.indexOf(this.activeCannon);
    this.selectCannon(list[(i + 1) % list.length]);
  }

  get aimState() {
    const c = this.activeCannon;
    const castle = this.castles[this.activePlayer];
    const list = castle.liveCannons.filter((x) => !x.firedThisTurn);
    return {
      angle: c ? c.angle : 45,
      power: c ? c.power : 58,
      cannonIndex: c ? list.indexOf(c) + 1 : 0,
      cannonCount: list.length,
      shotsLeft: this.shotsLeft,
      cost: c ? ECONOMY.powderPerShot(c.power) : 0,
    };
  }

  setAim(angle, power) {
    const c = this.activeCannon;
    if (!c || this.phase !== 'aim') return;
    if (angle !== undefined && angle !== null) c.angle = clamp(angle, 1, 89);
    if (power !== undefined && power !== null) c.power = clamp(power, 5, 100);
    this.updatePreview();
    this.emit('aim', this.aimState);
  }

  /* ── firing ──────────────────────────────────────────────────────── */

  canFire() {
    if (this.phase !== 'aim') return { ok: false, code: 'phase', reason: 'not your moment' };
    const c = this.activeCannon;
    if (!c || !c.alive) return { ok: false, code: 'nocannon', reason: 'no cannon' };
    const p = this.players[this.activePlayer];
    const cost = ECONOMY.powderPerShot(c.power);
    if (p.powder < cost) return { ok: false, code: 'nopowder', reason: `needs ${cost} powder` };
    return { ok: true, cost };
  }

  fire() {
    const check = this.canFire();
    if (!check.ok) {
      this.emit('toast', { text: `Cannot fire — ${check.reason}`, kind: 'bad' });
      return false;
    }
    const castle = this.castles[this.activePlayer];
    const p = this.players[this.activePlayer];
    const c = this.activeCannon;

    p.powder -= check.cost;
    p.shots++;
    p.silenced = 0;
    c.firedThisTurn = true;
    c.recoil = 1;
    c.heat = 1;
    this.shotsLeft--;
    this.shotsThisTurn++;
    this.ironActive = p.ironShot;
    p.ironShot = false;

    const m = castle.muzzle(c);
    const v = launchVelocity(c.angle, c.power, castle.facing);
    this.ball = makeBall(m.x, m.y, v.vx, v.vy);
    this.ballTrail.length = 0;
    this.env = makeEnv(this.wind);
    this.hitTest = this._makeHitTest(castle, c);
    this.phase = 'flight';
    this.preview = null;

    const a = c.angle * (Math.PI / 180);
    FX.muzzleBlast(this.particles, m.x, m.y, a, castle.facing, c.power);
    this.emit('shot', { player: this.activePlayer, power: c.power, angle: c.angle, x: m.x, y: m.y, iron: this.ironActive });
    return true;
  }

  _makeHitTest(firingCastle, firingCannon) {
    return (x, y, px, py, ball) => {
      if (x < -70 || x > WORLD.width + 70 || y < WORLD.groundFloor) return { type: 'out', x, y };
      const h = this.terrain.heightAt(x);
      if (y <= h) return { type: 'terrain', x, y: h };
      const t = ball ? ball.t : 1;
      for (const castle of this.castles) {
        const own = castle === firingCastle;
        if (own && t < 0.07) continue;
        if (castle.solidAt(x, y)) return { type: 'castle', castle, x, y };
        for (const c of castle.cannons) {
          if (!c.alive || (c === firingCannon && t < 0.4)) continue;
          if (Math.abs(x - c.x) < 15 && y > c.y - 10 && y < c.y + 24) {
            return { type: 'cannon', castle, cannon: c, x, y };
          }
        }
      }
      return null;
    };
  }

  /* ── resolution ──────────────────────────────────────────────────── */

  _resolve(hit) {
    const shooter = this.activePlayer;
    const p = this.players[shooter];
    const iron = this.ironActive;
    const radius = DAMAGE.blastRadius * (iron ? 1.3 : 1);
    const damage = DAMAGE.blastDamage * (iron ? 1.75 : 1);
    this.ball = null;
    this.phase = 'resolve';
    this.resolveTimer = RESOLVE_PAUSE;
    this.lastImpact = { x: hit.x, y: hit.y, type: hit.type };

    if (hit.type === 'out' || hit.type === 'spent') {
      this.emit('toast', { text: 'The shot sails off the field', kind: 'bad' });
      this.emit('impact', { x: hit.x, y: hit.y, kind: 'none', scale: 0 });
      return;
    }

    if (hit.type === 'terrain') {
      this.terrain.crater(hit.x, DAMAGE.craterRadius * (iron ? 1.25 : 1));
      FX.explosion(this.particles, hit.x, hit.y + 6, iron ? 1.15 : 0.95, { dark: 0.3 });
      FX.dirtSpray(this.particles, hit.x, hit.y, iron ? 1.3 : 1,
        this.palette.ground.map((c) => c * 0.75));
      this.emit('impact', { x: hit.x, y: hit.y, kind: 'dirt', scale: 0.7 });
      const nearest = this._nearestTarget(hit.x);
      this.emit('toast', { text: nearest, kind: 'normal' });
      return;
    }

    // castle or cannon hit
    const target = hit.castle;
    const destroyed = [];
    let kingHit = false;
    let magazineHit = false;
    for (const castle of this.castles) {
      const res = castle.applyBlast(hit.x, hit.y, radius, damage, destroyed);
      kingHit = kingHit || res.kingHit;
      magazineHit = magazineHit || res.magazineHit;
    }
    if (hit.type === 'cannon') {
      hit.castle.killCannon(hit.cannon);
      FX.explosion(this.particles, hit.cannon.x, hit.cannon.y + 8, 1.2);
    }
    FX.explosion(this.particles, hit.x, hit.y, iron ? 1.35 : 1.05);
    FX.debrisBurst(this.particles, destroyed, iron ? 1.25 : 1);
    p.blocksDestroyed += destroyed.length;
    if (target !== this.castles[shooter]) p.hits++;

    this.emit('impact', {
      x: hit.x, y: hit.y, kind: destroyed.length ? 'stone' : 'glance',
      scale: clamp(0.5 + destroyed.length * 0.12, 0.5, 2), cells: destroyed.length,
    });

    if (hit.type === 'cannon') {
      this.emit('toast', { text: 'A cannon is knocked off its mount!', kind: 'big' });
    } else if (target === this.castles[shooter]) {
      this.emit('toast', { text: 'You hit your own castle!', kind: 'bad' });
    } else if (destroyed.length >= 8) {
      this.emit('toast', { text: `Devastating! ${destroyed.length} blocks come down`, kind: 'big' });
    } else if (destroyed.length) {
      this.emit('toast', { text: `Direct hit — ${destroyed.length} block${destroyed.length > 1 ? 's' : ''} destroyed`, kind: 'normal' });
    } else {
      this.emit('toast', { text: 'The wall holds, but it is cracked', kind: 'normal' });
    }

    if (magazineHit) this._blowMagazine(target);
    this.resolveTimer = magazineHit ? RESOLVE_PAUSE + 1.5 : RESOLVE_PAUSE;
    if (kingHit) this.resolveTimer = Math.max(this.resolveTimer, 2.0);
  }

  _blowMagazine(castle) {
    const owner = this.players[castle.side];
    this.schedule(0.35, () => {
      const cell = castle.magazine.find((m) => castle.matAt(m.gx, m.gy) === MAT.POWDER) || castle.magazine[0];
      const p = castle.cellWorld(cell.gx, cell.gy);
      const destroyed = [];
      castle.applyBlast(p.x, p.y, DAMAGE.powderBlastRadius, DAMAGE.powderBlastDamage, destroyed);
      FX.explosion(this.particles, p.x, p.y, 2.6, { dark: 0.15 });
      FX.debrisBurst(this.particles, destroyed, 1.8);
      FX.collapseDust(this.particles, p.x, p.y, 70);
      const lost = Math.round(owner.powder * 0.6);
      owner.powder -= lost;
      this.emit('impact', { x: p.x, y: p.y, kind: 'magazine', scale: 3 });
      this.emit('toast', { text: `The powder magazine goes up! ${destroyed.length} blocks lost`, kind: 'big' });
      this.emit('stats');
    });
  }

  _nearestTarget(x) {
    const d0 = Math.abs(x - this.castles[0].centreX);
    const d1 = Math.abs(x - this.castles[1].centreX);
    const near = Math.min(d0, d1);
    if (near < 60) return 'Short — it lands at the foot of the walls';
    if (near < 150) return 'Close, but it falls into the dirt';
    return 'Wide of the mark';
  }

  /* ── victory ─────────────────────────────────────────────────────── */

  _checkVictory() {
    for (let i = 0; i < 2; i++) {
      if (!this.castles[i].kingAlive) {
        this._end(1 - i, 'throne');
        return true;
      }
    }
    return false;
  }

  _end(winner, reason) {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.ball = null;
    this.preview = null;
    const castle = this.castles[winner];
    this.schedule(0.05, () => {
      FX.celebration(this.particles, castle.centreX, castle.baseY + 220, [1, 0.85, 0.45]);
    });
    this.emit('gameover', {
      winner,
      reason,
      players: this.players,
      round: this.round,
      integrity: this.castles.map((c) => c.integrity),
    });
  }

  resign(player) {
    this._end(1 - player, 'resigned');
  }

  /* ── shop ────────────────────────────────────────────────────────── */

  shopItems() {
    const p = this.players[this.activePlayer];
    return SHOP.map((item) => ({
      id: item.id,
      name: item.name,
      desc: item.desc,
      cost: item.cost(this, p),
      available: item.available(this, p),
      affordable: p.gold >= item.cost(this, p),
    }));
  }

  buy(id) {
    const p = this.players[this.activePlayer];
    const item = SHOP.find((i) => i.id === id);
    if (!item || this.phase === 'over') return false;
    const cost = item.cost(this, p);
    if (!item.available(this, p) || p.gold < cost) return false;
    const msg = item.apply(this, p);
    if (msg === null) return false;
    p.gold -= cost;
    // a fresh gun may be fired the same turn it is cast
    if (id === 'cannon') {
      const castle = this.castles[this.activePlayer];
      const fresh = castle.liveCannons[castle.liveCannons.length - 1];
      fresh.firedThisTurn = false;
      fresh.power = 58;
      this.shotsLeft = Math.min(
        castle.liveCannons.filter((c) => !c.firedThisTurn).length + this.shotsThisTurn,
        ECONOMY.maxShotsPerTurn,
      ) - this.shotsThisTurn;
      if (!this.activeCannon || !this.activeCannon.alive) this.selectCannon(fresh);
    }
    this.emit('bought', { id, cost, message: msg, player: this.activePlayer });
    this.emit('stats');
    this.updatePreview();
    return true;
  }

  /* ── loop ────────────────────────────────────────────────────────── */

  schedule(delay, fn) { this.pending.push({ t: delay, fn }); }

  update(dt) {
    this.time += dt;
    if (this.particles) this.particles.update(dt, this.terrain);

    for (let i = this.pending.length - 1; i >= 0; i--) {
      const item = this.pending[i];
      item.t -= dt;
      if (item.t <= 0) {
        this.pending.splice(i, 1);
        item.fn();
      }
    }

    if (this.castles) {
      for (const castle of this.castles) {
        for (const c of castle.cannons) {
          if (c.recoil > 0) c.recoil = Math.max(0, c.recoil - dt * 3.4);
          if (c.heat > 0) c.heat = Math.max(0, c.heat - dt * 2.6);
        }
      }
    }

    if (this.phase === 'flight' && this.ball) {
      const hit = advance(this.ball, dt, this.env, this.hitTest);
      const tr = this.ballTrail;
      tr.push(this.ball.x, this.ball.y);
      if (tr.length > TRAIL_POINTS * 2) tr.splice(0, tr.length - TRAIL_POINTS * 2);
      if (this.ball.t > 0.12 && Math.random() < dt * 26) {
        FX.trailPuff(this.particles, this.ball.x, this.ball.y);
      }
      if (hit) this._resolve(hit);
    } else if (this.phase === 'resolve') {
      this.resolveTimer -= dt;
      if (this.resolveTimer <= 0 && !this.pending.length) {
        if (!this._checkVictory()) this.endTurn();
      }
    }

    if (this.ai && this.phase !== 'over') this.ai.update(dt);
  }

  /** Finish the current shot: either hand the same player another gun, or pass. */
  endTurn(force = false) {
    if (this.phase === 'over') return;
    const castle = this.castles[this.activePlayer];
    const p = this.players[this.activePlayer];
    const next = castle.liveCannons.find((c) => !c.firedThisTurn);
    const canAfford = next && p.powder >= ECONOMY.powderPerShot(5);
    if (!force && this.shotsLeft > 0 && next && canAfford) {
      this.phase = 'aim';
      this.selectCannon(next);
      this.emit('turn', {
        player: this.activePlayer, round: this.round, shots: this.shotsLeft, continued: true,
      });
      if (p.isAI) this.ai.beginTurn();
      return;
    }
    this.turnIndex++;
    this.beginTurn();
  }

  updatePreview() {
    if (this.phase !== 'aim' || !this.activeCannon || this.assist === 'off'
        || this.players[this.activePlayer].isAI) {
      this.preview = null;
      return;
    }
    const castle = this.castles[this.activePlayer];
    const c = this.activeCannon;
    const m = castle.muzzle(c);
    const v = launchVelocity(c.angle, c.power, castle.facing);
    const env = makeEnv(this.wind, PHYSICS.maxFlightTime);
    this.preview = simulatePath(m.x, m.y, v.vx, v.vy, env,
      this._makeHitTest(castle, c), { sampleEvery: 0.055 });
  }

  /** Snapshot for the HUD. */
  snapshot() {
    return this.players.map((p, i) => ({
      name: p.name,
      gold: p.gold,
      powder: p.powder,
      cannons: this.castles[i].liveCannons.length,
      integrity: this.castles[i].integrity,
      active: i === this.activePlayer && this.phase !== 'over',
    }));
  }
}
