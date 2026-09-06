// Application shell: boots WebGL, owns the frame loop, and wires the match to
// the camera, the HUD, the speakers and the player's fingers.

import { GLContext } from './gl/context.js';
import { buildAtlas } from './gl/atlas.js';
import { Scene } from './render/scene.js';
import { Camera } from './render/camera.js';
import { Game } from './game/match.js';
import { WORLD, PLAYER_COLORS, ECONOMY } from './game/config.js';
import { makeRng } from './core/rng.js';
import { clamp } from './core/math.js';
import { Sfx } from './audio/sfx.js';
import { Hud } from './ui/hud.js';
import { Screens } from './ui/screens.js';
import { InputController } from './ui/input.js';

const SLINGSHOT_GRAB_PX = 58;     // CSS pixels around the gun that start a slingshot
const MANUAL_CAMERA_HOLD = 3.2;   // seconds the player's own framing is respected

function fatal(message) {
  const box = document.getElementById('fatal');
  document.getElementById('fatal-text').textContent = message;
  box.hidden = false;
}

function boot() {
  const canvas = document.getElementById('gl');
  let ctx;
  try {
    ctx = new GLContext(canvas);
  } catch (err) {
    fatal(`${err.message} Bummburg needs a browser with WebGL 2 — try a recent Chrome, Firefox, Edge or Safari.`);
    return;
  }

  let atlas;
  try {
    atlas = buildAtlas(ctx.gl, window.devicePixelRatio > 1.5 ? 1 : 0.75);
  } catch (err) {
    fatal(`Could not build the artwork: ${err.message}`);
    return;
  }

  const scene = new Scene(ctx, atlas);
  const camera = new Camera(WORLD);
  const sfx = new Sfx();

  const app = {
    game: null,
    demo: true,
    overview: false,
    manualCamera: 0,
    whistle: null,
    dragging: null,
    hintShown: false,
  };

  /* ── camera framing ────────────────────────────────────────────── */

  const isPortrait = () => ctx.cssHeight > ctx.cssWidth * 1.05;

  function views() {
    const p = isPortrait();
    return {
      aim: p ? 820 : 1040,
      flight: p ? 980 : 1320,
      close: p ? 660 : 880,
      overview: WORLD.width * 1.04,
    };
  }

  function frameCamera(dt) {
    const g = app.game;
    if (!g || !g.castles) return;
    if (app.manualCamera > 0) {
      app.manualCamera -= dt;
      return;
    }
    const v = views();
    const groundY = Math.min(g.castles[0].baseY, g.castles[1].baseY);
    const place = (x, y, width) => {
      const vh = width / camera.aspect;
      camera.focus(x, Math.max(y, groundY + vh * 0.22), width);
    };

    if (app.demo) {
      const t = g.time * 0.06;
      const x = WORLD.width / 2 + Math.sin(t) * WORLD.width * 0.3;
      place(x, groundY + 260, v.overview * 0.72);
      return;
    }
    if (app.overview) {
      place(WORLD.width / 2, groundY + 300, v.overview);
      return;
    }
    if (g.phase === 'flight' && g.ball) {
      place(g.ball.x + g.ball.vx * 0.22, g.ball.y + 40, v.flight);
      return;
    }
    if (g.phase === 'resolve' && g.lastImpact) {
      place(g.lastImpact.x, g.lastImpact.y + 50, v.close);
      return;
    }
    if (g.phase === 'over') {
      place(WORLD.width / 2, groundY + 300, v.overview);
      return;
    }
    const castle = g.castles[g.activePlayer];
    const cannon = g.activeCannon;
    const cx = (cannon ? cannon.x : castle.centreX) + castle.facing * 150;
    place(cx, castle.baseY + 110, v.aim);
  }

  /* ── match lifecycle ───────────────────────────────────────────── */

  function newGame(options, demo) {
    const g = new Game({ ...options, seed: (Math.random() * 0xffffffff) >>> 0 });
    g.setup(atlas.sprites);
    scene.setup(g, makeRng(g.seed ^ 0x9e3779b9));
    app.game = g;
    app.demo = demo;
    app.overview = false;
    app.manualCamera = 0;
    hud.setOverview(false);
    if (!demo) wireMatch(g);
    frameCamera(0);
    camera.snap();
    return g;
  }

  function wireMatch(g) {
    g.on('stats', () => hud.updateStats(g.snapshot()));
    g.on('toast', ({ text, kind }) => hud.toast(text, kind));
    g.on('income', ({ player, amount }) => {
      if (player === 0 || g.mode === 'hotseat') hud.toast(`${g.players[player].name} collects ${amount} gold in taxes`);
      hud.updateStats(g.snapshot());
    });
    g.on('round', ({ round, wind }) => {
      hud.updateRound(round, wind);
      hud.updateStats(g.snapshot());
    });
    g.on('bought', ({ message }) => {
      sfx.coins();
      hud.toast(message);
      if (screens.current === 'shop') screens.renderShop(g.shopItems(), g.players[g.activePlayer].gold);
      hud.updateStats(g.snapshot());
      refreshAim();
    });
    g.on('needshop', () => {
      if (!g.players[g.activePlayer].isAI) openShop();
    });
    g.on('aim', () => refreshAim());
    g.on('turn', ({ player, continued }) => {
      const name = g.players[player].name;
      const colour = `rgb(${PLAYER_COLORS[player].map((c) => Math.round(c * 255)).join(',')})`;
      if (!continued) hud.showBanner(`${name}'s turn`, colour);
      hud.updateStats(g.snapshot());
      refreshAim();
      updateHint();
    });
    g.on('shot', ({ power }) => {
      sfx.boom(power);
      vibrate(power > 70 ? 26 : 16);
      camera.addShake(3 + power * 0.06);
      app.whistle?.stop();
      app.whistle = sfx.whistle();
      hud.updateStats(g.snapshot());
      hud.setHint('');
    });
    g.on('impact', ({ kind, scale }) => {
      app.whistle?.stop();
      app.whistle = null;
      if (kind === 'none') return;
      camera.addShake(6 + scale * 9);
      vibrate(kind === 'magazine' ? [30, 40, 90] : 30);
      if (kind === 'magazine') sfx.bigBlast();
      else if (kind === 'dirt') sfx.impact(false, 1);
      else {
        sfx.impact(true, clamp(scale, 0.6, 1.6));
        if (scale > 0.8) sfx.crumble(scale * 0.8);
      }
      hud.updateStats(g.snapshot());
    });
    g.on('repaired', () => hud.updateStats(g.snapshot()));
    g.on('gameover', (result) => {
      app.whistle?.stop();
      const human = g.mode === 'ai' ? 0 : null;
      const won = human === null ? null : result.winner === human;
      sfx.fanfare(won !== false);
      hud.setHint('');
      setTimeout(() => screens.showGameOver(result, g.players.map((p) => p.name), won), 1500);
    });
    hud.updateRound(g.round, g.wind);
    hud.updateStats(g.snapshot());
    refreshAim();
    updateHint();
  }

  function vibrate(pattern) {
    if (navigator.vibrate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      try { navigator.vibrate(pattern); } catch { /* not supported */ }
    }
  }

  /* ── HUD glue ──────────────────────────────────────────────────── */

  function humanTurn() {
    const g = app.game;
    return g && !app.demo && g.phase === 'aim' && !g.players[g.activePlayer].isAI;
  }

  function refreshAim() {
    const g = app.game;
    if (!g || app.demo || !g.castles) return;
    hud.updateAim(g.aimState, humanTurn() ? g.canFire() : { ok: false, reason: '' }, g.phase);
  }

  function updateHint() {
    if (!humanTurn()) return;
    const g = app.game;
    const cost = ECONOMY.powderPerShot(g.aimState.power);
    const shots = g.shotsLeft > 1 ? ` · ${g.shotsLeft} shots left this turn` : '';
    hud.setHint(app.hintShown
      ? `${cost} powder per shot${shots}`
      : 'Drag the battlefield to aim · grab the gun to slingshot');
  }

  function openShop() {
    const g = app.game;
    if (!g || app.demo || g.phase === 'over') return;
    screens.renderShop(g.shopItems(), g.players[g.activePlayer].gold);
    screens.show('shop');
  }

  const hud = new Hud({
    onAim: (key, value) => {
      if (!humanTurn()) return;
      app.game.setAim(key === 'angle' ? value : undefined, key === 'power' ? value : undefined);
      app.hintShown = true;
      updateHint();
      sfx.unlock();
    },
    onNudge: (key, delta) => {
      if (!humanTurn()) return;
      const a = app.game.aimState;
      app.game.setAim(key === 'angle' ? a.angle + delta : undefined,
        key === 'power' ? a.power + delta : undefined);
      app.hintShown = true;
      updateHint();
    },
    onFire: () => {
      if (!humanTurn()) return;
      sfx.unlock();
      app.game.fire();
    },
    onShop: () => { sfx.unlock(); openShop(); },
    onCycleCannon: () => { if (humanTurn()) { app.game.cycleCannon(); sfx.click(true); } },
    onToggleView: () => {
      app.overview = !app.overview;
      app.manualCamera = 0;
      hud.setOverview(app.overview);
      sfx.click();
    },
    onMenu: () => screens.show('menu'),
  });

  const screens = new Screens({
    onStart: (options) => {
      sfx.unlock();
      newGame(options, false);
      screens.hide();
      hud.show(true);
      app.hintShown = false;
      updateHint();
      if (isPortrait()) {
        const hint = document.getElementById('rotate-hint');
        hint.hidden = false;
        setTimeout(() => { hint.hidden = true; }, 4200);
      }
    },
    onBuy: (id) => {
      if (app.game && !app.demo) app.game.buy(id);
    },
    onResign: () => {
      if (app.game && !app.demo && app.game.phase !== 'over') {
        screens.hide();
        app.game.resign(0);
      }
    },
    onSound: (on) => sfx.setEnabled(on),
    onScreenChange: (name) => {
      input.enabled = name === null;
      if (name === 'title') {
        hud.show(false);
        newGame({ mode: 'ai', difficulty: 'normal', assist: 'off' }, true);
      }
    },
  });

  /* ── pointer + keyboard ────────────────────────────────────────── */

  function toWorld(p) {
    return camera.screenToWorld(p.x, p.y, ctx.cssWidth, ctx.cssHeight);
  }

  /** Is a screen point within `px` CSS pixels of a world position? */
  function nearOnScreen(p, wx, wy, px) {
    const s = camera.worldToScreen(wx, wy, ctx.cssWidth, ctx.cssHeight);
    return Math.hypot(p.x - s.x, p.y - s.y) < px;
  }

  const input = new InputController(canvas, {
    onFirstInteraction: () => sfx.unlock(),
    onAimStart: (d) => {
      if (!humanTurn()) return;
      const g = app.game;
      const c = g.activeCannon;
      // measured on screen, so the gun is just as easy to grab at any zoom
      app.dragging = { slingshot: !!c && nearOnScreen(d, c.x, c.y, SLINGSHOT_GRAB_PX) };
    },
    onAimMove: (d) => {
      if (!app.dragging || !humanTurn()) return;
      const g = app.game;
      const castle = g.castles[g.activePlayer];
      const maxLen = Math.min(ctx.cssWidth, ctx.cssHeight) * 0.38;
      // pull back like a bowstring: the shot flies opposite the drag
      const dirX = -d.dx * castle.facing;
      const dirY = d.dy;
      let angle = Math.atan2(dirY, dirX) * (180 / Math.PI);
      if (dirY < 0) angle = dirX > 0 ? 1 : 89;      // dragging the wrong way pins the elevation
      angle = clamp(angle, 1, 89);
      const power = clamp((d.dist / maxLen) * 100, 5, 100);
      g.setAim(angle, power);
      const from = toWorld({ x: d.sx, y: d.sy });
      const to = toWorld({ x: d.x, y: d.y });
      g.dragIndicator = { x0: from.x, y0: from.y, x1: to.x, y1: to.y, power, slingshot: app.dragging.slingshot };
      app.hintShown = true;
      updateHint();
    },
    onAimEnd: (d) => {
      const g = app.game;
      if (g) g.dragIndicator = null;
      if (!app.dragging || !humanTurn()) { app.dragging = null; return; }
      const sling = app.dragging.slingshot;
      app.dragging = null;
      if (sling && d.dist > 26) app.game.fire();
    },
    onAimCancel: () => {
      if (app.game) app.game.dragIndicator = null;
      app.dragging = null;
    },
    onTap: (p) => {
      if (!humanTurn()) return;
      const g = app.game;
      const castle = g.castles[g.activePlayer];
      for (const c of castle.liveCannons) {
        if (c.firedThisTurn || c === g.activeCannon) continue;
        if (nearOnScreen(p, c.x, c.y, SLINGSHOT_GRAB_PX)) {
          g.selectCannon(c);
          sfx.click(true);
          return;
        }
      }
    },
    onDoubleTap: () => {
      app.overview = !app.overview;
      app.manualCamera = 0;
      hud.setOverview(app.overview);
    },
    onZoom: (factor, p) => {
      const w = toWorld(p);
      camera.zoomBy(factor, w.x, w.y);
      app.manualCamera = MANUAL_CAMERA_HOLD;
      app.overview = false;
      hud.setOverview(false);
    },
    onPan: (dx, dy) => {
      const upp = camera.unitsPerPixel(ctx.cssWidth);
      camera.panBy(-dx * upp, dy * upp);
      app.manualCamera = MANUAL_CAMERA_HOLD;
    },
    onNudge: (key, delta) => {
      if (!humanTurn()) return;
      const a = app.game.aimState;
      app.game.setAim(key === 'angle' ? a.angle + delta : undefined,
        key === 'power' ? a.power + delta : undefined);
      app.hintShown = true;
      updateHint();
    },
    onFire: () => { if (humanTurn() && !screens.isOpen) app.game.fire(); },
    onCycleCannon: () => { if (humanTurn()) app.game.cycleCannon(); },
    onToggleView: () => {
      app.overview = !app.overview;
      app.manualCamera = 0;
      hud.setOverview(app.overview);
    },
    onShop: () => { if (humanTurn()) openShop(); },
    onMenu: () => {
      if (screens.isOpen) screens.hide();
      else if (app.game && !app.demo) screens.show('menu');
    },
  });

  /* ── frame loop ────────────────────────────────────────────────── */

  let last = performance.now();
  let hidden = false;
  document.addEventListener('visibilitychange', () => {
    hidden = document.hidden;
    last = performance.now();
  });

  function resize() {
    if (ctx.resize()) camera.setAspect(ctx.width / ctx.height);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));
  resize();

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (hidden) return;
    resize();
    const g = app.game;
    if (!g) return;

    if (!app.demo || g.phase !== 'over') g.update(app.demo ? dt * 0.35 : dt);
    if (app.whistle && g.ball) {
      app.whistle.update(clamp(1 - (g.ball.y - g.terrain.heightAt(g.ball.x)) / 900, 0, 1));
    }
    frameCamera(dt);
    camera.update(dt);
    scene.draw(g, camera, dt);
  }

  // A quiet battle plays behind the title screen.
  newGame({ mode: 'ai', difficulty: 'normal', assist: 'off' }, true);
  camera.snap();
  requestAnimationFrame(frame);
  app.camera = camera;
  app.ctx = ctx;
  window.__bummburg = app;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
