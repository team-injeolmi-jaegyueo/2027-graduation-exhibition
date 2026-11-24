/* 체험자 정보 저장소 — Supabase 키오스크 함수 호출 (#37)
 *
 * 테이블·함수: supabase/migrations/20261124120000_participants.sql
 * 설정: app/config.js (URL·anon 키) + 키오스크 URL의 ?kiosk=<장치 키>
 *
 * Participants.ready        Supabase와 장치 키가 모두 있으면 true. false면 앱은 localStorage만 씀
 * Participants.tag(uid)     카드 태그 → 체험자(없으면 새로 만듦). { id, no, name, job, stage, answers, is_new, … }
 * Participants.update(id, patch)          { name, job, stage, profile } 중 바꿀 것만
 * Participants.answer(id, section, detail) 응답 1건 추가
 * Participants.list() / remove(id)        관리자 설정용
 *
 * update·answer는 실패하면 순서대로 다시 보낸다(인터넷이 잠깐 끊겨도 응답이 사라지지 않게).
 * 아직 못 보낸 것은 이 브라우저 localStorage에 남아 있어 새로고침해도 이어서 보낸다.
 */
(() => {
  const cfg = window.APP_CONFIG || {};
  const KEY_STORE = 'pass-kiosk-key', OUTBOX_STORE = 'pass-outbox';

  // 키오스크 URL의 ?kiosk=… 를 기억하고 주소창에서는 지운다
  const params = new URLSearchParams(location.search);
  if (params.has('kiosk')) {
    const k = params.get('kiosk').trim();
    try { k ? localStorage.setItem(KEY_STORE, k) : localStorage.removeItem(KEY_STORE); } catch (e) {}
    params.delete('kiosk');
    history.replaceState(null, '', location.pathname + (params.size ? '?' + params : '') + location.hash);
  }
  let kioskKey = null;
  try { kioskKey = localStorage.getItem(KEY_STORE); } catch (e) {}

  const base = (cfg.SUPABASE_URL || '').replace(/\/+$/, '');
  const ready = !!(base && cfg.SUPABASE_ANON_KEY && kioskKey);

  async function rpc(fn, args) {
    if (!ready) throw new Error('Supabase 설정 또는 장치 키가 없습니다');
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(`${base}/rest/v1/rpc/${fn}`, {
        method: 'POST', signal: ctrl.signal,
        headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: `Bearer ${cfg.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_key: kioskKey, ...args }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const err = new Error(body?.message || `HTTP ${res.status}`);
        err.code = body?.code; err.status = res.status;
        throw err;
      }
      return body;
    } finally { clearTimeout(t); }
  }

  // ───── 못 보낸 저장 요청 다시 보내기 ─────
  let outbox = [];
  try { outbox = JSON.parse(localStorage.getItem(OUTBOX_STORE) || '[]'); } catch (e) {}
  const saveOutbox = () => { try { localStorage.setItem(OUTBOX_STORE, JSON.stringify(outbox)); } catch (e) {} };
  let flushing = false, retryTimer = 0;
  const listeners = new Set();
  const notify = () => listeners.forEach(fn => { try { fn({ pending: outbox.length }); } catch (e) {} });

  async function flush() {
    if (flushing || !ready) return;
    flushing = true; clearTimeout(retryTimer);
    try {
      while (outbox.length) {
        const job = outbox[0];
        try { await rpc(job.fn, job.args); }
        catch (e) {
          // 잘못된 요청(삭제된 체험자 등)은 버리고, 네트워크·서버 오류는 잠시 뒤 다시
          if (e.status && e.status < 500 && e.code !== '28000') { console.warn('[participants] 버린 저장 요청', job, e); }
          else { retryTimer = setTimeout(flush, 5000); notify(); return; }
        }
        outbox.shift(); saveOutbox();
      }
      notify();
    } finally { flushing = false; }
  }
  function enqueue(fn, args) { outbox.push({ fn, args }); saveOutbox(); notify(); flush(); }
  addEventListener('online', flush);
  if (outbox.length) flush();

  window.Participants = {
    ready,
    device: ready ? 'kiosk' : 'local',
    get pending() { return outbox.length; },
    onPending(fn) { listeners.add(fn); },
    tag: uid => rpc('kiosk_tag', { p_uid: String(uid) }),
    update: (id, patch) => enqueue('kiosk_update', { p_id: id, p_patch: patch }),
    answer: (id, section, detail) => enqueue('kiosk_answer', { p_id: id, p_section: String(section), p_detail: detail ?? {} }),
    list: () => rpc('kiosk_list', {}),
    remove: id => rpc('kiosk_delete', { p_id: id }),
    flush,
  };
})();
