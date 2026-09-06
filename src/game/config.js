// Shared tuning constants. World units are roughly "centimetres of castle":
// a wall block is 14 units, a castle 308 units wide, the battlefield 1800.

export const WORLD = {
  width: 1800,
  skyTop: 2600,
  groundFloor: -160,
};

export const CELL_SIZE = 14;
export const CASTLE_COLS = 22;
export const CASTLE_ROWS = 20;

export const CASTLE_CENTRE = [300, 1500];   // left player, right player

export const PHYSICS = {
  gravity: 380,
  drag: 0.000042,
  windScale: 55,          // world units/s² at wind strength 1
  muzzleBase: 130,        // speed at power 0
  muzzlePerPower: 6.9,    // + per power point (power is 5..100)
  maxFlightTime: 26,
};

export const ECONOMY = {
  startGold: 420,
  startPowder: 60,
  baseIncome: 55,
  incomePerCell: 0.42,      // × intact blocks: a healthy castle pays better taxes
  maxCannons: 5,
  maxShotsPerTurn: 3,
  powderPerShot: (power) => Math.max(1, Math.ceil(power / 6)),
};

export const DAMAGE = {
  ballRadius: 5.5,
  blastRadius: 30,
  blastDamage: 210,
  powderBlastRadius: 96,
  powderBlastDamage: 460,
  craterRadius: 34,
};

/** Block materials. Index order matters — it is stored in the grid. */
export const MAT = {
  EMPTY: 0,
  STONE: 1,
  GRANITE: 2,
  WOOD: 3,
  ROOF: 4,
  GATE: 5,
  SLIT: 6,
  KING: 7,
  POWDER: 8,
};

export const MAT_INFO = {
  [MAT.STONE]:   { hp: 105, sprite: ['stoneA', 'stoneB', 'stoneC'], tint: [1, 1, 1] },
  [MAT.GRANITE]: { hp: 165, sprite: ['granite'], tint: [1, 1, 1] },
  [MAT.WOOD]:    { hp: 58,  sprite: ['wood'], tint: [1, 1, 1] },
  [MAT.ROOF]:    { hp: 46,  sprite: ['roof'], tint: [1, 1, 1] },
  [MAT.GATE]:    { hp: 88,  sprite: ['gate'], tint: [1, 1, 1] },
  [MAT.SLIT]:    { hp: 95,  sprite: ['slit'], tint: [1, 1, 1] },
  [MAT.KING]:    { hp: 130, sprite: ['stoneB'], tint: [1.15, 1.05, 0.85] },
  [MAT.POWDER]:  { hp: 34,  sprite: ['wood'], tint: [0.85, 0.72, 0.6] },
};

export const PLAYER_COLORS = [
  [0.44, 0.70, 1.0],
  [1.0, 0.49, 0.42],
];
