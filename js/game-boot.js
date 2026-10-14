// ponytail: wiring only - event bindings + init. Ceiling: no lazy screen loading.
// Upgrade path: split bindings per screen if boot grows past ~300 lines.
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
  function bindCopyCode(btnId, codeElId) {
    const btn = $(btnId);
    if (!btn) return;
    const label = btn.textContent; // restore each button's own wording afterwards
    btn.addEventListener('click', function () {
      const codeEl = $(codeElId);
      const code = (codeEl && codeEl.textContent ? codeEl.textContent : '').trim();
      if (!code || code === '------') {
        showMultiError('Room code not ready yet.');
        return;
      }
      // Invite links: system share sheet where present (mobile stays in tab,
      // room stays alive), clipboard copy as fallback.
      if (codeElId.indexOf('invite-link') !== -1 && navigator.share) {
        navigator.share({ url: code, title: 'TickTickMath room' }).then(function () {
          btn.textContent = 'Shared ✓';
          setTimeout(function () {
            btn.textContent = label;
          }, 1200);
        }).catch(function (err) {
          if (err && err.name === 'AbortError') return;
          copyText(code).then(function () {
            btn.textContent = 'Copied ✓';
            setTimeout(function () {
              btn.textContent = label;
            }, 1200);
          }).catch(function () {
            btn.textContent = 'Select code';
            setTimeout(function () {
              btn.textContent = label;
            }, 2000);
          });
        });
        return;
      }
      if (codeEl) {
        const range = document.createRange();
        range.selectNodeContents(codeEl);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
      copyText(code).then(function () {
        btn.textContent = 'Copied ✓';
        setTimeout(function () {
          btn.textContent = label;
        }, 1200);
      }).catch(function () {
        btn.textContent = 'Select code';
        setTimeout(function () {
          btn.textContent = label;
        }, 2000);
      });
    });
  }

  $('q-infinite').addEventListener('change', function () {
    $('q-count').disabled = $('q-infinite').checked;
  });

  const hardBox = $('q-hard');
  if (hardBox) hardBox.addEventListener('change', function () {
    saveHard(hardBox.checked);
  });
  const hostHardBox = $('host-hard');
  if (hostHardBox) hostHardBox.addEventListener('change', function () {
    saveHard(hostHardBox.checked);
  });

  $('btn-play').addEventListener('click', startGame);
  $('btn-again').addEventListener('click', startGame);

  const langIdBtn = $('lang-id');
  const langEnBtn = $('lang-en');
  if (langIdBtn) langIdBtn.addEventListener('click', function () { applyLang('id'); });
  if (langEnBtn) langEnBtn.addEventListener('click', function () { applyLang('en'); });
  $('btn-stop').addEventListener('click', endGame);
  $('btn-home').addEventListener('click', function () {
    cleanupMulti();
    showScreen('home');
  });
  $('btn-1v1-home').addEventListener('click', function () {
    if (multiState && multiState.role === 'host') multi.send({ type: 'left', from: 'host' });
    cleanupMulti();
    clearRoomTicket();
    showScreen('home');
  });

  $('btn-1v1-rematch').addEventListener('click', function () {
    resetForRematch();
  });

  $('btn-multi').addEventListener('click', enterMultiSetup);
  $('btn-howto').addEventListener('click', function () {
    showScreen('tutorial');
  });
  $('btn-tutorial-back').addEventListener('click', function () {
    showScreen('home');
  });
  $('btn-qr').addEventListener('click', function () {
    qrReturn = 'home';
    enterQr();
  });
  $('btn-qr-back').addEventListener('click', function () {
    if (qrReturn === 'multi-wait' && !multiState) qrReturn = 'home'; // room died while QR open
    showScreen(qrReturn);
    qrReturn = 'home';
  });
  $('btn-multi-back').addEventListener('click', function () {
    cleanupMulti();
    clearRoomTicket();
    showScreen('home');
  });

  $('btn-create-room').addEventListener('click', function () {
    clearMultiError();
    const count = readHostCount();
    hostQuestionCount = count;
    if ($('multi-q-count')) $('multi-q-count').value = String(count);
    const disp = $('q-display');
    if (disp) disp.textContent = String(count);
    const resolved = resolveName();
    enterMultiWait('host');
    multiState.myName = resolved.name;
    multiState.typedName = resolved.typed;
    hostHard = !!($('host-hard') && $('host-hard').checked); // locked like the question count
    partyApi.addPlayer(multiState.party, 'host', resolved.name);
    multiState.me = 'host';
    multiState.pendingCount = count;
    multiState.limit = count;
    multiState.graceSec = readGraceDur();
    setGraceDur(multiState.graceSec);
    $('wait-status').textContent = 'Creating room… (' + count + ' questions)';
    updateReadyUI();
    multi.createRoom();
  });

  const multiCountInput = $('multi-q-count');
  if (multiCountInput) {
    multiCountInput.addEventListener('change', function () {
      const c = readHostCount();
      hostQuestionCount = c;
      this.value = String(c);
      const disp = $('q-display');
      if (disp) disp.textContent = String(c);
      if (multiState && multiState.role === 'host' && multiState.phase === 'lobby') {
        multiState.pendingCount = c;
        multiState.limit = c;
        broadcastRoster();
        updateReadyUI();
      }
    });
  }

  const qMinus = $('q-minus');
  const qPlus = $('q-plus');
  const qDisplay = $('q-display');
  if (qMinus && qPlus) {
    qMinus.addEventListener('click', function () {
      const c = Math.max(1, (hostQuestionCount || readHostCount()) - 1);
      setHostCount(c);
      if (multiState && multiState.role === 'host' && multiState.phase === 'lobby') {
        multiState.pendingCount = c;
        multiState.limit = c;
        broadcastRoster();
        updateReadyUI();
      }
    });
    qPlus.addEventListener('click', function () {
      const c = Math.min(500, (hostQuestionCount || readHostCount()) + 1);
      setHostCount(c);
      if (multiState && multiState.role === 'host' && multiState.phase === 'lobby') {
        multiState.pendingCount = c;
        multiState.limit = c;
        broadcastRoster();
        updateReadyUI();
      }
    });
  }

  // Host rounds stepper inside the live lobby (setup screen is gone mid-room).

  const rMinus = $('r-minus');
  const rPlus = $('r-plus');
  if (rMinus && rPlus) {
    rMinus.addEventListener('click', function () { nudgeLobbyRounds(-1); });
    rPlus.addEventListener('click', function () { nudgeLobbyRounds(1); });
  }

  const graceInput = $('grace-count');
  if (graceInput) {
    graceInput.addEventListener('change', function () {
      const g = readGraceDur();
      setGraceDur(g);
      this.value = String(hostGraceSec);
    });
  }

  const gMinus = $('g-minus');
  const gPlus = $('g-plus');
  if (gMinus && gPlus) {
    gMinus.addEventListener('click', function () {
      setGraceDur((Number.isFinite(hostGraceSec) ? hostGraceSec : readGraceDur()) - 1);
    });
    gPlus.addEventListener('click', function () {
      setGraceDur((Number.isFinite(hostGraceSec) ? hostGraceSec : readGraceDur()) + 1);
    });
  }

  // Single guest-join path for typed codes and invite links alike.

  $('btn-join-room').addEventListener('click', function () {
    joinWithCode($('multi-code').value);
  });

  const nameInput = $('player-name');
  if (nameInput) {
    nameInput.addEventListener('change', function () {
      const v = this.value.trim().slice(0, 20);
      this.value = v;
      nameEdited = v !== '';
      if (v) namesApi.saveCustom(v);
    });
  }

  const rerollBtn = $('btn-reroll-name');
  if (rerollBtn) {
    rerollBtn.addEventListener('click', function () {
      const inp = $('player-name');
      if (!inp) return;
      inp.value = namesApi.randomName();
      nameEdited = false;
    });
  }

  $('multi-code').addEventListener('input', function () {
    this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  });

  bindCopyCode('btn-copy-code', 'room-code');
  bindCopyCode('btn-copy-code-guest', 'room-code-guest');
  bindCopyCode('btn-copy-link-host', 'invite-link-host');
  bindCopyCode('btn-copy-link-guest', 'invite-link-guest');
  const qrHostBtn = $('btn-qr-host');
  if (qrHostBtn) qrHostBtn.addEventListener('click', enterRoomQr);
  const qrGuestBtn = $('btn-qr-guest');
  if (qrGuestBtn) qrGuestBtn.addEventListener('click', enterRoomQr);
  const refreshBtn = $('btn-refresh-roster');
  if (refreshBtn) refreshBtn.addEventListener('click', refreshRoster);
  const retryJoinBtn = $('btn-retry-join');
  if (retryJoinBtn) retryJoinBtn.addEventListener('click', function () {
    if (!multiState || multiState.role !== 'guest') return;
    joinWithCode(multiState.code || ($('multi-code') && $('multi-code').value) || '');
  });
  const retryHostBtn = $('btn-retry-host');
  if (retryHostBtn) retryHostBtn.addEventListener('click', function () {
    if (!multiState || multiState.role !== 'host' || multiState.phase !== 'lobby') return;
    clearMultiError();
    hideRetryHost();
    $('wait-status').textContent = 'Creating room…';
    updateReadyUI();
    multi.createRoom();
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refreshRoster();
  });
  window.addEventListener('online', function () {
    refreshRoster();
  });
  // Accidental-refresh guard: prompt only while inside a live room.
  window.addEventListener('beforeunload', function (ev) {
    if (multiState && multiState.phase !== 'done') {
      ev.preventDefault();
      ev.returnValue = '';
    }
  });

  $('btn-ready').addEventListener('click', function () {
    if (!multiState || multiState.phase !== 'lobby' || multiState.countdownStarted) return;
    multiState.myReady = !multiState.myReady;
    partyApi.setReady(multiState.party, multiState.me, multiState.myReady);
    if (multiState.role === 'host') {
      broadcastRoster();
      updateReadyUI();
      if (multiState.myReady) maybeStartCountdown();
    } else {
      multi.send({ type: 'ready', ready: multiState.myReady });
      updateReadyUI();
    }
  });

  const hostNameBtn = $('btn-host-name');
  if (hostNameBtn) hostNameBtn.addEventListener('click', sendHostRename);
  const hostNameInp = $('host-name');
  if (hostNameInp) hostNameInp.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      sendHostRename();
    }
  });

  const guestNameBtn = $('btn-guest-name');
  if (guestNameBtn) guestNameBtn.addEventListener('click', sendGuestRename);
  const guestNameInp = $('guest-name');
  if (guestNameInp) guestNameInp.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      sendGuestRename();
    }
  });

  $('btn-cancel-multi').addEventListener('click', function () {
    cleanupMulti();
    clearRoomTicket();
    showScreen('home');
  });

  $('btn-leave-1v1').addEventListener('click', function () {
    const me = multiState ? multiState.me : '';
    multi.send({ type: 'left', from: me || 'host' });
    cleanupMulti();
    clearRoomTicket();
    showScreen('home');
  });

  $('btn-dc-home').addEventListener('click', function () {
    const me = multiState ? multiState.me : '';
    multi.send({ type: 'left', from: me || 'host' });
    cleanupMulti();
    clearRoomTicket();
    showScreen('home');
  });

  bindMultiEvents();

  // init display
  (function () {
    const v = readHostCount();
    hostQuestionCount = v;
    const el = $('multi-q-count');
    if (el) el.value = String(v);
    const disp = $('q-display');
    if (disp) disp.textContent = String(v);
    setGraceDur(loadGraceDur(), false);
    applyLang(loadLang());
    const hardInit = $('q-hard');
    if (hardInit) hardInit.checked = loadHard();
    // Invite-link auto-join: ?room=CODE drops the guest straight into the
    // room with no typing. Failures fall through the normal guest error
    // path (lobby + message), so a dead link can never strand anyone.
    // An explicit invite beats any stale refresh ticket.
    let invited = false;
    try {
      const params = new URLSearchParams(window.location.search);
      const invite = String(params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      if (invite.length === 6) {
        invited = true;
        clearRoomTicket();
        enterMultiSetup();
        joinWithCode(invite);
      }
    } catch (e) {}
    // Refresh recovery: rejoin the same room instead of dying to home.
    // Host reclaims the code (guests re-hello); guests rejoin with their
    // confirmed name. Mid-race refreshes land back in the lobby by design.
    if (!invited) {
      try {
        const ticket = loadRoomTicket();
        if (ticket && ticket.code) {
          if (ticket.role === 'host') reclaimHostRoom(ticket);
          else reclaimGuestRoom(ticket);
        }
      } catch (e) {}
    }
  })();
