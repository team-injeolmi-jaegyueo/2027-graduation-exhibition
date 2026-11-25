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
 *
 * ───── 입구 등록 → 카드 → 키오스크 설문 (#45, supabase/migrations/20261125120000_register_kiosk_flow.sql) ─────
 * Participants.register(uid, { job, photo, name, profile })  입구에서 카드 태그 순간 체험자 생성(+사진). 재사용 카드면 이전 연결을 끊음
 *                                                           → 체험자 + media + released_no
 * Participants.lookup(uid)            키오스크에서 카드 조회 → 체험자 + answers + media + finished
 *                                     입구에서 등록하지 않은 카드는 오류 code 'P0002'
 * Participants.media(id, kind)        사진('photo')·생성물('toy_2d'·'model_3d') → { kind, status, data, storage_path, meta } 또는 null
 * Participants.finish(id, result)     설문 완료(결과 요약 저장). update·answer처럼 실패하면 다시 보냄
 * Participants.section(id, key, event) 섹션 시작('start')·끝('end') 기록 → participants.progress. 실패하면 다시 보냄
 *                                     key = 'person' | 'fit' | 'values' (20261125130000_section_progress.sql)
 * Participants.shrinkPhoto(dataUrl)   촬영한 사진을 저장용으로 줄임(가로 최대 1280px JPEG)
 *
 * 이 네 가지는 Supabase가 없을 때(장치 키 없음)도 이 브라우저 localStorage에서 똑같이 동작한다(같은 브라우저의 탭끼리 공유).
 * 그때는 update·answer도 이 로컬 저장소의 체험자에게 기록된다(기존 로컬 면접자에게는 영향 없음).
 * 오류는 서버와 같은 code를 단다: 28000 장치 키, 42501 역할, 22023 입력값, P0002 없음.
 */
(() => {
  const cfg = window.APP_CONFIG || {};
  // 입구(?mode=register)는 장치 키·못 보낸 요청을 따로 둔다: 한 브라우저에서 입구·키오스크 탭을 함께 열어도
  // 서로의 키로 덮어쓰거나, 다른 역할의 키로 보내져 거부(버려짐)되지 않게 (#45)
  const MODE_SUFFIX = new URLSearchParams(location.search).get('mode') === 'register' ? ':register' : '';
  const KEY_STORE = 'pass-kiosk-key' + MODE_SUFFIX, OUTBOX_STORE = 'pass-outbox' + MODE_SUFFIX;

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

  // ───── Supabase 없이 쓰는 로컬 저장소 (#45) ─────
  // 서버 함수와 같은 모양의 JSON을 돌려준다. 체험자 목록과 사진은 키를 나눠 저장(사진이 커서)
  const LOCAL_STORE = 'pass-local-participants', LOCAL_PHOTO = 'pass-local-media:';
  const fail = (code, message) => Object.assign(new Error(message), { code, status: 400 });
  const normalizeUid = u => String(u ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  const checkUid = u => { const v = normalizeUid(u); if (!/^[0-9A-F]{4,32}$/.test(v)) throw fail('22023', 'invalid card uid'); return v; };
  const nowIso = () => new Date().toISOString();
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : 'local-' + Date.now().toString(36) + Math.random().toString(36).slice(2));
  const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,/;
  const MEDIA_KINDS = ['photo', 'toy_2d', 'model_3d'];
  const SECTION_NAMES = { person: '인성', fit: '직무적합성', values: '가치관' };

  const local = {
    read() { try { return JSON.parse(localStorage.getItem(LOCAL_STORE) || '[]'); } catch (e) { return []; } },
    write(list) { localStorage.setItem(LOCAL_STORE, JSON.stringify(list)); },
    // 번호는 이 브라우저의 기존 로컬 면접자(pass-users)와 겹치지 않게 그 다음부터
    nextNo(list) {
      let legacy = [];
      try { legacy = JSON.parse(localStorage.getItem('pass-users') || '{}').users || []; } catch (e) {}
      return [...list, ...legacy].reduce((m, p) => Math.max(m, +p.no || 0), 16) + 1;
    },
    mediaKey: (id, kind) => LOCAL_PHOTO + id + ':' + kind,
    summary(id) {
      const out = [];
      for (const kind of MEDIA_KINDS) {
        let m = null; try { m = JSON.parse(localStorage.getItem(local.mediaKey(id, kind)) || 'null'); } catch (e) {}
        if (m) out.push({ kind, status: m.status, has_data: m.data != null, storage_path: m.storage_path ?? null, updated_at: m.updated_at });
      }
      return out;
    },
    // 사진은 용량이 커서, 저장 공간이 모자라면 오래된 로컬 사진부터 지우고 다시 시도
    putMedia(id, kind, data) {
      const key = local.mediaKey(id, kind), val = JSON.stringify({ kind, status: 'ready', data, storage_path: null, meta: {}, updated_at: nowIso() });
      for (let tries = 0; ; tries++) {
        try { localStorage.setItem(key, val); return; }
        catch (e) {
          const old = Object.keys(localStorage).filter(k => k.startsWith(LOCAL_PHOTO) && k !== key)
            .map(k => { try { return [k, JSON.parse(localStorage.getItem(k)).updated_at || '']; } catch (_) { return [k, '']; } })
            .sort((a, b) => a[1] < b[1] ? -1 : 1);
          if (!old.length || tries > 50) { console.warn('[participants] 로컬 저장 공간이 모자라 사진을 저장하지 못함', e); return; }
          localStorage.removeItem(old[0][0]);
        }
      }
    },
    find(list, id) { const p = list.find(x => x.id === id); if (!p) throw fail('P0002', 'participant not found'); return p; },

    register(uid, { job, photo = null, name = null, profile = {} } = {}) {
      const card = checkUid(uid);
      if (!String(job ?? '').trim()) throw fail('22023', 'job is required');
      if (profile != null && (typeof profile !== 'object' || Array.isArray(profile))) throw fail('22023', 'profile must be an object');
      if (photo != null && (!PHOTO_RE.test(photo) || photo.length > 3000000)) throw fail('23514', 'invalid photo');
      const list = local.read(), t = nowIso();
      let releasedNo = null;
      const prev = list.find(p => p.card_uid === card);
      if (prev) { releasedNo = prev.no; prev.profile = { ...prev.profile, prev_card_uid: card, card_released_at: t }; prev.card_uid = null; prev.updated_at = t; }
      const p = { id: newId(), card_uid: card, no: local.nextNo(list), name: String(name ?? '').trim() || null, job: String(job).trim(),
        stage: '등록 완료', profile: profile || {}, created_device: 'local', last_device: 'local',
        created_at: t, updated_at: t, last_seen_at: t, registered_at: t, finished_at: null, result: null, progress: {}, answers: [] };
      list.push(p); local.write(list);
      if (photo != null) local.putMedia(p.id, 'photo', photo);
      return { ...p, media: local.summary(p.id), released_no: releasedNo };
    },
    lookup(uid) {
      const card = normalizeUid(uid), list = local.read();
      const p = list.find(x => x.card_uid === card && x.registered_at);
      if (!p) throw fail('P0002', 'card not registered');
      p.last_seen_at = nowIso(); local.write(list);
      return { ...p, media: local.summary(p.id), finished: !!p.finished_at };
    },
    media(id, kind = 'photo') {
      try { const m = JSON.parse(localStorage.getItem(local.mediaKey(id, kind)) || 'null'); return m && { kind: m.kind, status: m.status, data: m.data, storage_path: m.storage_path, meta: m.meta || {}, updated_at: m.updated_at }; }
      catch (e) { return null; }
    },
    finish(id, result) {
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw fail('22023', 'result must be an object');
      const list = local.read(), p = local.find(list, id), t = nowIso();
      Object.assign(p, { finished_at: t, result, stage: '면접 완료', updated_at: t }); local.write(list);
      return { ...p, finished: true };
    },
    // 로컬 저장소의 체험자일 때만 기록(기존 로컬 면접자는 index.html이 따로 관리)
    has: id => local.read().some(p => p.id === id),
    update(id, patch = {}) {
      const list = local.read(), p = local.find(list, id);
      if ('name' in patch) p.name = String(patch.name ?? '').trim() || null;
      if ('job' in patch) p.job = patch.job;
      if ('stage' in patch && patch.stage != null) p.stage = patch.stage;
      if (patch.profile && typeof patch.profile === 'object' && !Array.isArray(patch.profile)) p.profile = { ...p.profile, ...patch.profile };
      p.updated_at = nowIso(); local.write(list);
      return p;
    },
    section(id, key, event) {
      const list = local.read(), p = local.find(list, id), t = nowIso(), cur = { ...(p.progress || {})[key] };
      if (event === 'start') { cur.started_at ||= t; p.stage = SECTION_NAMES[key]; } else cur.finished_at = t;
      cur.device = 'local'; p.progress = { ...(p.progress || {}), [key]: cur }; p.updated_at = t; local.write(list);
      return p;
    },
    answer(id, section, detail) {
      const list = local.read(), p = local.find(list, id);
      (p.answers ||= []).push({ section: String(section), detail: detail ?? {}, device: 'local', answered_at: nowIso() });
      p.updated_at = nowIso(); local.write(list);
    },
  };
  // 로컬 동작도 서버 호출처럼 Promise로(호출하는 쪽 코드를 하나로)
  const later = fn => { try { return Promise.resolve(fn()); } catch (e) { return Promise.reject(e); } };

  // 저장용으로 줄이기: 가로 maxW 이하 JPEG. 실패하면 원본 그대로
  function shrinkPhoto(dataUrl, maxW = 1280, quality = .8) {
    if (!dataUrl) return Promise.resolve(null);
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        try {
          const k = Math.min(1, maxW / img.naturalWidth), c = document.createElement('canvas');
          c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', quality));
        } catch (e) { resolve(dataUrl); }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  window.Participants = {
    ready,
    device: ready ? 'kiosk' : 'local',
    get pending() { return outbox.length; },
    onPending(fn) { listeners.add(fn); },
    tag: uid => rpc('kiosk_tag', { p_uid: String(uid) }),
    update: (id, patch) => ready ? enqueue('kiosk_update', { p_id: id, p_patch: patch }) : (local.has(id) && void local.update(id, patch)),
    answer: (id, section, detail) => ready ? enqueue('kiosk_answer', { p_id: id, p_section: String(section), p_detail: detail ?? {} })
                                           : (local.has(id) && void local.answer(id, section, detail)),
    list: () => rpc('kiosk_list', {}),
    remove: id => rpc('kiosk_delete', { p_id: id }),
    flush,
    // #45 입구 등록 → 카드 → 키오스크 설문
    register: (uid, { job, photo = null, name = null, profile = {} } = {}) => ready
      ? rpc('kiosk_register', { p_uid: String(uid), p_job: job ?? null, p_photo: photo, p_name: name, p_profile: profile ?? {} })
      : later(() => local.register(uid, { job, photo, name, profile })),
    lookup: uid => ready ? rpc('kiosk_lookup', { p_uid: String(uid) }) : later(() => local.lookup(uid)),
    media: (id, kind = 'photo') => ready ? rpc('kiosk_media_get', { p_id: id, p_kind: kind }) : later(() => local.media(id, kind)),
    finish: (id, result) => {
      if (!result || typeof result !== 'object' || Array.isArray(result)) return Promise.reject(fail('22023', 'result must be an object'));
      if (!ready) return later(() => local.finish(id, result));
      enqueue('kiosk_finish', { p_id: id, p_result: result });   // 응답들 뒤에 순서대로 보내짐
      return Promise.resolve({ queued: true });
    },
    section: (id, key, event) => {
      if (!Object.hasOwn(SECTION_NAMES, key)) return Promise.reject(fail('22023', 'section must be person, fit or values'));
      if (event !== 'start' && event !== 'end') return Promise.reject(fail('22023', 'event must be start or end'));
      if (!ready) return later(() => local.section(id, key, event));
      enqueue('kiosk_section', { p_id: id, p_section: key, p_event: event });
      return Promise.resolve({ queued: true });
    },
    shrinkPhoto,
  };
})();
