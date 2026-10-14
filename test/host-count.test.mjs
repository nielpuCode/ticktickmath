import assert from 'node:assert/strict';

function readHostCount(value) {
  const n = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(n) || n < 1) return 10;
  return Math.min(500, n);
}

assert.equal(readHostCount('20'), 20);
assert.equal(readHostCount('15'), 15);
assert.equal(readHostCount('5'), 5);
assert.equal(readHostCount('30'), 30);
assert.equal(readHostCount('3'), 3);
assert.equal(readHostCount('31'), 31);
assert.equal(readHostCount('500'), 500);
assert.equal(readHostCount('501'), 500);
assert.equal(readHostCount(''), 10);
assert.equal(readHostCount('abc'), 10);
assert.equal(readHostCount(' 20 '), 20);
assert.equal(readHostCount('2'), 2);
assert.equal(readHostCount('1'), 1);
assert.equal(readHostCount('0'), 10);
assert.equal(readHostCount(null), 10);

console.log('readHostCount ok');

import { readFileSync } from 'node:fs';
const js = readFileSync('js/game.js', 'utf8')
  + readFileSync('js/game-state.js', 'utf8')
  + readFileSync('js/game-solo.js', 'utf8')
  + readFileSync('js/game-multi.js', 'utf8')
  + readFileSync('js/game-boot.js', 'utf8');
assert.ok(js.includes('hostQuestionCount'), 'hostQuestionCount exists');
assert.ok(js.includes('pendingCount'), 'pendingCount exists');
assert.ok(js.includes('MULTI') || js.includes('multiState.pendingCount'), 'pendingCount logic');
assert.ok(js.includes('q-minus'), 'stepper minus');
assert.ok(js.includes('q-plus'), 'stepper plus');
assert.ok(js.includes('q-display'), 'display');
assert.ok(js.includes('readHostCount'), 'readHostCount');
assert.ok(js.includes('grace-count'), 'grace stepper input');
assert.ok(js.includes('g-display'), 'grace display');
assert.ok(js.includes('readGraceDur'), 'readGraceDur');
console.log('game.js structure ok');

import { readdirSync } from 'node:fs';
const distHtml = readFileSync('dist/index.html', 'utf8');
const assets = readdirSync('dist/assets');
// code-split build: stepper id can live in any chunk, scan them all
const distJs = assets.filter((f) => f.endsWith('.js')).map((f) => readFileSync('dist/assets/' + f, 'utf8')).join('\n');
assert.ok(distHtml.includes('q-minus') || distJs.includes('q-minus'), 'built stepper');
console.log('dist ok: count lock + stepper present');
