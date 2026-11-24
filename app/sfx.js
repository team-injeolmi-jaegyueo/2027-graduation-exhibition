/* PASS 효과음 — Web Audio로 합성(음원 파일 없음). BGM은 따로 틀므로 여기엔 짧은 UI 효과음만.
   사용: SFX.play('click' | 'hover' | 'select' | 'confirm' | 'back' | 'open' | 'close' | 'type' | 'beep' | 'beepGo'
                  | 'shutter' | 'success' | 'fail' | 'tick' | 'timeup' | 'whoosh' | 'intro' | 'fanfare' | 'appear')
   M 키: 효과음 끄기/켜기 (브라우저에 기억). 첫 클릭·키 입력 전에는 브라우저 정책상 소리가 나지 않음. */
(function () {
  const KEY = 'pass-sfx-muted';
  let ctx = null, master = null, muted = false;
  try { muted = localStorage.getItem(KEY) === '1'; } catch (e) {}
  const VOLUME = 0.55;

  function ac() {
    if (ctx) return ctx;
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 4;
    master = ctx.createGain(); master.gain.value = VOLUME;
    master.connect(comp); comp.connect(ctx.destination);
    return ctx;
  }
  // 첫 사용자 입력에서 오디오 잠금 해제
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => addEventListener(ev, () => {
    const c = ac(); if (c && c.state === 'suspended') c.resume();
  }, { capture: true, passive: true }));

  function env(g, t, vol, a, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  // 음 하나: f → f2로 미끄러짐
  function tone({ f, f2 = f, type = 'sine', dur = 0.1, vol = 0.2, a = 0.004, delay = 0, lp = 0 }) {
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2 !== f) o.frequency.exponentialRampToValueAtTime(f2, t + a + dur);
    let node = o;
    if (lp) { const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; o.connect(fl); node = fl; }
    node.connect(g); g.connect(master);
    env(g, t, vol, a, dur);
    o.start(t); o.stop(t + a + dur + 0.05);
  }
  let noiseBuf = null;
  function noise({ f = 1000, f2 = f, q = 1, type = 'bandpass', dur = 0.3, vol = 0.1, a = 0.02, delay = 0 } = {}) {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(f, t); fl.frequency.exponentialRampToValueAtTime(f2, t + a + dur);
    const g = ctx.createGain(); s.connect(fl); fl.connect(g); g.connect(master);
    env(g, t, vol, a, dur);
    s.start(t); s.stop(t + a + dur + 0.05);
  }


  // 깔끔한 디지털 톤: 잔향·저음·쇳소리 없이 짧고 맑은 사인파 '핑'만. 서늘하게 들리도록 증4도 위주
  const ping = (f, o = {}) => tone({ f, dur: 0.04, vol: 0.06, a: 0.002, ...o });
  const SOUNDS = {
    click()   { ping(2600, { dur: 0.022, vol: 0.05 }); },
    hover()   { ping(4200, { dur: 0.01, vol: 0.015 }); },
    select()  { ping(1760, { dur: 0.025, vol: 0.05 }); ping(2490, { dur: 0.04, vol: 0.05, delay: 0.04 }); },
    confirm() { ping(1320, { dur: 0.03, vol: 0.05 }); ping(1867, { dur: 0.03, vol: 0.05, delay: 0.045 }); ping(2640, { dur: 0.09, vol: 0.05, delay: 0.09 }); },
    back()    { ping(2490, { dur: 0.025, vol: 0.045 }); ping(1760, { dur: 0.04, vol: 0.045, delay: 0.04 }); },
    open()    { ping(1500, { f2: 3000, dur: 0.1, vol: 0.035, a: 0.01 }); },
    close()   { ping(3000, { f2: 1500, dur: 0.08, vol: 0.03, a: 0.005 }); },
    type()    { tone({ f: 1800 + Math.random() * 500, type: 'triangle', dur: 0.016, vol: 0.022, a: 0.002 }); },
    beep()    { ping(1568, { dur: 0.07, vol: 0.06 }); },
    beepGo()  { ping(2093, { dur: 0.12, vol: 0.06 }); },
    shutter() { noise({ f: 5000, type: 'highpass', dur: 0.025, vol: 0.12, a: 0.001 }); noise({ f: 5000, type: 'highpass', dur: 0.02, vol: 0.07, a: 0.001, delay: 0.06 }); },
    success() { ping(1760, { dur: 0.04, vol: 0.05 }); ping(2637, { dur: 0.14, vol: 0.05, delay: 0.06 }); },
    fail()    { ping(1245, { dur: 0.05, vol: 0.05 }); ping(880, { dur: 0.14, vol: 0.05, delay: 0.07 }); },
    tick()    { ping(3000, { dur: 0.012, vol: 0.035 }); },
    timeup()  { [0, 0.09, 0.18].forEach(d => ping(1760, { dur: 0.035, vol: 0.05, delay: d })); },
    whoosh()  { ping(1200, { f2: 3200, dur: 0.12, vol: 0.02, a: 0.03 }); },
    intro()   { [1320, 1867, 2640].forEach((f, i) => ping(f, { dur: i === 2 ? 0.25 : 0.04, vol: 0.04, delay: 0.1 + i * 0.12 })); },
    appear()  {   // 캐릭터 등장: 스캔하듯 올라가는 소리 + 반짝이는 점들 → 맑은 두 음으로 '착지'
      ping(700, { f2: 2800, dur: 0.5, vol: 0.025, a: 0.08 });
      [0.12, 0.2, 0.28, 0.36].forEach((d, i) => ping(2200 + i * 420, { dur: 0.015, vol: 0.02, delay: d }));
      ping(1760, { dur: 0.05, vol: 0.05, delay: 0.5 });
      ping(2490, { dur: 0.22, vol: 0.045, delay: 0.56 });
    },
    fanfare() { [1320, 1760, 1867, 2640].forEach((f, i) => ping(f, { dur: i === 3 ? 0.3 : 0.05, vol: 0.045, delay: i * 0.1 })); },
  };

  let lastType = 0, lastHover = 0;
  function play(name) {
    if (muted || !SOUNDS[name]) return;
    const c = ac(); if (!c || c.state !== 'running') return;
    const now = performance.now();
    if (name === 'type') { if (now - lastType < 45) return; lastType = now; }   // 타이핑은 너무 촘촘하지 않게
    if (name === 'hover') { if (now - lastHover < 60) return; lastHover = now; }
    try { SOUNDS[name](); } catch (e) {}
  }

  // 버튼 공통: 누르면 소리. 특별한 버튼은 아래 표의 소리로
  const MAP = [
    ['.ds-btn-jobs, .q-opt, .choice, .ds-btn-answer', 'select'],
    ['#startBtn, #confirm, #secStart, #guideOk, #photoStart, #camDone, #qNext, #dtOk, #dtNext, #agNext, #endHome, .ds-btn-cta, .ds-btn-station, .ds-btn-start', 'confirm'],
    ['#back, .ds-btn-back', 'back'],
    ['#camShutter', null],          // 셔터는 3·2·1 카운트가 소리를 냄
  ];
  addEventListener('click', e => {
    const b = e.target.closest('button, [role="button"], a');
    if (!b || b.disabled) return;
    for (const [sel, name] of MAP) if (b.matches(sel)) { if (name) play(name); return; }
    play('click');
  }, true);
  // 고를 수 있는 카드에 마우스를 올리면 아주 작게
  addEventListener('pointerover', e => {
    if (e.pointerType !== 'mouse') return;
    const b = e.target.closest('.ds-btn-jobs, .q-opt, .choice');
    if (b && !b.contains(e.relatedTarget)) play('hover');
  });
  addEventListener('keydown', e => {
    if ((e.key === 'm' || e.key === 'M') && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
      muted = !muted; try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch (er) {}
      if (!muted) play('click');
    }
  });

  // 모든 효과음을 0.7초 간격으로 한 번씩 (콘솔에서 SFX.test()). 오류가 난 소리 이름을 돌려줌
  function test(gap = 700) {
    const c = ac(); if (c && c.state === 'suspended') c.resume();
    const errors = [];
    Object.keys(SOUNDS).forEach((name, i) => setTimeout(() => { console.log('SFX', name); }, i * gap));
    Object.keys(SOUNDS).forEach((name, i) => {
      setTimeout(() => { try { SOUNDS[name](); } catch (e) { errors.push(name + ': ' + e.message); console.warn('SFX error', name, e); } }, i * gap);
    });
    return new Promise(r => setTimeout(() => r(errors), Object.keys(SOUNDS).length * gap + 100));
  }

  window.SFX = { play, test, names: Object.keys(SOUNDS), get muted() { return muted; }, set muted(v) { muted = !!v; } };
})();
