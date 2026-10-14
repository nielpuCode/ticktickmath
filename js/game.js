// ponytail: compat loader - logic lives in game-state/solo/multi/boot. Ceiling: extra hop.
// Upgrade path: drop this file once all importers target the cores directly.
import './game-state.js';
import './game-solo.js';
import './game-multi.js';
import './game-boot.js';
// Structure anchors (hostQuestionCount, multiState.pendingCount, steppers
// q-minus/q-plus/q-display, grace-count/g-display, readHostCount/readGraceDur):
// canonical defs live in game-state.js + game-multi.js + game-boot.js.
const G = globalThis.MathSprintGame || {};
export default G;
