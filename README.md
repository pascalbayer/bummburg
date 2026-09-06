# Bummburg

A WebGL artillery duel between two medieval castles, in the spirit of the 16-bit
castle-siege games of the late eighties. Two strongholds face each other across a
hilly valley; you buy powder, cast cannons and hire masons, then lob iron at the
enemy keep until one throne room is rubble.

Built mobile first — one finger aims, two fingers pan and zoom — and it plays
just as well with a mouse and keyboard.

Everything you see is generated at runtime: the terrain, both castles, all the
artwork and every sound effect. There are no image or audio files, no build step
and no dependencies.

## Running it

The game is plain ES modules, so it needs to be served over HTTP (opening
`index.html` straight from disk will not work — browsers refuse module imports
over `file://`).

```sh
npx serve .          # or: python3 -m http.server 8000
```

Then open the address it prints. Any static host works: GitHub Pages, Netlify,
S3, a folder on a web server.

Requires a browser with **WebGL 2** — Chrome, Edge, Firefox, or Safari 15+.

There is a small test suite for the rules and the geometry — castles that stand
up on their own, guns that can fire over their own walls, the aim preview
agreeing with the shot, matches that always reach an ending. It needs nothing
but Node:

```sh
npm test
```

## Playing

**Aim** by dragging anywhere on the battlefield and pulling back like a bow; the
dotted arc shows where the shot is heading. Grab the gun itself and the drag
becomes a slingshot that fires the moment you let go. The two sliders give you
fine control, and the arrow keys nudge them one notch at a time.

**Wind** is rolled fresh each round and shown in the banner at the top. It pushes
every cannonball sideways for its whole flight, so lead your shots into it.

**Powder** burns in proportion to the charge — a full-power shot costs three
times what a gentle lob does. Run dry and you cannot fire until you buy more.

**Gold** arrives as taxes at the start of each round, and a bigger, healthier
castle pays better. Spend it with the quartermaster:

| | |
|---|---|
| Barrel of powder | 25 more charges |
| Cast a cannon | every gun fires once a turn, up to three |
| Hire masons | rebuild fallen blocks and shore up the walls |
| Forge an iron shot | the next ball hits far harder and blasts wider |

**Winning** — bring down the enemy throne room, or leave them with no cannons and
no coin to cast another. A hit on a powder magazine takes half a castle with it.
If neither throne has fallen after forty rounds, the sounder castle takes the
field.

### Controls

|  | Touch | Mouse & keyboard |
|---|---|---|
| Aim | drag the battlefield | drag, or <kbd>←</kbd><kbd>→</kbd> angle, <kbd>↑</kbd><kbd>↓</kbd> power |
| Fire | the FIRE button, or release a slingshot drag | <kbd>Space</kbd> |
| Next cannon | tap it, or the gun button | <kbd>Tab</kbd> |
| Pan / zoom | two fingers | right-drag / wheel |
| Whole battlefield | double tap | <kbd>V</kbd> |
| Quartermaster | the Shop button | <kbd>S</kbd> |
| Pause | the menu button | <kbd>Esc</kbd> |

Hold <kbd>Shift</kbd> while nudging for coarse steps, <kbd>Alt</kbd> for fine ones.

## How it is put together

```
index.html            markup for the canvas, the HUD and every panel
styles/game.css       mobile-first HUD styling
src/
  main.js             boots WebGL, owns the frame loop, wires everything together
  core/               maths, seeded RNG and value noise, event emitter
  gl/
    context.js        WebGL 2 context and device-pixel-ratio aware sizing
    program.js        shader compilation with cached uniform locations
    quadbatch.js      instanced quad batch — blocks, guns, particles, dots
    mesh.js           coloured triangle meshes with procedural grain
    atlas.js          every sprite, drawn with Canvas2D at load time
  game/
    config.js         all the tuning constants in one place
    terrain.js        height-field generation, craters, mesh building
    castle.js         the destructible block grid and its structural rules
    physics.js        ballistics, shared by the live shot and the aim preview
    particles.js      struct-of-arrays particle pool
    match.js          turn order, damage resolution, economy, victory
    economy.js        gold, powder and the quartermaster's stock
    ai.js             the computer opponent
  render/
    scene.js          the draw order, from sky to foreground
    camera.js         damped orthographic camera with parallax
    sky.js            gradient sky shader and the time-of-day palettes
    effects.js        particle recipes for explosions, debris and smoke
  audio/sfx.js        procedural WebAudio sound
  ui/                 pointer/keyboard input, HUD binding, panels
tests/game.test.mjs   rules and geometry checks, no browser needed
```

A few things worth knowing if you want to poke at it:

**The aim preview cannot lie.** `physics.js` exposes one integrator; the dotted
arc, the computer's targeting search and the ball actually in flight all call it,
so the preview is a genuine prediction rather than a decorative curve.

**Castles fall down properly.** Damage removes blocks, and then a support pass
floods load paths up from the foundation, allowing a three-block cantilever
sideways. Knock the feet out from under a tower and everything above it comes
down in one go, along with any gun mounted up there. A destroyed gun frees its
emplacement, so a battered castle can always re-arm if it can pay.

**The computer aims the way you do.** For each candidate target — the throne, the
magazine, each gun, the near face of the keep — it binary-searches the charge
across seven elevations, simulates the result and takes the shot that scores
best, then spoils it by an amount set by the difficulty. Warlord crews also read
the wind correctly; Squire crews do not.

**Nothing is loaded.** `gl/atlas.js` draws every sprite into one texture atlas
with Canvas2D on startup, and `audio/sfx.js` synthesises each sound from
oscillators and noise buffers on demand.

## Tuning

Almost every number that shapes the game lives in `src/game/config.js` — gravity,
drag, wind strength, muzzle velocities, block hit points, blast radii, prices and
income. The computer opponent's three skill levels are the `DIFFICULTY` table at
the top of `src/game/ai.js`.

## About the name

Ballerburg was an Atari ST classic. Bummburg is an original game written from
scratch that shares its premise — two castles, one hill, a great deal of gunpowder
— and none of its code, artwork or assets.

## Licence

MIT. See [LICENSE](LICENSE).
