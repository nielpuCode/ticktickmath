// ponytail: solo flow + question render. Ceiling: shares globals with multi core, no isolated store.
// Upgrade path: pull shared state into game-state S object if globals get noisy.
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
  function showScreen(name) {
    for (let i = 0; i < SCREENS.length; i++) {
      const screen = SCREENS[i];
      const el = $('screen-' + screen);
      const on = screen === name;
      el.classList.toggle('hidden', !on);
      el.classList.toggle('flex', on);
      if (on) el.removeAttribute('hidden');
      else el.setAttribute('hidden', '');
    }
  }

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function clearDisconnect() {
    if (disconnectTimer !== null) {
      clearInterval(disconnectTimer);
      disconnectTimer = null;
    }
    $('overlay-disconnect').classList.add('hidden');
    $('overlay-disconnect').hidden = true;
  }

  function clearGo() {
    if (goTimer !== null) {
      clearTimeout(goTimer);
      goTimer = null;
    }
  }

  function clearGrace() {
    if (graceTimer !== null) {
      clearInterval(graceTimer);
      graceTimer = null;
    }
  }

function hidePeerAlert() {
    const el = $('peer-alert');
    if (el) {
      el.classList.add('hidden');
      el.hidden = true; // <--- ADD THIS
    }
    const eq = $('equation');
    if (eq) eq.style.boxShadow = '';
  }

  function showPeerAlert(name, seconds) {
    const el = $('peer-alert');
    if (!el) return;
    $('peer-alert-text').textContent = name + ' answered, hurry!';
    $('peer-alert-num').textContent = String(seconds);
    const fill = $('peer-alert-fill');
    if (fill) fill.style.width = '100%';
    
    el.classList.remove('hidden');
    el.hidden = false; // <--- ADD THIS
    
    const eq = $('equation');
    if (eq) eq.style.boxShadow = '0 0 0 2px rgba(251,191,36,.8), 0 0 28px rgba(251,191,36,.35)';
  }

  function buildQuestions(n) {
    const list = [];
    const diff = hostHard ? 'hard' : 'normal';
    for (let i = 0; i < n; i++) {
      const p = generateProblem(gameLang(), diff);
      list.push({
        a: p.a,
        b: p.b,
        op: p.op,
        answer: p.answer,
        choices: generateChoices(p),
        text: p.text,
        sub: p.sub,
        fmt: p.fmt,
      });
    }
    return list;
  }

  function updateLive() {
    if (multiState) {
      if (multiState.phase === 'waiting-players') {
        $('live-score').textContent = 'Waiting for others…';
        return;
      }
      if (multiState.phase === 'playing') {
        const lim = multiState.limit || multiState.questions.length || 0;
        $('live-score').textContent = 'Q ' + Math.min(current + 1, lim) + ' / ' + lim;
        return;
      }
    }
    if (mode === 'infinite') {
      $('live-score').textContent = '✓ ' + correct + '  /  ' + total;
    } else {
      const n = Math.min(current + 1, limit);
      const left = Math.max(0, limit - n);
      $('live-score').textContent = 'Q ' + n + ' / ' + limit + (left > 0 ? ' · ' + left + ' left' : ' · last one!');
    }
  }

  function renderEquation(problem) {
    const eq = $('equation');
    eq.classList.remove('anim-rise');
    void eq.offsetWidth;
    eq.classList.add('anim-rise');
    if (problem.text) {
      eq.replaceChildren();
      const main = document.createElement('div');
      main.className = 'text-slate-100';
      main.innerHTML = paintStoryOps(problem.text);
      eq.appendChild(main);
      fitEquation(eq);
      return;
    }
    eq.innerHTML =
      '<span class="text-slate-100">' + problem.a + '</span>' +
      ' <span class="' + (OP_CLASS[problem.op] || '') + '">' + problem.op + '</span> ' +
      '<span class="text-slate-100">' + problem.b + '</span>' +
      ' <span class="text-slate-500">=</span>';
    fitEquation(eq);
  }

  function renderChoices(problem, choiceList) {
    const list = choiceList || problem.choices || generateChoices(problem);
    const box = $('choices');
    box.classList.remove('anim-shake');
    box.replaceChildren();
    for (let i = 0; i < list.length; i++) {
      const value = list[i];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.value = String(value); // raw number: textContent may be locale-formatted
      btn.textContent = problem.fmt && gen.fmt ? gen.fmt(value, problem.fmt) : String(value);
      // Replace this line inside renderChoices:
btn.className =
  'choice-btn col-span-2 flex min-h-20 sm:min-h-24 md:min-h-28 items-center justify-center rounded-2xl border-4 border-[#12100E] bg-[#161D27] p-2 sm:p-4 text-[clamp(1.1rem,2.8vw,2rem)] font-black tabular-nums text-[#FFF7EB] shadow-[0_5px_0_#12100E] transition hover:bg-[#0D1117] active:translate-y-1 active:shadow-[0_1px_0_#12100E] disabled:cursor-default disabled:hover:bg-[#161D27]';
      if (i === 3) btn.classList.add('col-start-2');
      if (i === 4) btn.classList.add('col-start-4');
      btn.addEventListener('click', function () {
        onAnswer(btn, value, problem);
      });
      box.appendChild(btn);
    }
  }

  function fitEquation(eq) {
    if (!eq || !eq.clientWidth) return;
    eq.style.fontSize = '';
    let size = parseFloat(window.getComputedStyle(eq).fontSize) || 44;
    let guard = 12;
    while (eq.scrollWidth > eq.clientWidth && size > 20 && guard-- > 0) {
      size -= 2;
      eq.style.fontSize = size + 'px';
    }
  }

  function nextQuestion() {
    locked = false;
    clearGrace();
    hidePeerAlert();

    if (multiState) {
      if (current >= multiState.questions.length) {
        finishLocalQuestions();
        return;
      }
      const problem = multiState.questions[current];
      renderEquation(problem);
      renderChoices(problem);
      qShownAt = Date.now();
      updateLive();
      renderBars();
      if (multiState.pendingGrace) {
        const pg = multiState.pendingGrace;
        multiState.pendingGrace = null;
        if (pg.index === current) maybeStartAnswerGrace(pg);
      } else {
        // A rival may have answered this question while I was behind
        // (slow start, feedback lock): no new message will come, so check now.
        const ahead = someoneAhead();
        if (ahead) maybeStartAnswerGrace({ index: current, from: ahead.id });
      }
      return;
    }

    if (mode === 'fixed' && current >= limit) {
      endGame();
      return;
    }

    const problem = generateProblem(gameLang(), soloHard ? 'hard' : 'normal');
    renderEquation(problem);
    renderChoices(problem);
    updateLive();
  }

  function paintChoices(problem, value) {
    const ok = value === problem.answer;
    const nodes = $('choices').querySelectorAll('button');
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      node.disabled = true;
      if (Number(node.dataset.value) === problem.answer) {
        node.classList.add('anim-pop', 'flash-right');
      } else {
        node.classList.add('flash-dim');
      }
    }
    if (value === null) {
      $('choices').classList.add('anim-shake');
      return ok;
    }
    if (!ok) {
      const picked = Array.prototype.filter.call(nodes, function (node) {
        return Number(node.dataset.value) === value;
      })[0];
      if (picked) {
        picked.classList.remove('flash-dim');
        picked.classList.add('anim-shake', 'flash-wrong');
      }
    }
    return ok;
  }

  function onAnswer(btn, value, problem) {
    if (locked) return;
    locked = true;
    clearTimer();
    clearGrace();

    total += 1;
    current += 1;
    const ok = value === problem.answer;
    if (ok) correct += 1;
    paintChoices(problem, value);

    if (multiState) {
      commitMultiAnswer(ok, false);
      return;
    }

    updateLive();
    timer = setTimeout(function () {
      timer = null;
      if (mode === 'fixed' && current >= limit) endGame();
      else nextQuestion();
    }, FEEDBACK_MS);
  }

  function startGame() {
    clearTimer();
    clearDisconnect();
    multiState = null;
    mode = $('q-infinite').checked ? 'infinite' : 'fixed';
    soloHard = !!($('q-hard') && $('q-hard').checked);
    limit = clampCount($('q-count').value, 1, 500, 20);
    $('q-count').value = String(limit);
    current = 0;
    correct = 0;
    total = 0;
    locked = false;
    showSoloPlayChrome(mode === 'infinite');
    showScreen('play');
    nextQuestion();
  }

  function endGame() {
    clearTimer();
    locked = true;
    multiState = null;
    const pct = total === 0 ? 0 : Math.round((correct / total) * 100);
    $('result-score').textContent = correct + ' / ' + total;
    $('result-detail').textContent = pct + '%' + (mode === 'infinite' ? ' · stopped early' : '');
    showScreen('result');
  }

  function showMultiPlayChrome() {
    $('play-meta').classList.remove('hidden');
    $('play-meta').classList.add('flex');
    $('btn-stop').hidden = true;
    $('btn-leave-1v1').hidden = false;
    $('multi-bars').classList.remove('hidden');
    renderBars();
  }

  function showSoloPlayChrome(infinite) {
    $('multi-bars').classList.add('hidden');
    $('btn-leave-1v1').hidden = true;
    // The meta bar carries the Q-progress pill: always visible in solo,
    // only the Give Up button stays infinite-only.
    $('play-meta').classList.remove('hidden');
    $('play-meta').classList.add('flex');
    $('btn-stop').hidden = !infinite;
  }


  // expose for cross-file bare-call resolution (same logic, shared globals)
  globalThis.showScreen = showScreen; G.showScreen = showScreen;
  globalThis.clearTimer = clearTimer; G.clearTimer = clearTimer;
  globalThis.clearDisconnect = clearDisconnect; G.clearDisconnect = clearDisconnect;
  globalThis.clearGo = clearGo; G.clearGo = clearGo;
  globalThis.clearGrace = clearGrace; G.clearGrace = clearGrace;
  globalThis.hidePeerAlert = hidePeerAlert; G.hidePeerAlert = hidePeerAlert;
  globalThis.showPeerAlert = showPeerAlert; G.showPeerAlert = showPeerAlert;
  globalThis.buildQuestions = buildQuestions; G.buildQuestions = buildQuestions;
  globalThis.updateLive = updateLive; G.updateLive = updateLive;
  globalThis.renderEquation = renderEquation; G.renderEquation = renderEquation;
  globalThis.renderChoices = renderChoices; G.renderChoices = renderChoices;
  globalThis.fitEquation = fitEquation; G.fitEquation = fitEquation;
  globalThis.nextQuestion = nextQuestion; G.nextQuestion = nextQuestion;
  globalThis.paintChoices = paintChoices; G.paintChoices = paintChoices;
  globalThis.onAnswer = onAnswer; G.onAnswer = onAnswer;
  globalThis.startGame = startGame; G.startGame = startGame;
  globalThis.endGame = endGame; G.endGame = endGame;
  globalThis.showMultiPlayChrome = showMultiPlayChrome; G.showMultiPlayChrome = showMultiPlayChrome;
  globalThis.showSoloPlayChrome = showSoloPlayChrome; G.showSoloPlayChrome = showSoloPlayChrome;
