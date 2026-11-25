-- 입구 등록 → NFC 카드 → 키오스크 설문 (#45)
--
-- 흐름
--   입구(등록 스테이션): 직무 선택 → 사진 촬영 → 카드 태그 → kiosk_register   체험자 생성 + 카드 연결 + 사진
--   면접 키오스크:       카드 태그 → kiosk_lookup → 설문(kiosk_answer, 기존) → kiosk_finish   완료 시각 + 결과 요약
--   사진·생성물:         kiosk_media_get
--
-- 배포 사이트가 같은 DB의 기존 함수 5개(kiosk_tag·update·answer·list·delete)를 쓰고 있으므로
-- 그 함수들의 동작은 바꾸지 않고 추가만 한다. 바뀌는 것은
--   - participants.card_uid를 비울 수 있게 함(카드 재사용 시 이전 체험자와 연결을 끊으려고). 기존 함수는 영향 없음
--   - participants에 칸 추가 → 기존 함수의 결과 JSON에 키가 몇 개 늘어남(앱은 모르는 키를 무시)
-- 기존 함수의 권한 제한·자동 등록 제거는 배포 사이트를 새 코드로 바꿀 때 따로 한다.

-- ───────── 장치 역할 ─────────
-- legacy   : 이 마이그레이션 전에 만든 키. 기존 함수 5개만 쓸 수 있음(새 함수는 거부)
-- register : 입구 등록 스테이션
-- kiosk    : 면접 키오스크
-- admin    : 운영자(관리자 페이지 등)
alter table private.kiosk_keys
  add column role text not null default 'legacy'
  check (role in ('legacy', 'register', 'kiosk', 'admin'));

-- 역할을 정해 키 만들기: select private.new_device_key('entrance-1', 'register');
create function private.new_device_key(p_label text, p_role text) returns text
language plpgsql security definer set search_path = '' as $$
declare k text := encode(extensions.gen_random_bytes(16), 'hex');
begin
  if p_role not in ('register', 'kiosk', 'admin') then
    raise exception 'role must be register, kiosk or admin' using errcode = '22023';
  end if;
  insert into private.kiosk_keys (key_hash, label, role)
  values (encode(extensions.digest(k, 'sha256'), 'hex'), p_label, p_role);
  return k;   -- 이때 한 번만 보인다
end $$;

-- 키가 맞고 역할이 p_roles 안에 있으면 장치 이름을 돌려준다
create function private.device_auth(p_key text, p_roles text[]) returns text
language plpgsql stable security definer set search_path = '' as $$
declare l text; r text;
begin
  select label, role into l, r from private.kiosk_keys
   where key_hash = encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex');
  if l is null then
    raise exception 'invalid kiosk key' using errcode = '28000';
  end if;
  if not (r = any (p_roles)) then
    raise exception 'device role % cannot do this', r using errcode = '42501';
  end if;
  return l;
end $$;

-- ───────── 체험자: 등록·완료 정보 ─────────
alter table public.participants
  alter column card_uid drop not null,                       -- 카드를 다른 사람에게 넘기면 비움
  add column registered_at timestamptz,                      -- 입구에서 등록한 시각(kiosk_tag가 자동으로 만든 체험자는 비어 있음)
  add column finished_at   timestamptz,                      -- 설문을 끝낸 시각
  add column result        jsonb check (result is null or (jsonb_typeof(result) = 'object' and pg_column_size(result) <= 20000));
-- result 예: {"robot_percent": 60, "fit_percent": 70, "task": {"job": "design", "passed": true, "detail": {…}}}

-- ───────── 사진·생성물 ─────────
-- 체험자 1명 × 종류 1개. 원본 사진은 등록할 때 브라우저가 바로 올리므로 data(줄인 JPEG data URL)에 넣고,
-- 크기가 큰 생성물(2D 토이 이미지, 3D 모델)은 생성 프로그램이 Storage나 중앙 PC에 두고 storage_path만 적는다.
create table public.participant_media (
  participant_id uuid not null references public.participants(id) on delete cascade,
  kind           text not null check (kind in ('photo', 'toy_2d', 'model_3d')),
  status         text not null default 'ready' check (status in ('pending', 'ready', 'failed')),
  data           text check (data is null or (char_length(data) <= 3000000 and data ~ '^data:image/(jpeg|png|webp);base64,')),
  storage_path   text check (char_length(storage_path) <= 500),
  meta           jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object'),
  error          text check (char_length(error) <= 2000),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (participant_id, kind)
);
alter table public.participant_media enable row level security;
revoke all on public.participant_media from anon, authenticated;

-- 사진 데이터는 빼고 종류·상태만 (조회 결과에 붙임)
create function private.media_summary(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', m.kind, 'status', m.status,
           'has_data', m.data is not null, 'storage_path', m.storage_path, 'updated_at', m.updated_at)
           order by m.kind), '[]'::jsonb)
    from public.participant_media m where m.participant_id = p_id
