// ponytail: shared state + settings for game cores. Ceiling: single-room globals, no store lib.
// Upgrade path: tiny pub/sub store if cross-file state writes get hard to trace.
const G = (globalThis.MathSprintGame = globalThis.MathSprintGame || {});
  const gen = globalThis.MathSprintGen;
  const multiApi = globalThis.MathSprintMulti;
  const namesApi = globalThis.MathSprintNames;
  const partyApi = globalThis.MathSprintParty;
  const roastApi = globalThis.MathSprintRoast;
  const generateProblem = gen.generateProblem;
  const generateChoices = gen.generateChoices;
  const rankBoard = multiApi.rank;

  function $(id) {
    return document.getElementById(id);
  }
  globalThis.$ = $; G.$ = $;

  const SCREENS = ['home', 'play', 'result', 'multi-setup', 'multi-wait', 'result-1v1', 'qr', 'tutorial'];
  const FEEDBACK_MS = 550;
  const COUNTDOWN_MS = 3200;
  const ANSWER_GRACE_MS = 3000;
  const DISCONNECT_GRACE_MS = 10;
  const GO_MS = 600;
  const OP_CLASS = { '+': 'op-plus', '−': 'op-sub', '×': 'op-mul', '÷': 'op-div' };
  const GRACE_STORE_KEY = 'mathsprint.grace';
  const HARD_STORE_KEY = 'mathsprint.hard';
  const LANG_STORE_KEY = 'mathsprint.lang';
  for (const [k, v] of Object.entries({ SCREENS, FEEDBACK_MS, COUNTDOWN_MS, ANSWER_GRACE_MS, DISCONNECT_GRACE_MS, GO_MS, OP_CLASS, GRACE_STORE_KEY, HARD_STORE_KEY, LANG_STORE_KEY })) {
    globalThis[k] = v; G[k] = v;
  }

  // Shared mutable state (was IIFE closure lets). Single owner: this file.
  // Other cores read/write these as bare globals resolving to globalThis.
  globalThis.timer = null; globalThis.graceTimer = null; globalThis.goTimer = null;
  globalThis.locked = false; globalThis.mode = 'fixed'; globalThis.limit = 10;
  globalThis.current = 0; globalThis.correct = 0; globalThis.total = 0;
  globalThis.qShownAt = 0; globalThis.hostQuestionCount = 10; globalThis.hostGraceSec = 3;
  globalThis.soloHard = false; globalThis.hostHard = false; globalThis.nameEdited = false;
  globalThis.multiState = null; globalThis.disconnectTimer = null; globalThis.joinTimer = null;
  globalThis.qrReturn = 'home';
  globalThis.multi = new multiApi.Multi();
  G.multi = globalThis.multi;
  G.stateOwner = 'game-state';

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function paintStoryOps(text) {
    return String(text).split('').map(function (ch) {
      const cls = ch === '%' ? 'op-div' : OP_CLASS[ch];
      if (!cls) return escapeHtml(ch);
      return '<span class="' + cls + '">' + escapeHtml(ch) + '</span>';
    }).join('');
  }

  function loadLang() {
    try {
      if (typeof localStorage === 'undefined') return 'id';
      return localStorage.getItem(LANG_STORE_KEY) === 'en' ? 'en' : 'id';
    } catch (e) {
      return 'id';
    }
  }

  function gameLang() {
    return loadLang();
  }

  function applyLang(lang) {
    const l = lang === 'en' ? 'en' : 'id';
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(LANG_STORE_KEY, l);
    } catch (e) {}
    const idBtn = $('lang-id');
    const enBtn = $('lang-en');
    const on = 'border-[#F5A623] bg-[#F5A623]/15 text-[#F5A623]';
    const off = 'border-slate-700 text-slate-400';
    if (idBtn) {
      idBtn.classList.remove('border-[#F5A623]', 'bg-[#F5A623]/15', 'text-[#F5A623]', 'border-slate-700', 'text-slate-400');
      idBtn.classList.add.apply(idBtn.classList, (l === 'id' ? on : off).split(' '));
    }
    if (enBtn) {
      enBtn.classList.remove('border-[#F5A623]', 'bg-[#F5A623]/15', 'text-[#F5A623]', 'border-slate-700', 'text-slate-400');
      enBtn.classList.add.apply(enBtn.classList, (l === 'en' ? on : off).split(' '));
    }
  }

  function hideRetryJoin() {
    const r = $('btn-retry-join');
    if (r) {
      r.hidden = true;
      r.classList.add('hidden');
    }
  }

  function showRetryJoin() {
    const r = $('btn-retry-join');
    if (r) {
      r.hidden = false;
      r.classList.remove('hidden');
    }
  }

  function hideRetryHost() {
    const r = $('btn-retry-host');
    if (r) {
      r.hidden = true;
      r.classList.add('hidden');
    }
  }

  function showRetryHost() {
    const r = $('btn-retry-host');
    if (r) {
      r.hidden = false;
      r.classList.remove('hidden');
    }
  }

  function clearJoinTimer() {
    if (joinTimer !== null) {
      clearTimeout(joinTimer);
      joinTimer = null;
    }
  }

  function startJoinTimer() {
    clearJoinTimer();
    hideRetryJoin();
    joinTimer = setTimeout(function () {
      joinTimer = null;
      if (!multiState || multiState.role !== 'guest' || multiState.phase !== 'lobby') return;
      if (multiState.me) return;
      $('wait-status-guest').textContent = 'Still connecting… check code + network, then Retry.';
      showRetryJoin();
      updateReadyUI();
    }, 15000);
  }

  function readHostCount() {
    const el = $('multi-q-count');
    const raw = el && el.value;
    const n = Number.parseInt(String(raw).trim(), 10);
    if (!Number.isFinite(n) || n < 1) return 10;
    return Math.min(500, n);
  }

  function setHostCount(n) {
    hostQuestionCount = Math.min(500, Math.max(1, Number.isFinite(n) ? n : 10));
    const el = $('multi-q-count');
    if (el) el.value = String(hostQuestionCount);
    const disp = $('q-display');
    if (disp) disp.textContent = String(hostQuestionCount);
  }

  function readGraceDur() {
    const el = $('grace-count');
    const raw = el && el.value;
    const n = Number.parseInt(String(raw).trim(), 10);
    if (!Number.isFinite(n)) return 3;
    return Math.max(0, Math.min(10, n));
  }

  function graceCaption(n) {
    return n <= 0 ? 'Off: no rushing' : n + ' seconds to answer after someone else does (0 = off)';
  }

  function setGraceDur(n, save) {
    hostGraceSec = Math.max(0, Math.min(10, Number.isFinite(n) ? n : 3));
    const el = $('grace-count');
    if (el) el.value = String(hostGraceSec);
    const disp = $('g-display');
    if (disp) disp.textContent = graceCaption(hostGraceSec);
    if (save !== false) {
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(GRACE_STORE_KEY, String(hostGraceSec));
      } catch (e) {}
    }
  }

  function loadGraceDur() {
    try {
      if (typeof localStorage === 'undefined') return 3;
      const raw = localStorage.getItem(GRACE_STORE_KEY);
      if (raw === null || raw === '') return 3;
      const n = Number.parseInt(String(raw).trim(), 10);
      if (!Number.isFinite(n)) return 3;
      return Math.max(0, Math.min(10, n));
    } catch (e) {
      return 3;
    }
  }

  function loadHard() {
    try {
      if (typeof localStorage === 'undefined') return false;
      return localStorage.getItem(HARD_STORE_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function saveHard(on) {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(HARD_STORE_KEY, on ? '1' : '');
    } catch (e) {}
  }

  // Room ticket: lets a refresh rejoin the same room instead of dying to home.
  // sessionStorage (not localStorage): survives refresh, dies with the tab,
  // so a closed tab never resurrects a dead room later.
  const ROOM_TICKET_KEY = 'mathsprint.room';

  function saveRoomTicket(t) {
    try {
      if (typeof sessionStorage === 'undefined') return;
      if (!t || (t.role !== 'host' && t.role !== 'guest')) return;
      const code = String(t.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      if (code.length !== 6) return;
      sessionStorage.setItem(ROOM_TICKET_KEY, JSON.stringify({
        role: t.role,
        code: code,
        name: String(t.name || '').slice(0, 20),
        typed: !!t.typed,
        rounds: Math.max(1, Math.min(500, Number.isFinite(+t.rounds) ? +t.rounds : 10)),
        grace: Math.max(0, Math.min(10, Number.isFinite(+t.grace) ? +t.grace : 3)),
        hard: !!t.hard,
      }));
    } catch (e) {}
  }

  function loadRoomTicket() {
    try {
      if (typeof sessionStorage === 'undefined') return null;
      const raw = sessionStorage.getItem(ROOM_TICKET_KEY);
      if (!raw) return null;
      const t = JSON.parse(raw);
      if (!t || (t.role !== 'host' && t.role !== 'guest')) return null;
      const code = String(t.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      if (code.length !== 6) return null;
      t.code = code;
      return t;
    } catch (e) {
      return null;
    }
  }

  function clearRoomTicket() {
    try {
      if (typeof sessionStorage === 'undefined') return;
      sessionStorage.removeItem(ROOM_TICKET_KEY);
    } catch (e) {}
  }

  function clampCount(value, min, max, fallback) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function formatMs(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '-';
    return (ms / 1000).toFixed(1) + 's';
  }

  function inviteLink(code) {
    const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (c.length !== 6) return '';
    return window.location.origin + window.location.pathname + '?room=' + c;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '0';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (e) {
        ok = false;
      }
      document.body.removeChild(ta);
      if (ok) resolve();
      else reject(new Error('copy-failed'));
    });
  }


  // expose for cross-file bare-call resolution (same logic, shared globals)
  globalThis.escapeHtml = escapeHtml; G.escapeHtml = escapeHtml;
  globalThis.paintStoryOps = paintStoryOps; G.paintStoryOps = paintStoryOps;
  globalThis.loadLang = loadLang; G.loadLang = loadLang;
  globalThis.gameLang = gameLang; G.gameLang = gameLang;
  globalThis.applyLang = applyLang; G.applyLang = applyLang;
  globalThis.hideRetryJoin = hideRetryJoin; G.hideRetryJoin = hideRetryJoin;
  globalThis.showRetryJoin = showRetryJoin; G.showRetryJoin = showRetryJoin;
  globalThis.hideRetryHost = hideRetryHost; G.hideRetryHost = hideRetryHost;
  globalThis.showRetryHost = showRetryHost; G.showRetryHost = showRetryHost;
  globalThis.clearJoinTimer = clearJoinTimer; G.clearJoinTimer = clearJoinTimer;
  globalThis.startJoinTimer = startJoinTimer; G.startJoinTimer = startJoinTimer;
  globalThis.readHostCount = readHostCount; G.readHostCount = readHostCount;
  globalThis.setHostCount = setHostCount; G.setHostCount = setHostCount;
  globalThis.readGraceDur = readGraceDur; G.readGraceDur = readGraceDur;
  globalThis.graceCaption = graceCaption; G.graceCaption = graceCaption;
  globalThis.setGraceDur = setGraceDur; G.setGraceDur = setGraceDur;
  globalThis.loadGraceDur = loadGraceDur; G.loadGraceDur = loadGraceDur;
  globalThis.loadHard = loadHard; G.loadHard = loadHard;
  globalThis.saveHard = saveHard; G.saveHard = saveHard;
  globalThis.saveRoomTicket = saveRoomTicket; G.saveRoomTicket = saveRoomTicket;
  globalThis.loadRoomTicket = loadRoomTicket; G.loadRoomTicket = loadRoomTicket;
  globalThis.clearRoomTicket = clearRoomTicket; G.clearRoomTicket = clearRoomTicket;
  globalThis.clampCount = clampCount; G.clampCount = clampCount;
  globalThis.formatMs = formatMs; G.formatMs = formatMs;
  globalThis.inviteLink = inviteLink; G.inviteLink = inviteLink;
  globalThis.copyText = copyText; G.copyText = copyText;
