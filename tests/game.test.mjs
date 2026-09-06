// Zero-dependency checks for the rules and the geometry, run with `npm test`
// (which is just `node --test`). They need no browser: the simulation is pure
// JavaScript and the renderer is the only part that touches WebGL.

import test from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/game/match.js';
import { AI } from '../src/game/ai.js';
import { Castle } from '../src/game/castle.js';
import { Terrain } from '../src/game/terrain.js';
import { makeRng } from '../src/core/rng.js';
import { MAT, WORLD, ECONOMY } from '../src/game/config.js';
import { advance, makeBall, launchVelocity, makeEnv, simulatePath } from '../src/game/physics.js';

/** The renderer wants sprite rects; the simulation only ever passes them along. */
const stubSprites = new Proxy({}, { get: () => ({ u0: 0, v0: 0, u1: 1, v1: 1, aspect: 1 }) });

const newGame = (opts = {}) => new Game({ mode: 'ai', assist: 'off', seed: 4242, ...opts }).setup(stubSprites);

/** Run a match to its end, driving the human side with an AI of a known standard. */
function playOut(game, playerSkill = 'normal', maxSeconds = 60 * 14) {
  const p0 = new AI(game, 0, playerSkill);
  game.on('turn', (e) => { if (e.player === 0) p0.beginTurn(); });
  let result = null;
  game.on('gameover', (e) => { result = e; });
  if (game.activePlayer === 0) p0.beginTurn();
  let frames = 0;
  while (game.phase !== 'over' && frames++ < maxSeconds * 60) {
    p0.update(1 / 60);
    game.update(1 / 60);
  }
  return result;
}

test('a freshly built castle stands up on its own', () => {
  for (let seed = 0; seed < 25; seed++) {
    const rng = makeRng(seed * 977 + 3);
    const terrain = new Terrain(rng);
    for (const side of [0, 1]) {
      const castle = new Castle(side, rng, terrain);
      const res = { destroyed: [] };
      castle.collapse(res);
      assert.equal(res.destroyed.length, 0,
        `seed ${seed} side ${side}: ${res.destroyed.length} blocks were unsupported from the start`);
      assert.ok(castle.kingAlive, 'the throne survived construction');
      assert.ok(castle.countCells() > 120, 'the castle has some substance');
    }
  }
});

test('every cannon emplacement can fire over its own castle', () => {
  for (let seed = 0; seed < 20; seed++) {
    const rng = makeRng(seed * 31 + 7);
    const terrain = new Terrain(rng);
    const castle = new Castle(0, rng, terrain);
    for (const mount of castle.mounts) {
      let needed = 0;
      for (let gx = mount.gx + 1; gx < castle.cols; gx++) {
        let top = -1;
        for (let gy = castle.rows - 1; gy >= 0; gy--) {
          if (castle.matAt(gx, gy) !== MAT.EMPTY) { top = gy; break; }
        }
        if (top < 0) continue;
        const rise = top - mount.gy;
        if (rise > 0) needed = Math.max(needed, (Math.atan2(rise, gx - mount.gx) * 180) / Math.PI);
      }
      assert.equal(needed, 0,
        `seed ${seed}: mount ${mount.gx},${mount.gy} needs ${needed.toFixed(1)}° to clear its own walls`);
    }
  }
});

test('knocking out a tower base brings down what stands on it', () => {
  const rng = makeRng(9);
  const terrain = new Terrain(rng);
  const castle = new Castle(0, rng, terrain);
  const L = castle.layout;
  const before = castle.countCells();
  // erase the great tower's footing outright, then run the support pass
  for (let gx = L.tower0; gx <= L.tower1; gx++) {
    for (let gy = 2; gy <= 5; gy++) {
      const i = castle.idx(gx, gy);
      castle.grid[i] = MAT.EMPTY;
      castle.hp[i] = 0;
    }
  }
  const res = { destroyed: [] };
  castle.collapse(res);
  const fell = res.destroyed.filter((d) => d.gx >= L.tower0 && d.gx <= L.tower1 && d.gy > 5);
  assert.ok(fell.length > 8, `expected the tower to come down, only ${fell.length} blocks fell`);
  assert.ok(castle.countCells() < before - 20);
});

test('a wrecked gun frees its emplacement so the castle can re-arm', () => {
  const game = newGame();
  const castle = game.castles[1];
  const cannon = castle.liveCannons[0];
  castle.killCannon(cannon);
  assert.equal(cannon.mount.used, false);
  assert.equal(castle.liveCannons.length, 1);
  const replacement = castle.addCannon();
  assert.ok(replacement, 'a new gun can take the empty emplacement');
  assert.equal(castle.liveCannons.length, 2);
});

