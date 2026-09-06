// Ballistics. The live shot and the aim preview run through the very same
// integrator, so what the dotted arc promises is what the cannonball does.

import { PHYSICS } from './config.js';

const SUB_DT = 1 / 240;
const MAX_STEP_DIST = 4.5;

export function makeEnv(windStrength, maxTime = PHYSICS.maxFlightTime) {
  return {
    gravity: PHYSICS.gravity,
    wind: windStrength * PHYSICS.windScale,
    drag: PHYSICS.drag,
    maxTime,
  };
}

/** Muzzle speed for a power value in 5..100. */
export function muzzleSpeed(power) {
  return PHYSICS.muzzleBase + power * PHYSICS.muzzlePerPower;
}

export function launchVelocity(angleDeg, power, facing) {
  const a = angleDeg * (Math.PI / 180);
  const v = muzzleSpeed(power);
  return { vx: Math.cos(a) * v * facing, vy: Math.sin(a) * v };
}

export function makeBall(x, y, vx, vy) {
  return { x, y, vx, vy, t: 0, px: x, py: y };
}

/**
 * Advance a ball by dt with sub-stepping.
 * @param {(x:number,y:number,px:number,py:number,ball:object)=>any} hitTest
 * @returns the hit descriptor, or null if the ball is still flying.
 */
export function advance(ball, dt, env, hitTest) {
  let remaining = Math.min(dt, 0.1);
  while (remaining > 1e-6) {
    const speed = Math.hypot(ball.vx, ball.vy);
    const h = Math.max(1e-4, Math.min(SUB_DT, remaining, MAX_STEP_DIST / Math.max(60, speed)));
    remaining -= h;
    ball.px = ball.x;
    ball.py = ball.y;
    const dragK = env.drag * speed;
    ball.vx += (env.wind - ball.vx * dragK) * h;
    ball.vy += (-env.gravity - ball.vy * dragK) * h;
    ball.x += ball.vx * h;
    ball.y += ball.vy * h;
    ball.t += h;
    const hit = hitTest(ball.x, ball.y, ball.px, ball.py, ball);
    if (hit) return hit;
    if (ball.t >= env.maxTime) return { type: 'spent', x: ball.x, y: ball.y };
  }
  return null;
}

/**
 * Run a whole shot without rendering it. Used for the aim assist arc and by the
 * computer opponent when it ranges in.
 * @returns {{points: number[], hit: any, ball: object}}
 */
export function simulatePath(x, y, vx, vy, env, hitTest, { sampleEvery = 0.045, maxPoints = 900 } = {}) {
  const ball = makeBall(x, y, vx, vy);
  const points = [x, y];
  let hit = null;
  let nextSample = sampleEvery;
  const step = 1 / 120;
  while (!hit && points.length < maxPoints * 2) {
    hit = advance(ball, step, env, hitTest);
    if (ball.t >= nextSample) {
      points.push(ball.x, ball.y);
      nextSample += sampleEvery;
    }
    if (hit) points.push(ball.x, ball.y);
  }
  return { points, hit, ball };
}

/** Ideal (drag-free, wind-free) launch speed to reach a target — an AI seed. */
export function ballisticSpeed(dx, dy, angleDeg, gravity = PHYSICS.gravity) {
  const a = angleDeg * (Math.PI / 180);
  const cos = Math.cos(a), tan = Math.tan(a);
  const denom = 2 * cos * cos * (dx * tan - dy);
  if (denom <= 0) return null;
  const v2 = (gravity * dx * dx) / denom;
  return v2 > 0 ? Math.sqrt(v2) : null;
}