$$;

revoke all on all functions in schema private from public, anon, authenticated;

-- ───────── 새 키오스크 API (anon이 호출) ─────────

-- 입구: 카드 태그 순간 직무·사진(·이름)을 한 번에 보내 체험자를 만든다.
-- 이미 다른 체험자에게 연결된 카드면(재사용) 그 체험자와의 연결만 끊고 기록은 남긴다.
-- 결과: 새 체험자 + media + released_no(연결을 끊은 이전 체험자 번호, 없으면 null)
create function public.kiosk_register(p_key text, p_uid text, p_job text,
                                      p_photo text default null, p_name text default null,
                                      p_profile jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  dev text := private.device_auth(p_key, array['register', 'admin']);
  uid text := private.normalize_uid(p_uid);
  old_no integer;
  pid uuid;
begin
  if uid !~ '^[0-9A-F]{4,32}$' then
    raise exception 'invalid card uid' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_job, '')), '') is null then
    raise exception 'job is required' using errcode = '22023';
  end if;
  if p_profile is not null and jsonb_typeof(p_profile) <> 'object' then
    raise exception 'profile must be an object' using errcode = '22023';
  end if;

  -- 카드 재사용: 이전 체험자에게서 카드를 떼어 냄(기록은 그대로)
  update public.participants
     set card_uid = null,
         profile = profile || jsonb_build_object('prev_card_uid', card_uid, 'card_released_at', now()),
         updated_at = now()
   where card_uid = uid
  returning no into old_no;

  insert into public.participants (card_uid, name, job, stage, profile, registered_at, created_device, last_device)
  values (uid, nullif(btrim(p_name), ''), btrim(p_job), '등록 완료', coalesce(p_profile, '{}'::jsonb), now(), dev, dev)
  returning id into pid;

  if p_photo is not null then
    insert into public.participant_media (participant_id, kind, status, data)
    values (pid, 'photo', 'ready', p_photo);
  end if;

  return private.participant_json(pid)
      || jsonb_build_object('media', private.media_summary(pid), 'released_no', old_no);
end $$;

-- 키오스크: 카드로 체험자 조회. 입구에서 등록하지 않은 카드는 오류(P0002, 'card not registered').
-- 새로 만들지 않는다(기존 kiosk_tag와 다른 점). 결과: 체험자 + answers + media + finished
create function public.kiosk_lookup(p_key text, p_uid text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  dev text := private.device_auth(p_key, array['kiosk', 'admin']);
  uid text := private.normalize_uid(p_uid);
  pid uuid;
begin
  update public.participants set last_device = dev, last_seen_at = now()
   where card_uid = uid and registered_at is not null
  returning id into pid;
  if pid is null then
    raise exception 'card not registered' using errcode = 'P0002';
  end if;
  return private.participant_json(pid)
      || jsonb_build_object('media', private.media_summary(pid),
                            'finished', (select finished_at is not null from public.participants where id = pid));
end $$;

-- 사진·생성물 1개 받기. 없으면 null
create function public.kiosk_media_get(p_key text, p_id uuid, p_kind text default 'photo') returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.device_auth(p_key, array['register', 'kiosk', 'admin']);
  return (select jsonb_build_object('kind', m.kind, 'status', m.status, 'data', m.data,
                                    'storage_path', m.storage_path, 'meta', m.meta, 'updated_at', m.updated_at)
            from public.participant_media m where m.participant_id = p_id and m.kind = p_kind);
end $$;

-- 키오스크: 설문 종료. 완료 시각·결과 요약을 저장하고 단계를 '면접 완료'로.
-- 다시 부르면(운영자가 되돌려 다시 진행한 경우) 새 값으로 덮어쓴다. 응답 기록은 kiosk_answer로 이미 쌓여 있음
create function public.kiosk_finish(p_key text, p_id uuid, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare dev text := private.device_auth(p_key, array['kiosk', 'admin']);
begin
  if p_result is null or jsonb_typeof(p_result) <> 'object' then
    raise exception 'result must be an object' using errcode = '22023';
  end if;
  update public.participants
     set finished_at = now(), result = p_result, stage = '면접 완료',
         last_device = dev, updated_at = now()
   where id = p_id;
  if not found then
    raise exception 'participant not found' using errcode = 'P0002';
  end if;
  return private.participant_json(p_id) || jsonb_build_object('finished', true);
end $$;

revoke all on function public.kiosk_register(text, text, text, text, text, jsonb), public.kiosk_lookup(text, text),
  public.kiosk_media_get(text, uuid, text), public.kiosk_finish(text, uuid, jsonb)
  from public;
grant execute on function public.kiosk_register(text, text, text, text, text, jsonb), public.kiosk_lookup(text, text),
  public.kiosk_media_get(text, uuid, text), public.kiosk_finish(text, uuid, jsonb)
  to anon, authenticated;
