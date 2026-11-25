-- 섹션별 진행 기록 (#45)
--
-- 체험자는 섹션(인성·직무적합성·가치관)이 시작하기 전마다 카드를 댄다. 지금은 키오스크 1대가 세 섹션을,
-- 최종 전시에서는 섹션마다 다른 키오스크가 맡으므로, 각 키오스크가 "이 사람이 어느 섹션을 시작·끝냈는지"를
-- 알 수 있게 participants.progress에 남긴다. kiosk_lookup 결과(to_jsonb)에 progress가 그대로 실린다.
--
-- progress 예: {"person": {"started_at": "…", "finished_at": "…", "device": "kiosk-1"}, "fit": {"started_at": "…"}}
-- 추가만 한다(기존 함수 영향 없음).

alter table public.participants
  add column progress jsonb not null default '{}'::jsonb check (jsonb_typeof(progress) = 'object');

-- 섹션 시작(p_event = 'start') / 끝(p_event = 'end') 기록.
-- start: 처음 시작한 시각은 유지(운영자가 되돌려 다시 해도), 단계(stage)를 그 섹션 이름으로
-- end:   끝낸 시각을 새 값으로
create function public.kiosk_section(p_key text, p_id uuid, p_section text, p_event text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  dev text := private.device_auth(p_key, array['kiosk', 'admin']);
  names constant jsonb := '{"person": "인성", "fit": "직무적합성", "values": "가치관"}';
  cur jsonb;
begin
  if not (names ? p_section) then
    raise exception 'section must be person, fit or values' using errcode = '22023';
  end if;
  if p_event not in ('start', 'end') then
    raise exception 'event must be start or end' using errcode = '22023';
  end if;

  select coalesce(progress -> p_section, '{}'::jsonb) into cur from public.participants where id = p_id for update;
  if not found then
    raise exception 'participant not found' using errcode = 'P0002';
  end if;

  if p_event = 'start' then
    cur := cur || jsonb_build_object('started_at', coalesce(cur -> 'started_at', to_jsonb(now())), 'device', dev);
  else
    cur := cur || jsonb_build_object('finished_at', now(), 'device', dev);
  end if;

  update public.participants
     set progress = progress || jsonb_build_object(p_section, cur),
         stage = case when p_event = 'start' then names ->> p_section else stage end,
         last_device = dev, updated_at = now()
   where id = p_id;
  return private.participant_json(p_id);
end $$;

revoke all on function public.kiosk_section(text, uuid, text, text) from public;
grant execute on function public.kiosk_section(text, uuid, text, text) to anon, authenticated;
