-- 로봇화 점수: 문항 id(qid) 없는 예전 응답도 계산 (#45)
--
-- 20261125140000_robot_score.sql의 private.robot_score는 응답 detail의 qid로만 문항을 찾아서,
-- qid를 보내기 전 코드로 저장된 응답(예: 2026-11-25 NO17·18)은 가치관 문항이 빠지고
-- 직무 과제 점수만 남아 100%처럼 나왔다. 바꾸는 것:
--   - qid가 없으면 섹션과 문항 순서(detail.question)로 찾는다
--       가치관 0·1·2 → values-1·2·3, 3 → values-final,
--       4(꼬리 질문) → 그보다 앞선 최종 질문의 답(A·B·C)에 따라 values-tail-1·2·3
--   - 꼬리 질문은 가장 최근 최종 질문 답의 갈래만 센다(다시 진행해서 갈래가 바뀌면 예전 갈래의 꼬리 답은 뺌)
--   - 선택형 문항(가치관)이 하나도 계산되지 않으면 robot_percent는 null (앱은 브라우저 계산으로 대신)
-- 함수 이름·인자·권한은 그대로(create or replace).

create or replace function private.robot_score(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with ans as (      -- 응답마다 문항 id: qid가 있으면 그대로, 없으면 가치관 문항 순서로
    select a.id, a.section, a.detail,
           coalesce(a.detail ->> 'qid',
             case when a.section = 'values' and jsonb_typeof(a.detail -> 'question') = 'number' then
               case (a.detail ->> 'question')::int
                 when 0 then 'values-1' when 1 then 'values-2' when 2 then 'values-3' when 3 then 'values-final'
                 when 4 then (select 'values-tail-' || ((f.detail ->> 'choice')::int + 1)
                                from public.participant_answers f
                               where f.participant_id = p_id and f.section = 'values' and f.id < a.id
                                 and jsonb_typeof(f.detail -> 'choice') = 'number'
                                 and (f.detail ->> 'qid' = 'values-final'
                                      or (not f.detail ? 'qid' and f.detail ->> 'question' = '3'))
                               order by f.id desc limit 1)
               end
             end) as qid
      from public.participant_answers a
     where a.participant_id = p_id
  ), latest_all as ( -- 문항별 가장 최근 응답
    select distinct on (qid) qid, detail from ans where qid is not null order by qid, id desc
  ), latest as (     -- 꼬리 질문은 가장 최근 최종 질문 답의 갈래 하나만(다시 진행해서 갈래가 바뀐 경우)
    select l.qid, l.detail from latest_all l
     where l.qid not like 'values-tail-%'
        or l.qid = (select 'values-tail-' || ((f.detail ->> 'choice')::int + 1) from latest_all f
                     where f.qid = 'values-final' and jsonb_typeof(f.detail -> 'choice') = 'number')
  ), task as (       -- 직무 과제는 가장 최근 결과 하나
    select detail -> 'choice' as c from ans
     where section = 'fit' and jsonb_typeof(detail -> 'choice') = 'object'
     order by id desc limit 1
  ), parts as (
    select q.question_id, q.kind, q.label, q.weight, o.score, (l.detail ->> 'choice')::int as choice, q.sort
      from latest l
      join public.robot_score_questions q on q.question_id = l.qid and q.kind = 'choice'
      join public.robot_score_options o on o.question_id = q.question_id and o.choice = (l.detail ->> 'choice')::int
     where jsonb_typeof(l.detail -> 'choice') = 'number'
    union all
    select q.question_id, q.kind, q.label, q.weight, round(private.robot_task_ratio(t.c) * 100, 2), null, q.sort
      from public.robot_score_questions q cross join task t
     where q.kind = 'task' and private.robot_task_ratio(t.c) is not null
  )
  select jsonb_build_object(
    'robot_percent', (select case when bool_or(kind = 'choice') then round(sum(weight * score) / nullif(sum(weight), 0))::int end from parts),
    'weight_total',  (select coalesce(sum(weight), 0) from parts),
    'parts', coalesce((select jsonb_agg(jsonb_build_object('question_id', question_id, 'label', label, 'weight', weight,
                                                           'score', score, 'choice', choice) order by sort) from parts), '[]'::jsonb))
$$;
