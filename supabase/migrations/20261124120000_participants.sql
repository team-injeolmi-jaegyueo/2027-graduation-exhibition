-- NFC 카드별 체험자 정보 (#37)
--
-- 카드 UID 1개 = 체험자 1명. 키오스크에서 카드를 태그하면 그 체험자의 정보를 불러온다.
--
-- 보안: 브라우저에는 anon 키만 있다(관객도 볼 수 있음). 그래서
--   1) 테이블은 RLS를 켜고 정책을 두지 않아 anon이 직접 읽고 쓸 수 없다.
--   2) 키오스크는 아래 kiosk_* 함수로만 접근하고, 함수는 장치 키를 확인한다.
--   3) 장치 키는 저장소에 넣지 않고 각 파이의 키오스크 URL(?kiosk=…)에만 둔다.
--      DB에는 키의 sha256만 저장한다.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;   -- API로 노출되지 않는 스키마
revoke all on schema private from public, anon, authenticated;

-- ───────── 테이블 ─────────

-- 키오스크 장치 키. 키를 만들 때: select private.new_kiosk_key('kiosk-1');
create table private.kiosk_keys (
  key_hash   text primary key,
  label      text not null unique,
  created_at timestamptz not null default now()
);

-- 면접자 번호는 앱에서 NO17부터 보여 준다(앞에 다른 지원자가 있었던 것처럼)
create sequence public.participant_no_seq start 17;

create table public.participants (
  id             uuid primary key default gen_random_uuid(),
  card_uid       text not null unique check (card_uid ~ '^[0-9A-F]{4,32}$'),
  no             integer not null unique default nextval('public.participant_no_seq'),
  name           text check (char_length(name) <= 40),
  job            text check (char_length(job) <= 40),
  stage          text not null default '면접대기실' check (char_length(stage) <= 40),
  profile        jsonb not null default '{}'::jsonb check (jsonb_typeof(profile) = 'object'),
  created_device text,
  last_device    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now()
);
alter sequence public.participant_no_seq owned by public.participants.no;

-- 응답 기록. 고치지 않고 계속 쌓는다(같은 질문을 다시 하면 새 행, 가장 최근 것이 유효)
create table public.participant_answers (
  id             bigint generated always as identity primary key,
  participant_id uuid not null references public.participants(id) on delete cascade,
  section        text not null check (char_length(section) <= 40),
  detail         jsonb not null,
  device         text,
  answered_at    timestamptz not null default now()
);
create index participant_answers_participant_idx on public.participant_answers (participant_id, id);

alter table public.participants enable row level security;
alter table public.participant_answers enable row level security;
revoke all on public.participants, public.participant_answers from anon, authenticated;
revoke all on sequence public.participant_no_seq from anon, authenticated;

-- ───────── 내부 함수 ─────────

create function private.new_kiosk_key(p_label text) returns text
language plpgsql security definer set search_path = '' as $$
declare k text := encode(extensions.gen_random_bytes(16), 'hex');
begin
  insert into private.kiosk_keys (key_hash, label)
  values (encode(extensions.digest(k, 'sha256'), 'hex'), p_label);
  return k;   -- 이때 한 번만 보인다. 파이의 키오스크 URL에 넣는다
end $$;

