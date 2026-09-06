// Gold, powder and the quartermaster's stock.

import { ECONOMY } from './config.js';

/** Price scales with the guns you already have, so a replacement is affordable. */
export const cannonCost = (live) => 240 + live * 140;

export const SHOP = [
  {
    id: 'powder',
    name: 'Barrel of powder',
    desc: '25 more charges for your guns.',
    cost: () => 70,
    available: (g, p) => p.powder < 400,
    apply: (g, p) => { p.powder += 25; return 'Powder stowed in the magazine'; },
  },
  {
    id: 'cannon',
    name: 'Cast a cannon',
    desc: 'Another gun on the walls — every cannon fires once a turn, up to three.',
    cost: (g, p) => cannonCost(g.castles[p.index].liveCannons.length),
    available: (g, p) => g.castles[p.index].cannons.length < ECONOMY.maxCannons
      && g.castles[p.index].mounts.some((m) => !m.used && g.castles[p.index].matAt(m.gx, m.gy) !== 0),
    apply: (g, p) => {
      const c = g.castles[p.index].addCannon();
      if (!c) return null;
      p.cannonsBought++;
      return 'A new gun is hauled onto the walls';
    },
  },
  {
    id: 'masons',
    name: 'Hire masons',
    desc: 'Rebuild up to 12 fallen blocks and shore up what still stands.',
    cost: (g, p) => 200 + p.masonsHired * 70,
    available: (g, p) => g.castles[p.index].integrity < 0.995,
    apply: (g, p) => {
      p.masonsHired++;
      const rebuilt = g.castles[p.index].repair(12, g.rng);
      g.emit('repaired', { player: p.index, cells: rebuilt });
      return rebuilt.length ? `Masons rebuild ${rebuilt.length} blocks` : 'Masons shore up the walls';
    },
  },
  {
    id: 'ironshot',
    name: 'Forge an iron shot',
    desc: 'Your next cannonball hits far harder and blasts wider.',
    cost: () => 130,
    available: (g, p) => !p.ironShot,
    apply: (g, p) => { p.ironShot = true; return 'An iron shot is loaded'; },
  },
];

export function makePlayer(index, name, isAI) {
  return {
    index,
    name,
    isAI,
    gold: ECONOMY.startGold,
    powder: ECONOMY.startPowder,
    cannonsBought: 0,
    masonsHired: 0,
    silenced: 0,
    ironShot: false,
    shots: 0,
    hits: 0,
    blocksDestroyed: 0,
    passes: 0,
  };
}

export function roundIncome(castle) {
  return Math.round(ECONOMY.baseIncome + castle.countCells() * ECONOMY.incomePerCell);
}
