// ponytail: multiplayer room + race + net events. Ceiling: mid-race refresh drops to lobby, room dies with tab close.
// Upgrade path: mid-race resume sync; own signaling worker if rooms must outlive host tab.
const G = (globalThis.MathSprintGame = globalThis.MathSprintGame || {});
  const gen = globalThis.MathSprintGen;
  const multiApi = globalThis.MathSprintMulti;
  const namesApi = globalThis.MathSprintNames;
  const partyApi = globalThis.MathSprintParty;
  const roastApi = globalThis.MathSprintRoast;
  const generateProblem = gen.generateProblem;
  const generateChoices = gen.generateChoices;
  const rankBoard = multiApi.rank;

  const $ = globalThis.$;
  const SCREENS = globalThis.SCREENS;
  const FEEDBACK_MS = globalThis.FEEDBACK_MS;
  const COUNTDOWN_MS = globalThis.COUNTDOWN_MS;
  const ANSWER_GRACE_MS = globalThis.ANSWER_GRACE_MS;
  const DISCONNECT_GRACE_MS = globalThis.DISCONNECT_GRACE_MS;
  const GO_MS = globalThis.GO_MS;
  const OP_CLASS = globalThis.OP_CLASS;
  const GRACE_STORE_KEY = globalThis.GRACE_STORE_KEY;
  const HARD_STORE_KEY = globalThis.HARD_STORE_KEY;
  const LANG_STORE_KEY = globalThis.LANG_STORE_KEY;
  const multi = globalThis.multi;
  // Refresh recovery: rejoin pacing (module-scoped; only this core uses it).
  let rejoinTimer = null;
  const RECLAIM_TRIES = 3;
  const RECLAIM_DELAY_MS = 2000;
  const REJOIN_EVERY_MS = 3000;
  const REJOIN_MAX = 20;

  function clearRejoin() {
    if (rejoinTimer !== null) {
      clearTimeout(rejoinTimer);
      rejoinTimer = null;
    }
  }
  function renderBars() {
    if (!multiState) return;
    const box = $('multi-bars');
    if (!box) return;
    const lim = multiState.limit || 1;
    const ids = Object.keys(multiState.party.players);
    ids.sort(function (a, b) {
      if (a === multiState.me) return -1;
      if (b === multiState.me) return 1;
      return multiState.party.players[b].answered - multiState.party.players[a].answered;
    });
    box.replaceChildren();
    for (let i = 0; i < ids.length; i++) {
      const p = multiState.party.players[ids[i]];
      const you = ids[i] === multiState.me;
      const row = document.createElement('div');
      row.className = 'flex items-center gap-2';
      const dot = document.createElement('span');
      dot.className = 'h-3 w-3 shrink-0 rounded-full ' + (you
        ? 'bg-cyan-400 shadow shadow-cyan-400/50'
        : 'bg-amber-400 shadow shadow-amber-400/50');
      const name = document.createElement('span');
      name.className = 'w-20 shrink-0 truncate text-xs font-bold ' + (you ? 'text-cyan-300' : 'text-amber-300');
      name.textContent = (you ? p.name + ' (you)' : p.name) + (p.done ? ' ✓' : '');
      const track = document.createElement('div');
      track.className = 'h-3 flex-1 overflow-hidden rounded-full bg-slate-800/90 ring-1 ring-slate-700/80';
      const fill = document.createElement('div');
      fill.className = 'h-full rounded-full transition-all duration-300 ' + (you
        ? 'bg-gradient-to-r from-cyan-500 to-cyan-300'
        : 'bg-gradient-to-r from-amber-500 to-amber-300');
      fill.style.width = Math.min(100, Math.round((p.answered / lim) * 100)) + '%';
      track.appendChild(fill);
      const score = document.createElement('span');
      score.className = 'w-16 shrink-0 text-right text-xs font-bold tabular-nums text-slate-300';
      score.textContent = p.correct + '✓ ' + p.answered + '/' + lim;
      row.appendChild(dot);
      row.appendChild(name);
      row.appendChild(track);
      row.appendChild(score);
      box.appendChild(row);
    }
  }

  function commitMultiAnswer(ok, blank) {
    const lim = multiState.limit || multiState.questions.length || 0;
    const finished = lim > 0 && current >= lim;
    // Per-question answering time: a local delta, so it stays comparable
    // across devices with skewed clocks (never an absolute timestamp).
    const now = Date.now();
    const dms = qShownAt > 0 ? Math.max(0, now - qShownAt) : 0;
    const msg = {
      type: 'answered',
      index: current - 1,
      correct: !!ok,
      blank: !!blank,
      done: finished,
      dms: dms,
      from: multiState.me,
    };
    multiState.pendingGrace = null;
    partyApi.applyAnswered(multiState.party, multiState.me, msg);
    multi.send(msg); // guest -> host, host -> broadcast to all guests
    renderBars();
    updateLive();
    hidePeerAlert();
    if (finished) {
      finishLocalQuestions();
      return;
    }
    timer = setTimeout(function () {
      timer = null;
      nextQuestion();
    }, FEEDBACK_MS);
  }

  function graceTotalMs() {
    const sec = multiState && Number.isFinite(multiState.graceSec) ? multiState.graceSec : ANSWER_GRACE_MS / 1000;
    return Math.max(0, Math.min(10, sec)) * 1000;
  }

  function maybeStartAnswerGrace(data) {
    if (!multiState || multiState.phase !== 'playing') return;
    if (graceTimer !== null) return;
    if (!data || data.index !== current) return;
    if (graceTotalMs() <= 0) return;
    // Answered during my own feedback lock: the message is for the question
    // already on screen, so park it and start the countdown right after render.
    if (locked) {
      multiState.pendingGrace = { index: data.index, from: data.from };
      return;
    }
    const p = multiState.party.players[data.from];
    const name = p ? p.name : 'Someone';
    const total = graceTotalMs();
    const deadline = Date.now() + total;
    showPeerAlert(name, Math.ceil(total / 1000));
    graceTimer = setInterval(function () {
      const left = deadline - Date.now();
      if (left <= 0) {
        clearGrace();
        forceBlank();
        return;
      }
      const num = $('peer-alert-num');
      if (num) num.textContent = String(Math.ceil(left / 1000));
      const fill = $('peer-alert-fill');
      if (fill) fill.style.width = Math.max(0, (left / total) * 100) + '%';
    }, 100);
  }

  function forceBlank() {
    if (!multiState || multiState.phase !== 'playing') return;
    if (locked) return;
    locked = true;
    clearTimer();
    clearGrace();
    hidePeerAlert();
    const problem = multiState.questions[current];
    if (!problem) return;
    total += 1;
    current += 1;
    paintChoices(problem, null);
    commitMultiAnswer(false, true);
  }

  function finishLocalQuestions() {
    if (!multiState || multiState.localDone) return;
    multiState.localDone = true;
    multiState.phase = 'waiting-players';
    locked = true;
    updateLive();
    maybeEndMulti();
  }

  function maybeEndMulti() {
    if (!multiState || multiState.phase === 'done') return;
    if (!partyApi.allDone(multiState.party)) return;
    endMulti();
  }

  function showStandings() {
    const board = rankBoard(partyApi.rosterList(multiState.party));
    const screen = $('screen-result-1v1');
    screen.classList.remove('result-win', 'result-lose', 'result-draw');

    const first = board[0] || { name: 'Nobody', correct: 0, ms: 0 };
    const mePos = board.findIndex(function (p) { return p.id === multiState.me; }) + 1;
    // Strict tie lives in roast.headline: same score AND same time only.
    const head = roastApi && roastApi.headline
      ? roastApi.headline(board, multiState.me)
      : { title: '#' + (mePos > 0 ? mePos : board.length) + ' of ' + board.length, cls: 'result-lose', note: '' };
    screen.classList.add(head.cls);

    $('winner-label').textContent = head.title;
    // Main sub-display: one shared walk-of-shame for last place, shown to
    // every viewer right under their own rank. The name pops in an amber
    // chip so it reads first. Hidden on an exact-tie draw (no bottom frag
    // when the crown is shared) and on a solo board.
    const botEl = $('botfrag');
    if (botEl) {
      const last = board.length > 1 && head.cls !== 'result-draw' ? board[board.length - 1] : null;
      botEl.replaceChildren();
      if (last) {
        const pre = document.createElement('span');
        pre.textContent = '🤡 Botfrag ';
        const nm = document.createElement('span');
        nm.className = 'whitespace-nowrap rounded-md bg-[#D72638]/20 px-1.5 text-[#F5A623]';
        nm.textContent = last.name;
        const post = document.createElement('span');
        post.textContent = ' literally needs to go back to kindergarten, fr 💀';
        botEl.appendChild(pre);
        botEl.appendChild(nm);
        botEl.appendChild(post);
        botEl.hidden = false;
        botEl.classList.remove('hidden');
      } else {
        botEl.hidden = true;
        botEl.classList.add('hidden');
      }
    }
    const homeBtn = $('btn-1v1-home');
    if (homeBtn) {
      homeBtn.textContent = board.length > 0 && board[0].id === multiState.me
        ? "Let's Go Home, Winner... 🏆"
        : "Let's Go Home, Loser... 💀";
    }
    const list = $('r1-standings');
    list.replaceChildren();
    for (let i = 0; i < board.length; i++) {
      const p = board[i];
      const you = p.id === multiState.me;
      const row = document.createElement('li');
      row.className = 'flex flex-col gap-1 rounded-2xl border-2 border-[#12100E] px-4 py-3 shadow-[0_3px_0_#12100E] ' + (you
  ? 'bg-[#29B6F6]/20 text-[#29B6F6]'
  : 'bg-[#0D1117] text-[#FFF7EB]');
      const top = document.createElement('div');
      top.className = 'flex items-center justify-between gap-3';
      const left = document.createElement('span');
      left.className = 'truncate font-bold ' + (you ? 'text-cyan-300' : 'text-slate-200');
      left.textContent = '#' + (i + 1) + ' ' + p.name + (you ? ' (you)' : '');
      const right = document.createElement('span');
      right.className = 'shrink-0 text-right font-extrabold tabular-nums text-slate-100';
      right.textContent = p.correct + '✓ · ' + formatMs(p.ms);
      top.appendChild(left);
      top.appendChild(right);
      row.appendChild(top);
      row.classList.add('anim-rise');
      row.style.animationDelay = (i * 70) + 'ms';
      // Every row carries its roast caption - the roast list lives here in
      // the rankings, while the headline above is rank + the botfrag callout.
      if (roastApi && roastApi.pick) {
        const roast = roastApi.pick({
          id: p.id,
          correct: p.correct,
          answered: p.answered,
          ms: p.ms,
          rank: i + 1,
          players: board.length,
          total: multiState.limit,
          firstCorrect: first.correct,
        });
        const cap = document.createElement('p');
        cap.className = 'text-[11px] font-bold leading-snug text-slate-400';
        const capTitle = document.createElement('span');
        capTitle.className = 'font-black uppercase tracking-wide text-[#F5A623]';
        capTitle.textContent = roast.title;
        const capLine = document.createElement('span');
        capLine.textContent = ' · ' + roast.line;
        cap.appendChild(capTitle);
        cap.appendChild(capLine);
        row.appendChild(cap);
      }
      list.appendChild(row);
    }
    $('r1-note').textContent = head.note;
    showScreen('result-1v1');
  }

  function endMulti() {
    clearTimer();
    clearGrace();
    clearDisconnect();
    hidePeerAlert();
    if (!multiState || multiState.phase === 'done') return;
    multiState.phase = 'done';
    locked = true;
    showStandings();
  }

  function resetMultiState(role) {
    multiState = {
      role: role,
      me: '',
      myName: '',
      typedName: false,
      code: '',
      phase: 'lobby',
      questions: [],
      limit: 0,
      pendingCount: 0,
      myReady: false,
      countdownStarted: false,
      renamePending: false,
      localDone: false,
      pendingGrace: null,
      graceSec: 3,
      connOpen: false,
      reclaiming: false,
      reclaimTries: 0,
      party: partyApi.createRoom(),
    };
  }

  // Host path: rebuild the same room code after a refresh. Roster starts
  // fresh (guests re-hello); match restarts from the lobby by design.
  function reclaimHostRoom(t) {
    enterMultiWait('host');
    multiState.myName = String(t.name || '').slice(0, 20) || namesApi.randomName();
    multiState.typedName = !!t.typed;
    hostHard = !!t.hard;
    partyApi.addPlayer(multiState.party, 'host', multiState.myName);
    multiState.me = 'host';
    multiState.pendingCount = Math.max(1, Math.min(500, Number.isFinite(+t.rounds) ? +t.rounds : 10));
    multiState.limit = multiState.pendingCount;
    hostQuestionCount = multiState.pendingCount;
    multiState.graceSec = Number.isFinite(+t.grace) ? Math.max(0, Math.min(10, +t.grace)) : 3;
    setGraceDur(multiState.graceSec, false);
    multiState.reclaiming = true;
    multiState.reclaimTries = 0;
    updateReadyUI();
    $('wait-status').textContent = 'Reclaiming room ' + t.code + '…';
    multi.createRoom(t.code);
  }

  // Guest path: rejoin the same code with the confirmed (possibly suffixed)
  // name so the host roster reads the same as before the refresh.
  function reclaimGuestRoom(t) {
    joinWithCode(t.code, { name: String(t.name || '').slice(0, 20), typed: !!t.typed });
  }

  // Guest patience: host tab died (refresh). Ping the same code while the
  // host reclaims instead of bouncing to setup instantly.
  function startHostWatch(msg) {
    if (!multiState || multiState.role !== 'guest' || multiState.phase !== 'lobby') return;
    clearJoinTimer();
    clearRejoin();
    showMultiError(msg || 'Connection lost. Retrying…');
    const code = multiState.code;
    multiState.connOpen = false; // stale flag from the dead conn; pings run until welcome
    let tries = 0;
    $('wait-status-guest').textContent = 'Host reconnecting…';
    const ping = function () {
      rejoinTimer = null;
      if (!multiState || multiState.role !== 'guest' || multiState.phase !== 'lobby') return;
      if (multiState.connOpen && multiState.me) return; // welcomed back
      tries += 1;
      if (tries > REJOIN_MAX) {
        enterMultiSetup(); // re-rolls an unsaved random name
        showMultiError('Host did not return. Check the code and join again.');
        return;
      }
      $('wait-status-guest').textContent = 'Host reconnecting… (' + tries + ')';
      multi.joinRoom(code);
      rejoinTimer = setTimeout(ping, REJOIN_EVERY_MS);
    };
    rejoinTimer = setTimeout(ping, REJOIN_EVERY_MS);
  }

  function resetForRematch() {
    if (!multiState) return;
    partyApi.resetScores(multiState.party);
    multiState.phase = 'lobby';
    multiState.myReady = false;
    multiState.countdownStarted = false;
    multiState.localDone = false;
    multiState.questions = [];
    multiState.pendingGrace = null;
    locked = false;
    if (multiState.role === 'host') broadcastRoster();
    updateReadyUI();
    showScreen('multi-wait');
  }

  function showMultiError(msg) {
    const el = $('multi-error');
    el.textContent = msg;
    el.classList.remove('hidden');
    const wait = $('screen-multi-wait');
    if (wait && !wait.classList.contains('hidden')) {
      if (multiState && multiState.role === 'guest') {
        $('wait-status-guest').textContent = msg;
      } else {
        $('wait-status').textContent = msg;
      }
    }
  }

  function clearMultiError() {
    const el = $('multi-error');
    el.textContent = '';
    el.classList.add('hidden');
  }

  function renderRoom() {
    if (!multiState) return;
    const n = partyApi.size(multiState.party);
    const count = $('player-count');
    if (count) count.textContent = n + ' / ' + partyApi.MAX_PLAYERS + ' joined';
    const box = $('roster');
    if (!box) return;
    box.replaceChildren();
    const ids = Object.keys(multiState.party.players);
    for (let i = 0; i < ids.length; i++) {
      const p = multiState.party.players[ids[i]];
      const you = ids[i] === multiState.me;
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between gap-3 rounded-2xl border px-4 py-2.5 ' + (you
        ? 'border-cyan-500/30 bg-cyan-500/10'
        : 'border-slate-700/60 bg-slate-900/70');
      const left = document.createElement('span');
      left.className = 'truncate font-bold ' + (you ? 'text-cyan-200' : 'text-slate-200');
      left.textContent = p.name + (you ? ' (you)' : '')
        + (ids[i] === 'host' && multiState.me !== 'host' ? ' 👑 (host)' : '');
      const chip = document.createElement('span');
      chip.className = 'shrink-0 rounded-full px-3 py-1 text-xs font-extrabold ' + (p.ready
        ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40'
        : 'bg-slate-800 text-slate-400 ring-1 ring-slate-700');
      chip.textContent = p.ready ? 'Ready ✓' : 'Waiting';
      row.appendChild(left);
      row.appendChild(chip);
      row.classList.add('anim-rise');
      row.style.animationDelay = (i * 50) + 'ms';
      box.appendChild(row);
    }
  }

  function broadcastRoster() {
    if (!multiState || multiState.role !== 'host') return;
    multi.send({
      type: 'roster',
      players: partyApi.rosterList(multiState.party),
      count: partyApi.size(multiState.party),
      cap: partyApi.MAX_PLAYERS,
      rounds: multiState.pendingCount,
    });
  }

  function refreshRoster() {
    if (!multiState || multiState.phase !== 'lobby') return;
    renderRoom();
    if (multiState.role === 'host') broadcastRoster();
    else if (multiState.connOpen) multi.send({ type: 'hello', name: multiState.myName });
    updateReadyUI();
  }

  function updateReadyUI() {
    if (!multiState) return;
    const btn = $('btn-ready');
    const badge = $('ready-badge');
    const hostBox = $('wait-host');
    const guestBox = $('wait-guest');
    const status = multiState.role === 'host' ? $('wait-status') : $('wait-status-guest');

    hostBox.classList.toggle('hidden', multiState.role !== 'host');
    guestBox.classList.toggle('hidden', multiState.role !== 'guest');

    if (multiState.role === 'host' && multiState.code) {
      $('room-code').textContent = multiState.code;
    } else if (multiState.role === 'guest' && multiState.code) {
      $('room-code-guest').textContent = multiState.code;
    }
    // Hidden invite-link holders for the copy buttons (both roles).
    const link = multiState.code ? inviteLink(multiState.code) : '';
    const lh = $('invite-link-host');
    if (lh) lh.textContent = link;
    const lg = $('invite-link-guest');
    if (lg) lg.textContent = link;
    // Dev/LAN addresses can't be opened from other phones (and WebRTC needs
    // https anyway): say so right where the invite is shared.
    const hn = window.location.hostname || '';
    const localOnly = hn === 'localhost' || hn === '127.0.0.1'
      || /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(hn);
    const hh = $('invite-hint-host');
    if (hh) hh.hidden = !localOnly;
    const hg = $('invite-hint-guest');
    if (hg) hg.hidden = !localOnly;
    const rdisp = $('r-display');
    if (rdisp) rdisp.textContent = String(multiState.pendingCount > 0 ? multiState.pendingCount : (hostQuestionCount || ''));

    renderRoom();

    const both = partyApi.allReady(multiState.party);
    const waiting = [];
    const wids = Object.keys(multiState.party.players);
    for (let i = 0; i < wids.length; i++) {
      const wp = multiState.party.players[wids[i]];
      if (!wp.ready && wids[i] !== multiState.me) waiting.push(wp.name);
    }
    const waitingLabel = waiting.length ? waiting.join(', ') : '…';

    const linked = multiState.role === 'host' ? !!multiState.code : multiState.connOpen;
    const readyVisible = multiState.phase === 'lobby' && linked && !both;
    btn.hidden = !readyVisible;
    btn.disabled = false;
    btn.textContent = multiState.myReady ? 'Unready ✕' : 'I\'m Ready ✓';

    const othersReady = partyApi.size(multiState.party) >= 2 && waiting.length === 0 && !multiState.myReady;
    badge.classList.toggle('hidden', !othersReady);
    badge.hidden = !othersReady;

    const roundsTxt = multiState.pendingCount > 0 ? ' · ' + multiState.pendingCount + ' questions' : '';
    if (both) status.textContent = 'Everyone ready, starting…';
    else if (multiState.role === 'host' && partyApi.size(multiState.party) < 2 && !multiState.connOpen) {
      const qn = multiState.pendingCount || hostQuestionCount || '';
      status.textContent = 'Share this code' + (qn ? ' · ' + qn + ' questions' : '') + ' · waiting for players…';
    } else if (multiState.myReady) status.textContent = 'Waiting for: ' + waitingLabel + roundsTxt;
    else status.textContent = 'Tap "I\'m Ready" below · waiting for: ' + waitingLabel + roundsTxt;
  }

  function resolveName() {
    const inp = $('player-name');
    const typed = inp && inp.value ? inp.value.trim().slice(0, 20) : '';
    if (typed) {
      const custom = nameEdited || typed === namesApi.loadCustom();
      if (custom) namesApi.saveCustom(typed);
      inp.value = typed;
      return { name: typed, typed: custom };
    }
    const saved = namesApi.loadCustom();
    if (saved) return { name: saved, typed: true };
    return { name: namesApi.randomName(), typed: false };
  }

  function maybeStartCountdown() {
    if (!multiState) return;
    if (multiState.role !== 'host') return;
    if (!partyApi.allReady(multiState.party)) return;
    if (multiState.countdownStarted) return;
    multiState.countdownStarted = true;
    multiState.phase = 'countdown';

    if (multiState.role === 'host') {
      const count = multiState.pendingCount > 0 ? multiState.pendingCount : (hostQuestionCount > 0 ? hostQuestionCount : readHostCount());
      hostQuestionCount = count;
      multiState.pendingCount = count;
      multiState.limit = count;
      if ($('multi-q-count')) $('multi-q-count').value = String(count);
      const disp = $('q-display');
      if (disp) disp.textContent = String(count);
      const questions = buildQuestions(count);
      if (questions.length !== count) {
        console.warn('[1v1] build mismatch', questions.length, count);
      }
      multiState.questions = questions;
      multiState.limit = questions.length;
      multi.send({ type: 'begin', questions: questions, count: questions.length, grace: multiState.graceSec });
      beginCountdown();
    }
  }

  function someoneAhead() {
    if (!multiState) return null;
    const ids = Object.keys(multiState.party.players);
    for (let i = 0; i < ids.length; i++) {
      if (ids[i] === multiState.me) continue;
      const p = multiState.party.players[ids[i]];
      if (p.answered > current) return p;
    }
    return null;
  }

  function punchCountdown() {
    const el = $('countdown-num');
    el.classList.remove('cd-punch');
    void el.offsetWidth;
    el.classList.add('cd-punch');
  }

  function beginCountdown() {
    showScreen('play');
    showMultiPlayChrome();
    $('choices').replaceChildren();
    $('equation').textContent = '…';
    hidePeerAlert();
    clearGo();
    const cdOverlay = $('overlay-countdown');
    cdOverlay.classList.remove('hidden');
    cdOverlay.hidden = false;
    $('countdown-num').textContent = '3';

    // Local duration, not a host timestamp: phone clocks differ by seconds,
    // so a shared absolute deadline starts everyone at different times.
    const deadline = Date.now() + COUNTDOWN_MS;
    const tick = setInterval(function () {
      const left = deadline - Date.now();
      if (left <= 0) {
        clearInterval(tick);
        if (!multiState) {
          hideCountdown();
          return;
        }
        $('countdown-num').textContent = 'GO!';
        punchCountdown();
        goTimer = setTimeout(function () {
          goTimer = null;
          hideCountdown();
          if (!multiState) return;
          multiState.phase = 'playing';
          current = 0;
          correct = 0;
          total = 0;
          qShownAt = 0;
          locked = false;
          nextQuestion();
        }, GO_MS);
      } else {
        const n = Math.min(3, Math.ceil(left / 1000));
        const txt = String(Math.max(1, n));
        if ($('countdown-num').textContent !== txt) {
          $('countdown-num').textContent = txt;
          punchCountdown();
        }
      }
    }, 100);
  }

  function hideCountdown() {
    const cdOverlay = $('overlay-countdown');
    cdOverlay.classList.add('hidden');
    cdOverlay.hidden = true;
  }

  function startDisconnectGrace() {
    if (!multiState) return;
    if (multiState.phase === 'lobby') return;
    if (disconnectTimer !== null) return;
    if (multiState.phase === 'done') return;

    $('overlay-disconnect').classList.remove('hidden');
    $('overlay-disconnect').hidden = false;
    let n = DISCONNECT_GRACE_MS;
    $('disconnect-count').textContent = String(n);
    disconnectTimer = setInterval(function () {
      n -= 1;
      $('disconnect-count').textContent = String(Math.max(0, n));
      if (n <= 0) {
        clearDisconnect();
        enterMultiSetup(); // re-rolls an unsaved random name
        showMultiError('Room closed.');
      }
    }, 1000);
  }

  function cleanupMulti() {
    multiState = null;
    clearTimer();
    clearJoinTimer();
    clearRejoin();
    hideRetryJoin();
    hideRetryHost();
    clearGo();
    clearGrace();
    clearDisconnect();
    hidePeerAlert();
    multi.leave();
    locked = false;
    hideCountdown();
    $('multi-bars').classList.add('hidden');
    $('btn-leave-1v1').hidden = true;
  }

  function enterQr(url) {
    const target = url || window.location.href;
    const img = $('qr-img');
    if (img) {
      img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=10&data='
        + encodeURIComponent(target);
    }
    const label = $('qr-url');
    if (label) label.textContent = target;
    showScreen('qr');
  }

  function enterRoomQr() {
    if (!multiState || !multiState.code) return;
    const link = inviteLink(multiState.code);
    if (!link) return;
    qrReturn = 'multi-wait';
    enterQr(link);
  }

  function enterMultiSetup() {
    cleanupMulti();    clearMultiError();
    $('multi-code').value = '';
    const hostHardBox = $('host-hard');
    if (hostHardBox) hostHardBox.checked = loadHard();
    const nameInp = $('player-name');
    if (nameInp) nameInp.value = namesApi.loadCustom() || namesApi.randomName();
    nameEdited = false;
    if ($('multi-q-count')) $('multi-q-count').value = String(hostQuestionCount);
    const disp = $('q-display');
    if (disp) disp.textContent = String(hostQuestionCount);
    showScreen('multi-setup');
  }

  function enterMultiWait(role) {
    clearMultiError();
    clearJoinTimer();
    hideRetryJoin();
    hideRetryHost();
    resetMultiState(role);
    multiState.phase = 'lobby';
    $('ready-badge').classList.add('hidden');
    $('ready-badge').hidden = true;
    $('btn-ready').hidden = true;
    $('btn-ready').disabled = false;
    $('btn-ready').textContent = 'I\'m Ready ✓';
    showScreen('multi-wait');
    updateReadyUI();
  }

  function bindMultiEvents() {
    multi.on('room-ready', function (code) {
      if (!multiState) {
        resetMultiState('host');
      }
      hideRetryHost();
      clearMultiError();
      multiState.role = 'host';
      multiState.me = 'host';
      multiState.code = code;
      multiState.phase = 'lobby';
      multiState.connOpen = true;
      if (multiState.myName) {
        partyApi.addPlayer(multiState.party, 'host', multiState.myName);
      }
      // do not overwrite pendingCount - it was locked at Create
      if (!multiState.pendingCount) {
        const c = hostQuestionCount > 0 ? hostQuestionCount : readHostCount();
        hostQuestionCount = c;
        multiState.pendingCount = c;
      }
      multiState.limit = multiState.pendingCount;
      multiState.reclaiming = false;
      multiState.reclaimTries = 0;
      saveRoomTicket({ role: 'host', code: code, name: multiState.myName, typed: multiState.typedName, rounds: multiState.pendingCount, grace: multiState.graceSec, hard: hostHard });
      if ($('multi-q-count')) $('multi-q-count').value = String(multiState.pendingCount);
      const disp = $('q-display');
      if (disp) disp.textContent = String(multiState.pendingCount);
      $('room-code').textContent = code;
      const hInp = $('host-name');
      if (hInp) hInp.value = multiState.myName || '';
      $('wait-host').classList.remove('hidden');
      $('wait-guest').classList.add('hidden');
      showScreen('multi-wait');
      updateReadyUI();
    });

    multi.on('connected', function () {
      if (!multiState || multiState.role !== 'guest') return;
      multiState.connOpen = true;
      multi.send({ type: 'hello', name: multiState.myName });
      updateReadyUI();
    });

    multi.on('hello', function (data) {
      if (!multiState || multiState.role !== 'host') return;
      const from = data && data.from;
      if (!from || multiState.party.players[from]) {
        broadcastRoster();
        updateReadyUI();
        return;
      }
      if (multiState.phase !== 'lobby') {
        multi.sendTo(from, { type: 'error', error: 'room-started' });
        multi.drop(from);
        return;
      }
      if (partyApi.size(multiState.party) >= partyApi.MAX_PLAYERS) {
        multi.sendTo(from, { type: 'error', error: 'room-full' });
        multi.drop(from);
        return;
      }
      const finalName = namesApi.uniqueName(data.name, partyApi.names(multiState.party));
      partyApi.addPlayer(multiState.party, from, finalName);
      multi.sendTo(from, { type: 'welcome', id: from, name: finalName });
      broadcastRoster();
      updateReadyUI();
    });

    multi.on('welcome', function (data) {
      if (!multiState || multiState.role !== 'guest') return;
      clearJoinTimer();
      clearRejoin();
      hideRetryJoin();
      multiState.me = data.id;
      partyApi.addPlayer(multiState.party, data.id, data.name);
      saveRoomTicket({ role: 'guest', code: multiState.code, name: data.name, typed: multiState.typedName, rounds: multiState.pendingCount, grace: multiState.graceSec, hard: false });
      if (multiState.typedName) namesApi.saveCustom(data.name);
      // Joined via invite link: drop ?room= so a refresh lands on plain
      // home instead of silently rejoining as a duplicate guest.
      try {
        if (window.location.search.indexOf('room=') !== -1) {
          window.history.replaceState(null, '', window.location.pathname + window.location.hash);
        }
      } catch (e) {}
      const inp = $('player-name');
      if (inp) inp.value = data.name;
      const gInp = $('guest-name');
      if (gInp) gInp.value = data.name;
    });

    multi.on('roster', function (data) {
      if (!multiState || multiState.role !== 'guest') return;
      clearJoinTimer();
      hideRetryJoin();
      partyApi.syncRoster(multiState.party, data.players);
      if (Number.isFinite(Number(data.rounds))) {
        multiState.pendingCount = Math.max(1, Math.min(500, Number(data.rounds)));
      }
      // Adopt a host-confirmed rename: the roster echo is the source of
      // truth (it may carry an auto-suffixed variant on collision).
      const me = multiState.me && multiState.party.players[multiState.me];
      if (me && me.name && me.name !== multiState.myName) {
        multiState.myName = me.name;
        const gInp = $('guest-name');
        if (gInp && document.activeElement !== gInp) gInp.value = me.name;
        if (multiState.renamePending) {
          multiState.renamePending = false;
          namesApi.saveCustom(me.name);
        }
      }
      if (multiState.phase === 'lobby') updateReadyUI();
      else {
        renderBars();
        maybeEndMulti();
      }
    });

    multi.on('ready', function (data) {
      if (!multiState || multiState.role !== 'host') return;
      const r = !data || data.ready !== false;
      partyApi.setReady(multiState.party, data.from, r);
      broadcastRoster();
      updateReadyUI();
      if (r) maybeStartCountdown();
    });

    // Lobby rename (host's own Save button and guests' rename messages share
    // this). Host dedupes against everyone else; guests learn the final name
    // from the next roster broadcast. Locked once the match starts.
    function applyRename(id, want) {
      if (!multiState || multiState.phase !== 'lobby') return null;
      if (!id || !multiState.party.players[id]) return null;
      want = String(want == null ? '' : want).trim().slice(0, 20);
      if (!want) return null;
      const ids = Object.keys(multiState.party.players);
      const taken = [];
      for (let i = 0; i < ids.length; i++) {
        if (ids[i] !== id) taken.push(multiState.party.players[ids[i]].name);
      }
      if (!partyApi.setName(multiState.party, id, namesApi.uniqueName(want, taken))) return null;
      return multiState.party.players[id].name;
    }

    multi.on('rename', function (data) {
      if (!multiState || multiState.role !== 'host') return;
      if (!applyRename(data && data.from, data && data.name)) return;
      broadcastRoster();
      updateReadyUI();
    });

    multi.on('begin', function (data) {
      if (!multiState || multiState.role !== 'guest') return;
      multiState.questions = data.questions || [];
      multiState.limit = multiState.questions.length;
      if (Number.isFinite(Number(data.count))) {
        multiState.pendingCount = Math.max(1, Math.min(500, Number(data.count)));
      }
      multiState.graceSec = Number.isFinite(Number(data.grace)) ? Math.max(0, Math.min(10, Number(data.grace))) : 3;
      beginCountdown();
    });

    multi.on('answered', function (data) {
      if (!multiState) return;
      const from = data && data.from;
      if (!from || from === multiState.me) return;
      if (multiState.phase === 'lobby' || multiState.phase === 'done') return;
      multi.relay(data, from); // host fans out; guests have a single conn so this is a no-op for them
      if (!partyApi.applyAnswered(multiState.party, from, data)) return;
      renderBars();
      maybeStartAnswerGrace(data); // gates on phase + index internally
      maybeEndMulti();
    });

    multi.on('left', function (data) {
      if (!multiState) return;
      const from = data && data.from;
      if (from === 'host' && multiState.role === 'guest') {
        if (multiState.phase === 'lobby') {
          startHostWatch('Room closed. Waiting for host…');
          return;
        }
        enterMultiSetup(); // re-rolls an unsaved random name
        showMultiError('Room closed.');
        return;
      }
      if (multiState.role !== 'host') return;
      multi.drop(from);
      if (partyApi.removePlayer(multiState.party, from)) {
        broadcastRoster();
        if (multiState.phase === 'lobby') updateReadyUI();
        else {
          renderBars();
          maybeEndMulti();
        }
      }
    });

    multi.on('peer-closed', function (peerId) {
      if (!multiState) return;
      if (multiState.role === 'host') {
        multi.drop(peerId);
        if (partyApi.removePlayer(multiState.party, peerId)) {
          broadcastRoster();
          if (multiState.phase === 'lobby') updateReadyUI();
          else {
            renderBars();
            maybeEndMulti();
          }
        }
        return;
      }
      if (multiState.phase === 'lobby') {
        startHostWatch('Connection lost. Waiting for host…');
        return;
      }
      startDisconnectGrace();
    });

    multi.on('error', function (type) {
      if (type && typeof type === 'object') {
        const code = type.error;
        const msg = code === 'room-started'
          ? 'Game already started. Ask the host for a new room.'
          : code === 'room-full'
            ? 'Room is full. Ask the host for a new room.'
            : 'Connection error: ' + (code || 'unknown');
        enterMultiSetup(); // re-rolls an unsaved random name
        showMultiError(msg);
        return;
      }
      const map = {
        'unavailable-id': 'Room code already in use. Tap Cancel and create again.',
        'peer-unavailable': 'Room not found. Check the code and try again.',
        'invalid-code': 'Enter a 6-character room code.',
        'PeerJS not loaded': 'Multiplayer failed to load. Check network.',
        network: 'Network error talking to multiplayer service. Check connection.',
        'server-error': 'Multiplayer service error. Wait a moment and retry.',
        'socket-error': 'Socket error. Check connection and retry.',
        'socket-closed': 'Connection closed. Retry or check network.',
      };
      const msg = map[type] || 'Connection error: ' + (type || 'unknown');
      if (multiState && multiState.role === 'host' && multiState.phase === 'lobby') {
        // Reclaim race: broker still holds the dead tab's id. Back off and
        // retry the same code; it frees within seconds.
        if (multiState.reclaiming && type === 'unavailable-id' && multiState.reclaimTries < RECLAIM_TRIES) {
          multiState.reclaimTries += 1;
          $('wait-status').textContent = 'Room code busy (old session clearing)… retry ' + multiState.reclaimTries + ' of ' + RECLAIM_TRIES;
          setTimeout(function () {
            if (!multiState || multiState.role !== 'host' || !multiState.reclaiming) return;
            multi.createRoom(multiState.code);
          }, RECLAIM_DELAY_MS);
          return;
        }
        multiState.reclaiming = false;
        if (multiState.reclaimTries > 0) clearRoomTicket(); // stale ticket: don't loop reclaim on next refresh
        showMultiError(msg + ' Tap Retry for a fresh code, then share again.');
        try {
          if (multi.peer) multi.peer.destroy();
        } catch (e) {}
        multi.peer = null;
        multi.conn = null;
        multiState.connOpen = false;
        showRetryHost();
        updateReadyUI();
        return;
      }
      if (multiState && multiState.phase === 'lobby' && multiState.role === 'guest') {
        if (rejoinTimer !== null) return; // host-watch ping: loop retries, stay quiet
        enterMultiSetup(); // re-rolls an unsaved random name
        showMultiError(msg);
        return;
      }
      showMultiError(msg);
    });
  }

  function nudgeLobbyRounds(delta) {
    if (!multiState || multiState.role !== 'host' || multiState.phase !== 'lobby') return;
    const base = multiState.pendingCount > 0 ? multiState.pendingCount : (hostQuestionCount || 10);
    const c = Math.max(1, Math.min(500, base + delta));
    hostQuestionCount = c;
    multiState.pendingCount = c;
    multiState.limit = c;
    broadcastRoster();
    updateReadyUI();
  }

  // forced ({name, typed}) restores the confirmed pre-refresh identity.
  function joinWithCode(raw, forced) {
    clearMultiError();
    const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const codeInput = $('multi-code');
    if (codeInput) codeInput.value = code;
    if (code.length !== 6) {
      showMultiError('Enter the 6-letter room code.');
      return false;
    }
    const resolved = forced && forced.name
      ? { name: String(forced.name).slice(0, 20), typed: !!forced.typed }
      : resolveName();
    enterMultiWait('guest');
    multiState.code = code; // keep the typed code for the wait display (+ rematch)
    multiState.myName = resolved.name;
    multiState.typedName = resolved.typed;
    if (forced) {
      const inp = $('player-name');
      if (inp) inp.value = resolved.name;
      const gInp = $('guest-name');
      if (gInp) gInp.value = resolved.name;
    }
    $('wait-status-guest').textContent = 'Connecting…';
    multi.joinRoom(code);
    startJoinTimer();
    return true;
  }

  function sendGuestRename() {
    if (!multiState || multiState.role !== 'guest' || multiState.phase !== 'lobby') return;
    if (!multiState.connOpen) {
      showMultiError('Not connected yet.');
      return;
    }
    const inp = $('guest-name');
    const v = inp ? inp.value.trim().slice(0, 20) : '';
    if (!v) {
      showMultiError('Type a name first.');
      return;
    }
    multiState.renamePending = true;
    multi.send({ type: 'rename', name: v });
  }

  function sendHostRename() {
    if (!multiState || multiState.role !== 'host') return;
    const inp = $('host-name');
    const final = applyRename('host', inp ? inp.value : '');
    if (!final) {
      showMultiError('Type a name first.');
      return;
    }
    multiState.myName = final;
    namesApi.saveCustom(final);
    if (inp) inp.value = final;
    broadcastRoster();
    updateReadyUI();
  }


  // expose for cross-file bare-call resolution (same logic, shared globals)
  globalThis.renderBars = renderBars; G.renderBars = renderBars;
  globalThis.commitMultiAnswer = commitMultiAnswer; G.commitMultiAnswer = commitMultiAnswer;
  globalThis.graceTotalMs = graceTotalMs; G.graceTotalMs = graceTotalMs;
  globalThis.maybeStartAnswerGrace = maybeStartAnswerGrace; G.maybeStartAnswerGrace = maybeStartAnswerGrace;
  globalThis.forceBlank = forceBlank; G.forceBlank = forceBlank;
  globalThis.finishLocalQuestions = finishLocalQuestions; G.finishLocalQuestions = finishLocalQuestions;
  globalThis.maybeEndMulti = maybeEndMulti; G.maybeEndMulti = maybeEndMulti;
  globalThis.showStandings = showStandings; G.showStandings = showStandings;
  globalThis.endMulti = endMulti; G.endMulti = endMulti;
  globalThis.resetMultiState = resetMultiState; G.resetMultiState = resetMultiState;
  globalThis.resetForRematch = resetForRematch; G.resetForRematch = resetForRematch;
  globalThis.showMultiError = showMultiError; G.showMultiError = showMultiError;
  globalThis.clearMultiError = clearMultiError; G.clearMultiError = clearMultiError;
  globalThis.renderRoom = renderRoom; G.renderRoom = renderRoom;
  globalThis.broadcastRoster = broadcastRoster; G.broadcastRoster = broadcastRoster;
  globalThis.refreshRoster = refreshRoster; G.refreshRoster = refreshRoster;
  globalThis.updateReadyUI = updateReadyUI; G.updateReadyUI = updateReadyUI;
  globalThis.resolveName = resolveName; G.resolveName = resolveName;
  globalThis.maybeStartCountdown = maybeStartCountdown; G.maybeStartCountdown = maybeStartCountdown;
  globalThis.someoneAhead = someoneAhead; G.someoneAhead = someoneAhead;
  globalThis.punchCountdown = punchCountdown; G.punchCountdown = punchCountdown;
  globalThis.beginCountdown = beginCountdown; G.beginCountdown = beginCountdown;
  globalThis.hideCountdown = hideCountdown; G.hideCountdown = hideCountdown;
  globalThis.startDisconnectGrace = startDisconnectGrace; G.startDisconnectGrace = startDisconnectGrace;
  globalThis.cleanupMulti = cleanupMulti; G.cleanupMulti = cleanupMulti;
  globalThis.enterQr = enterQr; G.enterQr = enterQr;
  globalThis.enterRoomQr = enterRoomQr; G.enterRoomQr = enterRoomQr;
  globalThis.enterMultiSetup = enterMultiSetup; G.enterMultiSetup = enterMultiSetup;
  globalThis.enterMultiWait = enterMultiWait; G.enterMultiWait = enterMultiWait;
  globalThis.bindMultiEvents = bindMultiEvents; G.bindMultiEvents = bindMultiEvents;
  globalThis.nudgeLobbyRounds = nudgeLobbyRounds; G.nudgeLobbyRounds = nudgeLobbyRounds;
  globalThis.joinWithCode = joinWithCode; G.joinWithCode = joinWithCode;
  globalThis.sendGuestRename = sendGuestRename; G.sendGuestRename = sendGuestRename;
  globalThis.sendHostRename = sendHostRename; G.sendHostRename = sendHostRename;
  globalThis.clearRejoin = clearRejoin; G.clearRejoin = clearRejoin;
  globalThis.reclaimHostRoom = reclaimHostRoom; G.reclaimHostRoom = reclaimHostRoom;
  globalThis.reclaimGuestRoom = reclaimGuestRoom; G.reclaimGuestRoom = reclaimGuestRoom;
  globalThis.startHostWatch = startHostWatch; G.startHostWatch = startHostWatch;