-- 키가 맞으면 장치 이름을 돌려주고, 틀리면 오류
create function private.kiosk_auth(p_key text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare l text;
begin
  select label into l from private.kiosk_keys
   where key_hash = encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex');
  if l is null then
    raise exception 'invalid kiosk key' using errcode = '28000';
  end if;
  return l;
end $$;

-- 리더기마다 표기가 달라도 같은 카드로: 공백·콜론·하이픈 제거, 대문자
create function private.normalize_uid(p_uid text) returns text
language sql immutable set search_path = '' as $$
  select upper(regexp_replace(coalesce(p_uid, ''), '[^0-9A-Za-z]', '', 'g'))
$$;

create function private.participant_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(p) || jsonb_build_object('answers', coalesce((
           select jsonb_agg(jsonb_build_object(
                    'section', a.section, 'detail', a.detail,
                    'device', a.device, 'answered_at', a.answered_at) order by a.id)
             from public.participant_answers a where a.participant_id = p.id), '[]'::jsonb))
    from public.participants p where p.id = p_id
$$;

revoke all on all functions in schema private from public, anon, authenticated;

-- ───────── 키오스크 API (anon이 호출) ─────────

-- 카드 태그: 등록된 카드면 그 체험자를, 처음 보는 카드면 새 체험자를 만들어 돌려준다.
-- 결과: 체험자 정보 + answers(응답 목록) + is_new
create function public.kiosk_tag(p_key text, p_uid text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  dev text := private.kiosk_auth(p_key);
  uid text := private.normalize_uid(p_uid);
  pid uuid;
  created boolean := false;
begin
  if uid !~ '^[0-9A-F]{4,32}$' then
    raise exception 'invalid card uid' using errcode = '22023';
  end if;

  -- 다시 태그할 때마다 번호가 하나씩 비지 않도록, 먼저 찾아 보고 없을 때만 insert
  update public.participants set last_device = dev, last_seen_at = now()
   where card_uid = uid returning id into pid;
  if pid is null then
    insert into public.participants (card_uid, created_device, last_device)
    values (uid, dev, dev)
    on conflict (card_uid) do nothing
    returning id into pid;
    created := pid is not null;
    if pid is null then   -- 같은 카드가 동시에 두 키오스크에서 처음 태그된 경우
      select id into pid from public.participants where card_uid = uid;
    end if;
  end if;

  return private.participant_json(pid) || jsonb_build_object('is_new', created);
end $$;

-- 이름·직무·단계·profile 바꾸기. p_patch에 있는 키만 바뀐다. profile은 합친다.
-- 예: {"job":"design","stage":"인성"}, {"name":"홍길동"}, {"profile":{"photoUrl":"…"}}
create function public.kiosk_update(p_key text, p_id uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare dev text := private.kiosk_auth(p_key);
begin
  update public.participants set
    name    = case when p_patch ? 'name'  then nullif(btrim(p_patch->>'name'), '') else name end,
    job     = case when p_patch ? 'job'   then p_patch->>'job' else job end,
    stage   = case when p_patch ? 'stage' then coalesce(p_patch->>'stage', stage) else stage end,
    profile = case when jsonb_typeof(p_patch->'profile') = 'object' then profile || (p_patch->'profile') else profile end,
    last_device = dev, updated_at = now()
  where id = p_id;
  if not found then
    raise exception 'participant not found' using errcode = 'P0002';
  end if;
  return private.participant_json(p_id);
end $$;

-- 응답 1건 추가 (앱의 'answer' 이벤트 detail을 그대로 저장)
create function public.kiosk_answer(p_key text, p_id uuid, p_section text, p_detail jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare dev text := private.kiosk_auth(p_key); new_id bigint;
begin
  insert into public.participant_answers (participant_id, section, detail, device)
  values (p_id, p_section, coalesce(p_detail, '{}'::jsonb), dev)
  returning id into new_id;
  update public.participants set updated_at = now(), last_device = dev where id = p_id;
  return new_id;
exception when foreign_key_violation then
  raise exception 'participant not found' using errcode = 'P0002';
end $$;

-- 관리자 설정의 면접자 목록 (응답은 빼고 개수만)
create function public.kiosk_list(p_key text, p_limit int default 300) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.kiosk_auth(p_key);
  return coalesce((
    select jsonb_agg(to_jsonb(p) || jsonb_build_object(
             'answer_count', (select count(*) from public.participant_answers a where a.participant_id = p.id))
           order by p.created_at)
      from (select * from public.participants order by created_at desc limit least(greatest(p_limit, 1), 1000)) p
  ), '[]'::jsonb);
end $$;

-- 관리자 설정의 삭제 (응답도 함께 지워짐). 카드는 다시 태그하면 새 번호로 등록된다
create function public.kiosk_delete(p_key text, p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform private.kiosk_auth(p_key);
  delete from public.participants where id = p_id;
  return found;
end $$;

revoke all on function public.kiosk_tag(text, text), public.kiosk_update(text, uuid, jsonb),
  public.kiosk_answer(text, uuid, text, jsonb), public.kiosk_list(text, int), public.kiosk_delete(text, uuid)
  from public;
grant execute on function public.kiosk_tag(text, text), public.kiosk_update(text, uuid, jsonb),
  public.kiosk_answer(text, uuid, text, jsonb), public.kiosk_list(text, int), public.kiosk_delete(text, uuid)
  to anon, authenticated;
