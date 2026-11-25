-- 로봇화 점수 계산 시험 (#45, migrations/20261125140000_robot_score.sql)
--
-- 점수표 문서의 "결과 예시"와 같은 답을 넣고 같은 %가 나오는지 본다. 점수표 값을 바꾸면 기대값도 바뀐다.
-- 한 트랜잭션 안에서 시험용 장치 키·체험자를 만들고 끝에 rollback 하므로 데이터가 남지 않는다.
--
-- 로컬:   cd supabase/tests && npm install && npm test
-- 팀 DB:  npx supabase db query --remote --yes -f supabase/tests/robot_score.test.sql
-- 실패하면 오류로 멈추고, 통과하면 'ALL CHECKS PASSED' notice가 나온다.

begin;

create function pg_temp.ok(p_label text, p_cond boolean) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FAIL: %', p_label; end if;
  raise notice 'ok  %', p_label;
end $$;

create function pg_temp.expect_err(p_label text, p_sql text, p_code text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL: % (오류가 나지 않음)', p_label;
exception when others then
  if sqlstate = 'P0001' and sqlerrm like 'FAIL:%' then raise; end if;
  if sqlstate <> p_code then raise exception 'FAIL: % (기대 %, 실제 % %)', p_label, p_code, sqlstate, sqlerrm; end if;
  raise notice 'ok  % → %', p_label, sqlstate;
end $$;

-- 앱이 보내는 것과 같은 모양의 응답 1건
create function pg_temp.ans(p_key text, p_id uuid, p_qid text, p_choice int) returns void language sql as $$
  select null::void from (select public.kiosk_answer(p_key, p_id, split_part(p_qid, '-', 1),
    jsonb_build_object('qid', p_qid, 'choice', p_choice))) x
$$;

do $test$
declare
  seq_last bigint; seq_called boolean;
  ids uuid[] := '{}';
  reg text; kio text; adm text;
  a uuid; b uuid; c uuid; d uuid; e uuid;
  s jsonb;
begin
  select last_value, is_called into seq_last, seq_called from public.participant_no_seq;

  begin
    reg := private.new_device_key('test-score-register', 'register');
    kio := private.new_device_key('test-score-kiosk', 'kiosk');
    adm := private.new_device_key('test-score-admin', 'admin');

    set local role anon;

    perform pg_temp.expect_err('anon은 점수표를 직접 못 읽음', 'select * from public.robot_score_options', '42501');
    perform pg_temp.expect_err('anon은 계산 함수를 직접 못 부름', format('select private.robot_score(%L)', gen_random_uuid()), '42501');

    a := (public.kiosk_register(reg, 'FFFF0000000500A1', 'dev')->>'id')::uuid;
    b := (public.kiosk_register(reg, 'FFFF0000000500A2', 'marketing')->>'id')::uuid;
    c := (public.kiosk_register(reg, 'FFFF0000000500A3', 'hr')->>'id')::uuid;
    d := (public.kiosk_register(reg, 'FFFF0000000500A4', 'design')->>'id')::uuid;
    e := (public.kiosk_register(reg, 'FFFF0000000500A5', 'biz')->>'id')::uuid;
    ids := array[a, b, c, d, e];

    -- 권한
    perform pg_temp.expect_err('등록 키로 점수 조회 불가', format('select public.kiosk_score(%L, %L)', reg, a), '42501');
    perform pg_temp.expect_err('잘못된 키', format('select public.kiosk_score(%L, %L)', 'nope', a), '28000');
    perform pg_temp.expect_err('없는 체험자', format('select public.kiosk_score(%L, %L)', kio, gen_random_uuid()), 'P0002');

    s := public.kiosk_score(kio, a);
    perform pg_temp.ok('응답이 없으면 robot_percent는 null', s->'robot_percent' = 'null'::jsonb and s->'parts' = '[]');

    -- A: 거부하다 마지막에 굴복 + 개발 2/3 → 55% (지금 방식 25%)
    perform pg_temp.ans(kio, a, 'person-1', 0);         -- 인성은 점수표에 없음 → 무시
    perform pg_temp.ans(kio, a, 'values-1', 1);         -- 30
    perform pg_temp.ans(kio, a, 'values-2', 2);         -- 30
    perform pg_temp.ans(kio, a, 'values-3', 2);         -- 30
    perform pg_temp.ans(kio, a, 'values-final', 2);     -- 0 × 0.5
    perform pg_temp.ans(kio, a, 'values-tail-3', 1);    -- 100 × 2
    perform public.kiosk_answer(kio, a, 'fit', '{"choice": {"type": "dev", "home": 2, "total": 3, "crashes": 1}}');
    s := public.kiosk_score(kio, a);
    perform pg_temp.ok('거부하다 굴복 → 55%', (s->>'robot_percent')::int = 55);
    perform pg_temp.ok('가중치 합 6.5, 문항 6개', (s->>'weight_total')::numeric = 6.5 and jsonb_array_length(s->'parts') = 6);
    perform pg_temp.ok('개발 과제 2/3 → 66.67점', exists (select 1 from jsonb_array_elements(s->'parts') p
                                                         where p->>'question_id' = 'fit-task' and (p->>'score')::numeric = 66.67));
    perform pg_temp.ok('관리자 키로도 조회', (public.kiosk_score(adm, a)->>'robot_percent')::int = 55);

    -- 같은 문항을 다시 답하면 가장 최근 것만: values-1 30 → 100 이면 (356.67 + 70) / 6.5 = 65.6 → 66%
    perform pg_temp.ans(kio, a, 'values-1', 3);
    perform pg_temp.ok('다시 답하면 최근 응답 기준 → 66%', (public.kiosk_score(kio, a)->>'robot_percent')::int = 66);

    -- B: 순응하다 마지막에 저항 + 마케팅 1/2 → 58% (지금 방식 75%)
    perform pg_temp.ans(kio, b, 'values-1', 3);
    perform pg_temp.ans(kio, b, 'values-2', 0);
    perform pg_temp.ans(kio, b, 'values-3', 3);
    perform pg_temp.ans(kio, b, 'values-final', 0);     -- 50 × 0.5
    perform pg_temp.ans(kio, b, 'values-tail-1', 1);    -- 0 × 2
    perform public.kiosk_answer(kio, b, 'fit', '{"choice": {"type": "marketing", "success": 1, "total": 2, "clicks": 10}}');
    perform pg_temp.ok('순응하다 저항 → 58%', (public.kiosk_score(kio, b)->>'robot_percent')::int = 58);

    -- C: 조건부 순응 + 인사 1/3 (실패해서 1주에 끝남, success는 boolean) → 76% (지금 방식 100%)
    perform pg_temp.ans(kio, c, 'values-1', 2);
    perform pg_temp.ans(kio, c, 'values-2', 1);
    perform pg_temp.ans(kio, c, 'values-3', 0);
    perform pg_temp.ans(kio, c, 'values-final', 1);
    perform pg_temp.ans(kio, c, 'values-tail-2', 1);
    perform public.kiosk_answer(kio, c, 'fit', '{"choice": {"type": "hr", "weeksOk": 1, "total": 3, "sick": 2, "success": false}}');
    perform pg_temp.ok('조건부 순응 → 76%', (public.kiosk_score(kio, c)->>'robot_percent')::int = 76);

    -- D: 끝까지 저항 + 디자인 0/3 → 0%
    perform pg_temp.ans(kio, d, 'values-1', 0);
    perform pg_temp.ans(kio, d, 'values-2', 3);
    perform pg_temp.ans(kio, d, 'values-3', 1);
    perform pg_temp.ans(kio, d, 'values-final', 2);
    perform pg_temp.ans(kio, d, 'values-tail-3', 0);
    perform public.kiosk_answer(kio, d, 'fit',
      '{"choice": {"type": "design-color", "approved": 0, "rounds": [{"match": 40, "pass": false}, {"match": 50, "pass": false}, {"match": 60, "pass": false}]}}');
    perform pg_temp.ok('끝까지 저항 → 0%', (public.kiosk_score(kio, d)->>'robot_percent')::int = 0);
    -- 디자인 과제를 다시 해서 2/3 승인 → 최근 과제 결과만: 66.67 / 6.5 = 10.3 → 10%
    perform public.kiosk_answer(kio, d, 'fit',
      '{"choice": {"type": "design-color", "approved": 2, "rounds": [{"match": 90, "pass": true}, {"match": 70, "pass": false}, {"match": 95, "pass": true}]}}');
    perform pg_temp.ok('디자인 과제 다시 하면 최근 결과 → 10%', (public.kiosk_score(kio, d)->>'robot_percent')::int = 10);

    -- E: 끝까지 순응 + 경영 2/2 → 100%, 시간 초과(choice null)인 문항은 빠짐
    perform pg_temp.ans(kio, e, 'values-1', 3);
    perform pg_temp.ans(kio, e, 'values-2', null);      -- 시간 초과 → 계산에서 빠짐
    perform pg_temp.ans(kio, e, 'values-3', 3);
    perform pg_temp.ans(kio, e, 'values-final', 1);
    perform pg_temp.ans(kio, e, 'values-tail-2', 1);
    perform public.kiosk_answer(kio, e, 'fit', '{"choice": {"type": "biz", "success": 2, "total": 2}}');
    perform pg_temp.ok('시간 초과 문항은 빠지고 순응 → 100%', (public.kiosk_score(kio, e)->>'robot_percent')::int = 100
                         and (public.kiosk_score(kio, e)->>'weight_total')::numeric = 5.5);

    -- 점수표를 고치면 다시 계산한 값도 바뀜(대시보드에서 고치는 경우)
    reset role;
    update public.robot_score_questions set weight = 0 where question_id = 'fit-task';
    perform pg_temp.ok('직무 과제 가중치 0이면 A는 (100+30+30+0+200)/5.5 = 65%', (private.robot_score(a)->>'robot_percent')::int = 65);
    update public.robot_score_questions set weight = 1 where question_id = 'fit-task';

    -- 모양을 모르는 과제 결과는 무시
    perform pg_temp.ok('과제 결과 모양이 이상하면 null', private.robot_task_ratio('{"type": "dev"}') is null
                         and private.robot_task_ratio('"x"') is null
                         and private.robot_task_ratio('{"type": "dev", "home": 5, "total": 3}') = 1);
  exception when others then
    reset role;
    perform setval('public.participant_no_seq', seq_last, seq_called);
    raise;
  end;

  declare other_max int;
  begin
    select max(no) into other_max from public.participants where not (id = any (ids));
    if other_max is not null and other_max >= seq_last then
      perform setval('public.participant_no_seq', other_max, true);
    else
      perform setval('public.participant_no_seq', seq_last, seq_called);
    end if;
  end;
  raise notice 'ALL CHECKS PASSED';
end $test$;

rollback;