test('the aim preview predicts where the ball actually lands', () => {
  const game = newGame();
  const castle = game.castles[0];
  const cannon = game.activeCannon;
  const env = makeEnv(game.wind);
  const hitTest = game._makeHitTest(castle, cannon);
  for (const [angle, power] of [[30, 55], [45, 70], [62, 84], [75, 40]]) {
    const m = castle.muzzle(cannon);
    const v = launchVelocity(angle, power, castle.facing);
    const predicted = simulatePath(m.x, m.y, v.vx, v.vy, env, hitTest);
    // now fly it for real, in irregular frame-sized steps
    const ball = makeBall(m.x, m.y, v.vx, v.vy);
    let hit = null;
    for (let i = 0; i < 4000 && !hit; i++) hit = advance(ball, 0.0131 + (i % 3) * 0.004, env, hitTest);
    assert.ok(hit && predicted.hit, 'both the preview and the shot resolve');
    assert.ok(Math.hypot(hit.x - predicted.hit.x, hit.y - predicted.hit.y) < 6,
      `preview and shot disagree at ${angle}°/${power}: ` +
      `${predicted.hit.x.toFixed(1)},${predicted.hit.y.toFixed(1)} vs ${hit.x.toFixed(1)},${hit.y.toFixed(1)}`);
  }
});

test('wind pushes a shot downrange', () => {
  const game = newGame();
  const castle = game.castles[0];
  const cannon = game.activeCannon;
  const m = castle.muzzle(cannon);
  const v = launchVelocity(45, 70, castle.facing);
  const hitTest = (x, y) => (y <= game.terrain.heightAt(x) ? { type: 'terrain', x, y } : null);
  const still = simulatePath(m.x, m.y, v.vx, v.vy, makeEnv(0), hitTest).hit.x;
  const tail = simulatePath(m.x, m.y, v.vx, v.vy, makeEnv(1), hitTest).hit.x;
  const head = simulatePath(m.x, m.y, v.vx, v.vy, makeEnv(-1), hitTest).hit.x;
  assert.ok(tail > still + 40, `a tailwind should carry the ball (${still.toFixed(0)} -> ${tail.toFixed(0)})`);
  assert.ok(head < still - 40, `a headwind should hold it back (${still.toFixed(0)} -> ${head.toFixed(0)})`);
});

test('firing costs powder and passes the turn once every gun has fired', () => {
  const game = newGame();
  const p = game.players[0];
  const powder = p.powder;
  const guns = game.castles[0].liveCannons.length;
  assert.equal(game.shotsLeft, Math.min(guns, ECONOMY.maxShotsPerTurn));
  game.setAim(45, 60);
  assert.ok(game.fire());
  assert.equal(p.powder, powder - ECONOMY.powderPerShot(60));
  assert.equal(p.shots, 1);
  assert.equal(game.phase, 'flight');
});

test('the quartermaster charges for what he sells', () => {
  const game = newGame();
  const p = game.players[0];
  const gold = p.gold;
  const powder = p.powder;
  assert.ok(game.buy('powder'));
  assert.equal(p.gold, gold - 70);
  assert.equal(p.powder, powder + 25);
  // a purchase that is out of reach must not go through
  p.gold = 10;
  assert.equal(game.buy('cannon'), false);
  assert.equal(p.gold, 10);
});

test('every match reaches an ending', () => {
  const reasons = new Set();
  for (let i = 0; i < 6; i++) {
    const game = new Game({ mode: 'ai', assist: 'off', seed: 1000 + i * 4099 }).setup(stubSprites);
    const result = playOut(game);
    assert.ok(result, `seed ${i} never finished`);
    assert.ok(result.round <= 40, 'the round cap holds');
    assert.ok([0, 1].includes(result.winner));
    reasons.add(result.reason);
  }
  assert.ok(reasons.size >= 1);
});

test('the difficulty settings are actually ordered', () => {
  const wins = { easy: 0, hard: 0 };
  for (const difficulty of ['easy', 'hard']) {
    for (let i = 0; i < 5; i++) {
      const game = new Game({ mode: 'ai', difficulty, assist: 'off', seed: 700 + i * 4099 }).setup(stubSprites);
      const result = playOut(game, 'normal');
      if (result && result.winner === 0) wins[difficulty]++;
    }
  }
  assert.ok(wins.easy > wins.hard,
    `a Squire should lose more often than a Warlord (player won ${wins.easy}/5 vs ${wins.hard}/5)`);
});

test('terrain stays inside its bounds and craters do not punch through', () => {
  const terrain = new Terrain(makeRng(5));
  for (let x = 0; x <= WORLD.width; x += 17) {
    const h = terrain.heightAt(x);
    assert.ok(h > 0 && h < WORLD.skyTop, `height at ${x} is ${h}`);
  }
  const before = terrain.heightAt(900);
  terrain.crater(900, 60);
  const after = terrain.heightAt(900);
  assert.ok(after < before, 'the crater dug in');
  for (let i = 0; i < 40; i++) terrain.crater(900, 60);
  assert.ok(terrain.heightAt(900) >= 70, 'craters bottom out rather than reaching the void');
});
