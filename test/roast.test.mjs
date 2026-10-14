import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const roast = require('../js/roast.js');

const tables = roast.tables;
const keys = Object.keys(tables);

// volume: at least 30 scenarios, every bracket able to vary per player
const total = keys.reduce((n, k) => n + tables[k].length, 0);
assert.ok(total >= 30, 'scenario count: ' + total);
for (const k of keys) {
  assert.ok(tables[k].length >= 2, k + ' needs 2+ variants');
}

// shape: short non-empty strings, unique titles (no two players, same line idea twice)
const seen = {};
for (const k of keys) {
  for (const [t, l] of tables[k]) {
    assert.ok(typeof t === 'string' && t.length > 0, k + ' title');
    assert.ok(typeof l === 'string' && l.length > 0, k + ' line');
    assert.ok(l.length <= 140, 'line fits mobile row: ' + t);
    assert.ok(!seen[t], 'duplicate title: ' + t);
    seen[t] = true;
  }
}

const inTable = (got, k) => tables[k].some(([t]) => t === got.title);
const base = { answered: 5, ms: 25000, rank: 2, players: 4, total: 5, firstCorrect: 5 };

// every branch of the classifier
assert.ok(inTable(roast.pick({ ...base, id: 'z', correct: 0 }), 'ZERO'), 'zero');
assert.ok(inTable(roast.pick({ ...base, id: 'z', correct: 0, answered: 0, ms: 0, rank: 1, players: 2 }), 'ZERO'), 'zero, no answers');
assert.ok(inTable(roast.pick({ ...base, id: 'z', correct: 5 }), 'PERFECT'), 'perfect');
assert.ok(inTable(roast.pick({ ...base, id: 'z', correct: 4, rank: 1, firstCorrect: 4 }), 'WIN'), 'winner');
assert.ok(inTable(roast.pick({ ...base, id: 'z', correct: 4, rank: 2, firstCorrect: 4 }), 'TIE'), 'tiebreak');
// same score, different time - tiebreak sympathy at any depth, never bottom-fragged
assert.ok(inTable(roast.pick({ ...base, id: 't3', correct: 4, rank: 3, players: 3, firstCorrect: 4 }), 'TIE'), '3-way tie, last on time');
assert.ok(inTable(roast.pick({ ...base, id: 'e', correct: 3, ms: 15000, rank: 2, players: 2, firstCorrect: 3 }), 'TIE'), 'exact 2P tie');
// same finish, fewer correct at the bottom is still a genuine bottom frag
assert.ok(inTable(roast.pick({ ...base, id: 'b', correct: 2, ms: 30000, rank: 3, players: 3, firstCorrect: 5 }), 'BOTTOM'), 'outscored bottom');
assert.ok(inTable(roast.pick({ ...base, id: 'z', correct: 1, ms: 10000, rank: 4 }), 'SPEED'), 'speedrunner beats bottom');
assert.ok(inTable(roast.pick({ ...base, id: 'z', correct: 2, ms: 30000, rank: 4 }), 'BOTTOM'), 'bottom frag');
assert.ok(inTable(roast.pick({ ...base, id: 'z', correct: 4, ms: 50000, rank: 3 }), 'SLOW'), 'slow poke');
assert.ok(inTable(roast.pick({ ...base, id: 'z', correct: 3, rank: 2 }), 'MID'), 'mid npc');

// deterministic: every client renders the same line for the same player
const stat = { ...base, id: 'p7', correct: 3 };
assert.deepEqual(roast.pick(stat), roast.pick(stat), 'deterministic');

// same scenario, different players, different lines possible
const titles = new Set();
for (let i = 0; i < 20; i++) {
  titles.add(roast.pick({ ...base, id: 'mid-' + i, correct: 3, rank: 2 }).title);
}
assert.ok(titles.size > 1, 'variants actually vary');

// strict tie: same score AND same time, or it is a loss
let h = roast.headline(
  [{ id: 'a', name: 'A', correct: 3, ms: 1000 }, { id: 'b', name: 'B', correct: 3, ms: 2000 }], 'b');
assert.equal(h.title, '#2 of 2', 'same score slower time is a loss');
assert.equal(h.cls, 'result-lose');
assert.equal(h.note, 'Most correct wins · ties: accuracy, then time');
h = roast.headline(
  [{ id: 'a', name: 'A', correct: 3, ms: 1000 }, { id: 'b', name: 'B', correct: 3, ms: 2000 }], 'a');
assert.equal(h.title, 'You Win!', 'faster time wins outright, no tie');
assert.equal(h.cls, 'result-win');
h = roast.headline(
  [{ id: 'a', name: 'A', correct: 3, ms: 1000 }, { id: 'b', name: 'B', correct: 3, ms: 1000 }], 'b');
assert.equal(h.title, 'Tie for 1st!', 'exact tie shares the crown');
assert.equal(h.cls, 'result-draw');
assert.equal(h.note, 'Exact tie: same score, same time');
h = roast.headline([{ id: 'a', name: 'A', correct: 3, ms: 1000 }], 'a');
assert.equal(h.title, 'You Win!', 'solo board');
assert.equal(h.note, '', 'no note on solo board');
h = roast.headline(
  [{ id: 'a', name: 'A', correct: 5, ms: 1000 }, { id: 'b', name: 'B', correct: 3, ms: 500 }], 'b');
assert.equal(h.title, '#2 of 2', 'outscored is a loss even when faster');

// wiring: game cores must call the helper (results header would crash without it)
import { readFileSync } from 'node:fs';
const gameSrc = ['game.js', 'game-state.js', 'game-solo.js', 'game-multi.js', 'game-boot.js']
  .map((f) => readFileSync(new URL('../js/' + f, import.meta.url), 'utf8')).join('\n');
assert.ok(gameSrc.includes('roastApi.headline'), 'showStandings calls roast.headline');
assert.ok(!gameSrc.includes('Tie on score'), 'old loose-tie copy gone');

console.log('roast ok: ' + total + ' scenarios across ' + keys.length + ' brackets');
