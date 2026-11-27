/* PASS 효과음 — Web Audio로 합성(음원 파일 없음). 짧은 UI 효과음만.
   사용: SFX.play('click' | 'hover' | 'select' | 'confirm' | 'back' | 'open' | 'close' | 'type' | 'beep' | 'beepGo'
                  | 'shutter' | 'success' | 'fail' | 'tick' | 'timeup' | 'whoosh' | 'intro' | 'fanfare' | 'appear'
                  | 'reveal' | 'pass' | 'reject')
   M 키: 효과음 끄기/켜기 (브라우저에 기억). 첫 클릭·키 입력 전에는 브라우저 정책상 소리가 나지 않음. */
(function () {
  const KEY = 'pass-sfx-muted';
  let ctx = null, master = null, muted = false;
  try { muted = localStorage.getItem(KEY) === '1'; } catch (e) {}
  const VOLUME = 0.7;   // 효과음 전체 볼륨

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


  // ── 미래적인 톤: 높고 동글한 '핑' 대신 중음역 FM(유리·금속 질감) + 짧은 노이즈 트랜지언트 + 아주 옅은 잔향.
  //    장3화음(귀여운 느낌)은 피하고 완전5도·옥타브로 쌓음. 둔탁하지 않게 저음은 아주 얇게만.
  let bus = null;   // 잔향(짧은 딜레이) 보내기
  function send() {
    if (bus) return bus;
    const dl = ctx.createDelay(1), fb = ctx.createGain(), lp = ctx.createBiquadFilter(), wet = ctx.createGain();
    dl.delayTime.value = 0.115; fb.gain.value = 0.28; lp.type = 'lowpass'; lp.frequency.value = 2800; wet.gain.value = 0.22;
    dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(wet); wet.connect(master);
    return (bus = dl);
  }
  // FM 음 하나: ratio가 정수면 맑은 유리, 소수(1.41 등)면 금속. index가 클수록 날카로움
  function fm({ f, f2 = f, ratio = 2, index = 0.8, dur = 0.06, vol = 0.06, a = 0.003, delay = 0, rv = 0 }) {
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), m = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain();
    o.frequency.setValueAtTime(f, t); m.frequency.setValueAtTime(f * ratio, t);
    if (f2 !== f) { o.frequency.exponentialRampToValueAtTime(f2, t + a + dur); m.frequency.exponentialRampToValueAtTime(f2 * ratio, t + a + dur); }
    mg.gain.setValueAtTime(f * index, t); mg.gain.exponentialRampToValueAtTime(f * index * 0.15, t + a + dur);   // 앞은 반짝, 뒤는 둥글게
    m.connect(mg); mg.connect(o.frequency); o.connect(g); g.connect(master);
    if (rv) { const sg = ctx.createGain(); sg.gain.value = rv; g.connect(sg); sg.connect(send()); }
    env(g, t, vol, a, dur);
    o.start(t); m.start(t); o.stop(t + a + dur + 0.05); m.stop(t + a + dur + 0.05);
  }
  // 필터가 열리며 쓸리는 신스(살짝 어긋난 톱니파 두 개)
  function sweep({ f, f2 = f, lp = 400, lp2 = 3000, dur = 0.2, vol = 0.04, a = 0.02, delay = 0, rv = 0, q = 6 }) {
    const t = ctx.currentTime + delay, g = ctx.createGain(), fl = ctx.createBiquadFilter();
    fl.type = 'lowpass'; fl.Q.value = q; fl.frequency.setValueAtTime(lp, t); fl.frequency.exponentialRampToValueAtTime(lp2, t + a + dur);
    [-7, 7].forEach(cents => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.detune.value = cents;
      o.frequency.setValueAtTime(f, t); if (f2 !== f) o.frequency.exponentialRampToValueAtTime(f2, t + a + dur);
      o.connect(fl); o.start(t); o.stop(t + a + dur + 0.05);
    });
    fl.connect(g); g.connect(master);
    if (rv) { const sg = ctx.createGain(); sg.gain.value = rv; g.connect(sg); sg.connect(send()); }
    env(g, t, vol, a, dur);
  }
  const tick = (o = {}) => noise({ f: 6000, type: 'highpass', dur: 0.006, vol: 0.05, a: 0.001, ...o });   // 아주 짧은 '틱'
  const sub = (f, o = {}) => tone({ f, dur: 0.12, vol: 0.05, a: 0.004, ...o });                           // 얇은 무게감

  const SOUNDS = {
    click()   { tick({ vol: 0.04 }); fm({ f: 880, ratio: 2, index: 1.1, dur: 0.035, vol: 0.055 }); },
    hover()   { fm({ f: 1320, ratio: 3, index: 0.4, dur: 0.012, vol: 0.012 }); },
    select()  { tick({ vol: 0.035 }); fm({ f: 740, ratio: 2, index: 1, dur: 0.03, vol: 0.05 }); fm({ f: 1109, ratio: 2, index: 0.9, dur: 0.07, vol: 0.05, delay: 0.045, rv: 0.4 }); },
    confirm() {
      tick({ vol: 0.04 }); sub(147, { dur: 0.16, vol: 0.04 });
      fm({ f: 587, ratio: 2, index: 1, dur: 0.035, vol: 0.05 });
      fm({ f: 880, ratio: 2, index: 0.9, dur: 0.035, vol: 0.05, delay: 0.05 });
      fm({ f: 1175, ratio: 3, index: 0.6, dur: 0.14, vol: 0.05, delay: 0.1, rv: 0.5 });
    },
    back()    { tick({ vol: 0.03 }); fm({ f: 1109, ratio: 2, index: 0.9, dur: 0.03, vol: 0.045 }); fm({ f: 740, ratio: 2, index: 1, dur: 0.06, vol: 0.045, delay: 0.045 }); },
    open()    { sweep({ f: 220, lp: 350, lp2: 3200, dur: 0.18, vol: 0.03, rv: 0.3 }); noise({ f: 900, f2: 4000, q: 2, dur: 0.16, vol: 0.025, a: 0.03 }); },
    close()   { sweep({ f: 220, lp: 3000, lp2: 300, dur: 0.14, vol: 0.026, a: 0.005 }); noise({ f: 3500, f2: 800, q: 2, dur: 0.12, vol: 0.02, a: 0.005 }); },
    type()    { noise({ f: 2600 + Math.random() * 1400, q: 6, dur: 0.008, vol: 0.05, a: 0.001 }); tone({ f: 1100 + Math.random() * 300, type: 'square', dur: 0.008, vol: 0.008, a: 0.001, lp: 3000 }); },
    beep()    { fm({ f: 880, ratio: 3, index: 0.6, dur: 0.08, vol: 0.06 }); },
    beepGo()  { sub(220, { dur: 0.2, vol: 0.04 }); fm({ f: 1760, ratio: 2, index: 0.7, dur: 0.18, vol: 0.05, rv: 0.4 }); fm({ f: 880, ratio: 2, index: 0.5, dur: 0.18, vol: 0.035 }); },
    shutter() { sub(110, { dur: 0.06, vol: 0.05 }); noise({ f: 5000, type: 'highpass', dur: 0.025, vol: 0.12, a: 0.001 }); noise({ f: 4000, type: 'highpass', dur: 0.03, vol: 0.07, a: 0.001, delay: 0.06 }); },
    success() { tick({ vol: 0.03 }); fm({ f: 784, ratio: 2, index: 0.9, dur: 0.04, vol: 0.05 }); fm({ f: 1175, ratio: 3.5, index: 0.5, dur: 0.22, vol: 0.05, delay: 0.06, rv: 0.5 }); },
    fail()    { [0, 0.1].forEach(d => sweep({ f: 165, lp: 1100, lp2: 500, dur: 0.07, vol: 0.04, a: 0.004, delay: d, q: 3 })); fm({ f: 330, f2: 300, ratio: 1.41, index: 0.8, dur: 0.16, vol: 0.035, delay: 0.1 }); },
    tick()    { tick({ vol: 0.03 }); fm({ f: 1500, ratio: 2, index: 0.5, dur: 0.01, vol: 0.025 }); },
    timeup()  { [0, 0.1, 0.2].forEach(d => fm({ f: 660, ratio: 1.41, index: 1.2, dur: 0.05, vol: 0.05, delay: d })); },
    whoosh()  { noise({ f: 400, f2: 3500, q: 1.5, dur: 0.28, vol: 0.05, a: 0.08 }); },
    intro()   {   // 로고: 낮게 차오르는 신스 → 맑은 유리 핑으로 마무리
      sweep({ f: 110, lp: 200, lp2: 2400, dur: 0.6, vol: 0.035, a: 0.25, rv: 0.3 });
      noise({ f: 300, f2: 3000, q: 1.2, dur: 0.5, vol: 0.02, a: 0.3 });
      fm({ f: 1320, ratio: 3, index: 0.5, dur: 0.4, vol: 0.045, delay: 0.55, rv: 0.6 });
      fm({ f: 660, ratio: 2, index: 0.4, dur: 0.4, vol: 0.03, delay: 0.55 });
    },
    appear()  {   // 캐릭터 등장: 스캔 신스가 쓸리며 데이터 틱 → 5도 두 음으로 착지
      sweep({ f: 165, f2: 330, lp: 300, lp2: 4000, dur: 0.45, vol: 0.03, a: 0.1 });
      [0.1, 0.17, 0.24, 0.31, 0.38].forEach((d, i) => fm({ f: 1800 + i * 260, ratio: 2, index: 0.4, dur: 0.012, vol: 0.018, delay: d }));
      fm({ f: 880, ratio: 2, index: 0.9, dur: 0.05, vol: 0.05, delay: 0.48 });
      fm({ f: 1320, ratio: 3, index: 0.5, dur: 0.24, vol: 0.045, delay: 0.54, rv: 0.5 });
    },
    reveal()  {   // 직무 선택 → 캐릭터 등장(spin-in에 맞춤): 맑게 올라가는 '슈욱'만(뒤의 '띵'은 뺌). 저음 없음
      fm({ f: 880, f2: 2640, ratio: 2, index: 0.2, dur: 0.5, vol: 0.022, a: 0.06 });            // 맑게 올라가는 스캔
      noise({ f: 3000, f2: 9000, type: 'highpass', dur: 0.5, vol: 0.018, a: 0.4 });            // 위쪽 공기가 차오름
      [0.2, 0.27, 0.34, 0.41, 0.48, 0.55].forEach((d, i) => fm({ f: 2000 + i * 300, ratio: 2, index: 0.3, dur: 0.01, vol: 0.016, delay: d }));
    },
    pass()    {   // 실무 과제 성공: 빠르게 올라가는 세 음 → 크게 울리는 성공 화음 + 반짝임
      tick({ vol: 0.05 }); tone({ f: 196, f2: 98, dur: 0.25, vol: 0.09 });
      [784, 1175, 1568].forEach((f, i) => fm({ f, ratio: 2, index: 0.9, dur: 0.05, vol: 0.055, delay: i * 0.07 }));
      [784, 1175, 1568, 2349].forEach(f => fm({ f, ratio: 2, index: 0.6, dur: 0.75, vol: 0.03, a: 0.006, delay: 0.21, rv: 0.55 }));
      sweep({ f: 392, lp: 600, lp2: 6000, dur: 0.5, vol: 0.02, a: 0.02, delay: 0.21, rv: 0.3 });
      noise({ f: 3000, f2: 9000, q: 1, dur: 0.4, vol: 0.03, a: 0.05, delay: 0.21 });
      [0.3, 0.38, 0.47, 0.57].forEach((d, i) => fm({ f: 3136 + i * 400, ratio: 3, index: 0.3, dur: 0.05, vol: 0.016, delay: d, rv: 0.6 }));
    },
    reject()  {   // 실무 과제 실패: 쿵 + 거친 경고 버저 두 번, 마지막은 음이 주저앉음
      tone({ f: 110, f2: 45, dur: 0.35, vol: 0.14 }); noise({ f: 1200, f2: 200, q: 0.7, dur: 0.18, vol: 0.07, a: 0.002 });
      [0, 0.17].forEach((d, i) => {
        sweep({ f: 147, f2: i ? 104 : 147, lp: 2200, lp2: 700, dur: i ? 0.38 : 0.12, vol: 0.06, a: 0.004, delay: d, q: 2 });
        fm({ f: 208, f2: i ? 147 : 208, ratio: 1.41, index: 1.4, dur: i ? 0.38 : 0.12, vol: 0.04, a: 0.004, delay: d });   // 반음 어긋난 금속성 → 불안한 느낌
      });
    },
    fanfare() {   // 결과: 5도로 쌓은 신스 화음이 열리고 위에 유리 핑
      [220, 330, 440, 660].forEach((f, i) => sweep({ f, lp: 400, lp2: 3500, dur: 0.7, vol: 0.016, a: 0.06 + i * 0.03, rv: 0.25 }));
      sub(110, { dur: 0.5, vol: 0.04, a: 0.03 });
      [1320, 1760].forEach((f, i) => fm({ f, ratio: 3, index: 0.5, dur: 0.35, vol: 0.04, delay: 0.25 + i * 0.12, rv: 0.6 }));
    },
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
