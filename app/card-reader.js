/* NFC 카드 리더기 입력 (#37)
 *
 * 키오스크의 리더기(CH559)는 키보드처럼 동작한다: 카드를 대면 10자리 숫자를 아주 빠르게 치고 Enter.
 * 그 숫자가 그대로 앱으로 가면 답변 선택(숫자키)·PIN 입력과 섞이므로, 여기서 먼저 가로챈다.
 *
 * - 숫자 키는 GAP ms 동안 잠깐 붙잡아 둔다. 그 안에 다음 숫자가 오지 않으면 사람이 친 것으로 보고
 *   그대로 다시 보낸다(사람에게는 느껴지지 않는 지연).
 * - 숫자 MIN_LEN개 이상이 GAP ms 간격 안으로 이어지다 Enter가 오면 카드 태그로 본다.
 *   → window에 'cardtag' 이벤트 { detail: { uid } }
 * - 글자 입력칸(input·textarea)에 포커스가 있을 때는 숫자를 막지 않고, 카드로 판정되면
 *   칸에 들어간 UID 숫자만 지운다.
 *
 * 반드시 다른 스크립트보다 먼저 불러온다(capture 단계에서 가장 먼저 받아야 함).
 * 시험: 콘솔에서 CardReader.simulate('0000790572')
 */
(() => {
  const GAP = 80;       // 리더기 키 사이 최대 간격(ms). 사람이 이 간격으로 숫자를 연달아 치기는 어렵다
  const MIN_LEN = 8;    // 이보다 짧으면 카드로 보지 않음

  let held = [];        // 붙잡아 둔 숫자 키 (입력칸이 아닐 때)
  let burst = '';       // 이번 연속 입력의 숫자들 (입력칸 포함)
  let last = 0, timer = 0;

  const editable = el => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

  function release() {  // 붙잡은 키를 사람이 친 것으로 다시 보냄
    clearTimeout(timer);
    const keys = held; held = []; burst = '';
    for (const k of keys) {
      const target = document.activeElement || document.body;
      target.dispatchEvent(new KeyboardEvent('keydown', { key: k.key, code: k.code, bubbles: true, cancelable: true, composed: true }));
    }
  }

  function emit(uid) {
    window.dispatchEvent(new CustomEvent('cardtag', { detail: { uid } }));
  }

  addEventListener('keydown', e => {
    if (!e.isTrusted) return;                       // release()가 다시 보낸 키는 통과
    const now = performance.now();
    const gapOk = now - last <= GAP;
    const inField = editable(e.target);

    if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
      if (burst && !gapOk) release();               // 간격이 벌어졌으면 이전 것은 사람 입력
      burst += e.key; last = now;
      if (inField) return;                          // 입력칸: 글자는 그대로 들어가게 둠
      held.push({ key: e.key, code: e.code });
      e.preventDefault(); e.stopImmediatePropagation();
      clearTimeout(timer); timer = setTimeout(release, GAP);
      return;
    }

    if (e.key === 'Enter' && burst.length >= MIN_LEN && gapOk) {
      const uid = burst;
      clearTimeout(timer); held = []; burst = '';
      e.preventDefault(); e.stopImmediatePropagation();
      if (inField && 'value' in e.target && e.target.value.endsWith(uid)) {
        e.target.value = e.target.value.slice(0, -uid.length);
        e.target.dispatchEvent(new Event('input', { bubbles: true }));
      }
      emit(uid);
      return;
    }

    if (held.length || burst) release();            // 다른 키: 붙잡은 숫자를 먼저 보내고 이 키는 그대로
  }, true);

  window.CardReader = { simulate: uid => emit(String(uid)) };
})();
