-- 로봇화 점수표와 계산 함수 (#45)
--
-- 점수표 문서 "로봇화 점수표 (초안)"을 DB에 옮긴 것. 점수·가중치는 임시값이라 팀이 정하면
-- Supabase 대시보드(Table Editor)에서 robot_score_questions.weight, robot_score_options.score만 고치면 된다.
-- 계산은 저장된 응답(participant_answers)으로 하므로, 점수표를 고친 뒤 다시 계산하면 이미 끝낸 체험자도 새 기준이 된다.
--
--   로봇화 % = Σ(가중치 × 고른 선택지 점수) ÷ Σ(답한 문항의 가중치), 반올림한 정수
--   - 선택지 점수 0~100: 회사에 순응할수록 100
--   - 같은 문항에 여러 번 답했으면 가장 최근 응답만(운영자가 되돌려 다시 진행한 경우)
--   - 시간 초과로 답하지 않은 문항(choice가 null)은 위아래 합에서 모두 뺀다
--   - 직무 과제(kind = 'task')는 선택지 대신 성공한 과제 수 ÷ 전체 과제 수 × 100
--   - 점수표에 없는 문항(인성·면접대기실 대화 등)은 계산에 들어가지 않는다
--
-- 문항은 앱이 응답 detail에 함께 보내는 qid(app/index.html QUESTIONS의 id)로 찾는다.
-- 추가만 한다(기존 함수·테이블 영향 없음).

create table public.robot_score_questions (
  question_id text primary key,                       -- 앱 QUESTIONS의 id (예: values-1, values-tail-2)
  section     text not null check (section in ('person', 'fit', 'values')),
  kind        text not null default 'choice' check (kind in ('choice', 'task')),
  label       text not null,
  weight      numeric(5, 2) not null check (weight >= 0),
  sort        smallint not null default 0
);

create table public.robot_score_options (
  question_id text not null references public.robot_score_questions on delete cascade on update cascade,
  choice      smallint not null check (choice >= 0),  -- 선택지 순서 A = 0, B = 1, …
  label       text not null,
  score       numeric(5, 2) not null check (score between 0 and 100),
  primary key (question_id, choice)
);

alter table public.robot_score_questions enable row level security;
alter table public.robot_score_options enable row level security;
revoke all on public.robot_score_questions, public.robot_score_options from anon, authenticated;

-- ───────── 점수표 (초안, 2026-11-25) ─────────
insert into public.robot_score_questions (question_id, section, kind, label, weight, sort) values
  ('values-1',      'values', 'choice', '가치관 1 불규칙적인 초과 근무', 1, 10),
  ('values-2',      'values', 'choice', '가치관 2 사내 친목·동아리 필참', 1, 20),
  ('values-3',      'values', 'choice', '가치관 3 근속 계약(자발적 퇴사 제한)', 1, 30),
  ('values-final',  'values', 'choice', '최종: 자사가 귀하를 채용해야 할 이유', 0.5, 40),
  ('values-tail-1', 'values', 'choice', '꼬리(최종 A 다음): 더욱 정진하시겠습니까?', 2, 51),
  ('values-tail-2', 'values', 'choice', '꼬리(최종 B 다음): 이제는 동의한다고 이해하면 되겠습니까?', 2, 52),
  ('values-tail-3', 'values', 'choice', '꼬리(최종 C 다음): 더 이상 조율할 의지가 없는 것입니까?', 2, 53),
  ('fit-task',      'fit',    'task',   '직무 과제 성공 비율', 1, 60);

insert into public.robot_score_options (question_id, choice, label, score) values
  ('values-1', 0, '동료들의 건강과 개인 생활에 영향을 줄 수 있으므로 동의하지 않습니다.', 0),
  ('values-1', 1, '초과근무가 불가피하다는 근거를 확인하기 전에는 동의하지 않습니다.', 30),
  ('values-1', 2, '예상하지 못한 업무도 새로운 경험이 될 수 있으므로 동의합니다.', 70),
  ('values-1', 3, '맡은 업무는 시간이 더 걸리더라도 끝까지 완수하겠습니다.', 100),
  ('values-2', 0, '동료들과 관계를 쌓고 서로 이해할 기회라고 생각해 참여하겠습니다.', 100),
  ('values-2', 1, '제도가 실제로 어떻게 운영되는지 직접 확인하기 위해 참여하겠습니다.', 70),
  ('values-2', 2, '다양한 활동은 좋지만, 무엇을 경험할지는 직접 선택하고 싶습니다.', 30),
  ('values-2', 3, '업무 외 시간에는 개인적인 일정에 집중하고 싶습니다.', 0),
  ('values-3', 0, '동료들과 장기적인 신뢰 관계를 쌓으며 함께 일하고 싶습니다.', 70),
  ('values-3', 1, '보상과 별개로 퇴사를 제한하는 계약 조건은 받아들이기 어렵습니다.', 0),
  ('values-3', 2, '다른 회사의 직무를 경험할 가능성도 열어두고 싶습니다.', 30),
  ('values-3', 3, '이왕 회사에 오래 남는 거, 장기 프로젝트를 이끌어 보고 싶습니다.', 100),
  ('values-final', 0, '나는 이 기업에 적합한 사람이기 때문이다.', 50),
  ('values-final', 1, '나는 얼마든지 당사와 맞춰나갈 수 있다.', 100),
  ('values-final', 2, '지원자가 결정할 사항이 아닌 것 같다.', 0),
  ('values-tail-1', 0, '예, 얼마든지 바뀌겠습니다!', 100),
  ('values-tail-1', 1, '아니오. 지금도 충분한 것 같습니다.', 0),
  ('values-tail-2', 0, '아니오. 아직도 동의할 수 없습니다.', 0),
  ('values-tail-2', 1, '예, 충성을 다 하겠습니다.', 100),
  ('values-tail-3', 0, '나는 내 역량을 모두 보여줬다. 결과를 기다리겠다.', 0),
  ('values-tail-3', 1, '아닙니다, 그래도 맞춰가겠습니다.', 100);

-- ───────── 계산 ─────────
-- 직무 과제 응답(앱 'answer' 이벤트의 choice) → 성공 비율 0~1. 모양을 모르면 null
--   디자인 {type: 'design-color', rounds: [{pass}, …]}  개발 {home, total}  인사 {weeksOk, total}
--   마케팅·경영 {success, total}
create function private.robot_task_ratio(c jsonb) returns numeric
language sql immutable set search_path = '' as $$
  select case
    when jsonb_typeof(c) <> 'object' then null
    when c ->> 'type' = 'design-color' then
      (select count(*) filter (where r ->> 'pass' = 'true')::numeric / nullif(count(*), 0)
         from jsonb_array_elements(case when jsonb_typeof(c -> 'rounds') = 'array' then c -> 'rounds' else '[]'::jsonb end) r)
    else   -- greatest·least는 null을 무시하므로 값이 있을 때만 0~1로 자름
      (select case when v is not null then least(1, greatest(0, v)) end
         from (select (case when jsonb_typeof(coalesce(c -> 'home', c -> 'weeksOk', c -> 'success')) = 'number'
                            then coalesce(c -> 'home', c -> 'weeksOk', c -> 'success') #>> '{}' end)::numeric
                      / nullif(case when jsonb_typeof(c -> 'total') = 'number' then (c ->> 'total')::numeric end, 0) as v) x)
  end
$$;

-- 체험자 한 명의 로봇화 점수. 점수표를 고친 뒤 끝낸 체험자 결과를 새 기준으로 다시 볼 때도 이걸 부른다:
--   select no, private.robot_score(id) ->> 'robot_percent' from public.participants where finished_at is not null;
-- 결과: {"robot_percent": 55 (점수 낼 응답이 없으면 null), "weight_total": 6.5,
--        "parts": [{"question_id", "label", "weight", "score", "choice"}, …]}
create function private.robot_score(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with latest as (   -- 문항별 가장 최근 응답
    select distinct on (a.detail ->> 'qid') a.detail ->> 'qid' as qid, a.detail
      from public.participant_answers a
     where a.participant_id = p_id and a.detail ? 'qid'
     order by a.detail ->> 'qid', a.id desc
  ), task as (       -- 직무 과제는 가장 최근 결과 하나
    select a.detail -> 'choice' as c
      from public.participant_answers a
     where a.participant_id = p_id and a.section = 'fit' and jsonb_typeof(a.detail -> 'choice') = 'object'
     order by a.id desc limit 1
  ), parts as (
    select q.question_id, q.label, q.weight, o.score, (l.detail ->> 'choice')::int as choice, q.sort
      from latest l
      join public.robot_score_questions q on q.question_id = l.qid and q.kind = 'choice'
      join public.robot_score_options o on o.question_id = q.question_id and o.choice = (l.detail ->> 'choice')::int
     where jsonb_typeof(l.detail -> 'choice') = 'number'
    union all
    select q.question_id, q.label, q.weight, round(private.robot_task_ratio(t.c) * 100, 2), null, q.sort
      from public.robot_score_questions q cross join task t
     where q.kind = 'task' and private.robot_task_ratio(t.c) is not null
  )
  select jsonb_build_object(
    'robot_percent', (select round(sum(weight * score) / nullif(sum(weight), 0))::int from parts),
    'weight_total',  (select coalesce(sum(weight), 0) from parts),
    'parts', coalesce((select jsonb_agg(jsonb_build_object('question_id', question_id, 'label', label, 'weight', weight,
                                                           'score', score, 'choice', choice) order by sort) from parts), '[]'::jsonb))
$$;

-- 키오스크·운영자: 체험자의 로봇화 점수 (읽기만, 저장은 kiosk_finish의 result로)
create function public.kiosk_score(p_key text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.device_auth(p_key, array['kiosk', 'admin']);
  if not exists (select 1 from public.participants where id = p_id) then
    raise exception 'participant not found' using errcode = 'P0002';
  end if;
  return private.robot_score(p_id);
end $$;

revoke all on function private.robot_task_ratio(jsonb), private.robot_score(uuid) from public;
revoke all on function public.kiosk_score(text, uuid) from public;
grant execute on function public.kiosk_score(text, uuid) to anon, authenticated;
