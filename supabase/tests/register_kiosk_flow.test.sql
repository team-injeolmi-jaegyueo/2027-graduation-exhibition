-- 입구 등록 → 카드 → 키오스크 설문 시험 (#45)
--
-- 한 트랜잭션 안에서 시험용 장치 키·체험자를 만들고 끝에 rollback 하므로 데이터가 남지 않는다.
-- 면접자 번호 시퀀스는 rollback으로 되돌아가지 않아서, 시험 전 값으로 직접 되돌린다
-- (시험 중 다른 키오스크가 실제로 등록했으면 그 번호보다 뒤로).
--
-- 로컬(빈 Postgres에 마이그레이션 전부 적용 후):  cd supabase/tests && npm install && npm test
-- 팀 DB(마이그레이션 적용 후):                     npx supabase db query --remote -f supabase/tests/register_kiosk_flow.test.sql
-- 실패하면 오류로 멈추고, 통과하면 'ALL CHECKS PASSED' notice가 나온다.

begin;

create function pg_temp.ok(p_label text, p_cond boolean) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FAIL: %', p_label; end if;
  raise notice 'ok  %', p_label;
end $$;

-- p_sql을 실행해서 SQLSTATE p_code 오류가 나야 통과
create function pg_temp.expect_err(p_label text, p_sql text, p_code text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL: % (오류가 나지 않음)', p_label;
exception when others then
  if sqlstate = 'P0001' and sqlerrm like 'FAIL:%' then raise; end if;
  if sqlstate <> p_code then raise exception 'FAIL: % (기대 %, 실제 % %)', p_label, p_code, sqlstate, sqlerrm; end if;
  raise notice 'ok  % → %', p_label, sqlstate;
end $$;

do $test$
declare
  seq_last bigint; seq_called boolean;
  ids uuid[] := '{}';
  legacy text; reg text; kio text; adm text;
  uid1 constant text := 'FFFF000000045A01';   -- 실제 카드와 겹치지 않을 시험용 UID
  uid2 constant text := 'FFFF000000045A02';
  photo constant text := 'data:image/jpeg;base64,' || repeat('A', 1000);
  t jsonb; r1 jsonb; r2 jsonb; l jsonb; m jsonb; f jsonb; lst jsonb;
begin
  select last_value, is_called into seq_last, seq_called from public.participant_no_seq;

  begin
    legacy := private.new_kiosk_key('test-45-legacy');
    reg    := private.new_device_key('test-45-register', 'register');
    kio    := private.new_device_key('test-45-kiosk', 'kiosk');
    adm    := private.new_device_key('test-45-admin', 'admin');
    perform pg_temp.expect_err('역할 이름 검사', format('select private.new_device_key(%L, %L)', 'test-45-x', 'legacy'), '22023');

    set local role anon;   -- 여기부터 브라우저(anon 키)와 같은 권한

    -- 배포 사이트(기존 함수) 흐름이 그대로인지
    t := public.kiosk_tag(legacy, uid1); ids := ids || (t->>'id')::uuid;
    perform pg_temp.ok('기존 kiosk_tag는 처음 보는 카드를 자동 등록', (t->>'is_new')::boolean and t->'registered_at' = 'null'::jsonb);
    perform pg_temp.expect_err('anon은 테이블을 직접 못 읽음', 'select * from public.participants', '42501');
    perform pg_temp.expect_err('anon은 사진 테이블을 직접 못 읽음', 'select * from public.participant_media', '42501');
    perform pg_temp.expect_err('anon은 private 함수를 직접 못 부름', format('select private.new_device_key(%L, %L)', 'x', 'kiosk'), '42501');

    -- 역할 검사
    perform pg_temp.expect_err('기존(legacy) 키로 등록 불가', format('select public.kiosk_register(%L, %L, %L)', legacy, uid2, 'design'), '42501');
    perform pg_temp.expect_err('키오스크 키로 등록 불가', format('select public.kiosk_register(%L, %L, %L)', kio, uid2, 'design'), '42501');
    perform pg_temp.expect_err('등록 키로 조회 불가', format('select public.kiosk_lookup(%L, %L)', reg, uid1), '42501');
    perform pg_temp.expect_err('등록 키로 완료 불가', format('select public.kiosk_finish(%L, %L, %L)', reg, t->>'id', '{}'), '42501');
    perform pg_temp.expect_err('잘못된 키', format('select public.kiosk_lookup(%L, %L)', 'nope', uid1), '28000');

    -- 입력 검사
    perform pg_temp.expect_err('직무 없이 등록 불가', format('select public.kiosk_register(%L, %L, %L)', reg, uid2, '  '), '22023');
    perform pg_temp.expect_err('잘못된 카드 UID', format('select public.kiosk_register(%L, %L, %L)', reg, '!!', 'design'), '22023');
    perform pg_temp.expect_err('사진은 data:image/…;base64만', format('select public.kiosk_register(%L, %L, %L, %L)', reg, uid2, 'dev', 'hello'), '23514');
    perform pg_temp.expect_err('profile은 객체만', format('select public.kiosk_register(%L, %L, %L, null, null, %L)', reg, uid2, 'dev', '[1]'), '22023');

    -- 자동 등록된(입구를 거치지 않은) 카드는 키오스크에서 조회되지 않음
    perform pg_temp.expect_err('입구 등록 안 한 카드는 조회 불가', format('select public.kiosk_lookup(%L, %L)', kio, uid1), 'P0002');
    perform pg_temp.expect_err('없는 카드 조회 불가', format('select public.kiosk_lookup(%L, %L)', kio, 'FFFF000000045A99'), 'P0002');

    -- 입구 등록: 이미 연결된 카드(uid1)를 재사용
    r1 := public.kiosk_register(reg, uid1, 'design', photo); ids := ids || (r1->>'id')::uuid;
    perform pg_temp.ok('등록하면 새 체험자 + 등록 완료 단계', r1->>'id' <> t->>'id' and r1->>'stage' = '등록 완료' and r1->>'job' = 'design' and r1->'registered_at' <> 'null'::jsonb);
    perform pg_temp.ok('재사용 카드는 이전 체험자 번호를 알려 줌', (r1->>'released_no')::int = (t->>'no')::int);
    perform pg_temp.ok('사진이 저장됨', r1->'media' @> '[{"kind": "photo", "status": "ready", "has_data": true}]');
    perform pg_temp.ok('등록 결과에 사진 데이터는 안 실림', position('base64' in r1::text) = 0);

    -- 이름은 관리자가 나중에 입력(기존 kiosk_update)
    perform public.kiosk_update(adm, (r1->>'id')::uuid, '{"name": "시험"}');

    -- 사진 없이 등록(카메라 없음)
    r2 := public.kiosk_register(reg, uid2, ' dev ', null, '  '); ids := ids || (r2->>'id')::uuid;
    perform pg_temp.ok('사진 없이도 등록, 직무 앞뒤 공백 제거, 빈 이름은 null', r2->'media' = '[]' and r2->>'job' = 'dev' and r2->'name' = 'null'::jsonb and r2->'released_no' = 'null'::jsonb);

    -- 키오스크 조회
    l := public.kiosk_lookup(kio, uid1);
    perform pg_temp.ok('조회하면 재등록한 새 체험자가 나옴', l->>'id' = r1->>'id' and l->>'name' = '시험' and not (l->>'finished')::boolean);
    l := public.kiosk_lookup(kio, ' ffff:0000:0004:5a01 ');
    perform pg_temp.ok('UID 표기가 달라도 같은 카드', l->>'id' = r1->>'id');
    m := public.kiosk_media_get(kio, (r1->>'id')::uuid);
    perform pg_temp.ok('사진 받기', m->>'data' = photo and m->>'kind' = 'photo');
    perform pg_temp.ok('없는 생성물은 null', public.kiosk_media_get(kio, (r1->>'id')::uuid, 'model_3d') is null);

    -- 설문: 응답(기존 kiosk_answer) → 완료
    perform public.kiosk_answer(kio, (r1->>'id')::uuid, 'person', '{"question": 0, "choice": 1}');
    perform public.kiosk_answer(kio, (r1->>'id')::uuid, 'values', '{"question": 0, "choice": 2, "robot": 1}');
    perform pg_temp.expect_err('결과는 객체만', format('select public.kiosk_finish(%L, %L, %L)', kio, r1->>'id', '[1]'), '22023');
    perform pg_temp.expect_err('없는 체험자는 완료 불가', format('select public.kiosk_finish(%L, %L, %L)', kio, gen_random_uuid(), '{}'), 'P0002');
    f := public.kiosk_finish(kio, (r1->>'id')::uuid, '{"robot_percent": 60, "fit_percent": 70, "task": {"job": "design", "passed": true}}');
    perform pg_temp.ok('완료하면 결과·완료 시각·면접 완료 단계', (f->>'finished')::boolean and f->>'stage' = '면접 완료'
      and (f->'result'->>'fit_percent')::int = 70 and f->'finished_at' <> 'null'::jsonb and jsonb_array_length(f->'answers') = 2);
    l := public.kiosk_lookup(kio, uid1);
    perform pg_temp.ok('완료한 카드를 다시 대면 finished = true', (l->>'finished')::boolean and l->'result' = f->'result');

    -- 기존 함수가 새 칸·카드 뗀 체험자와 함께 잘 도는지
    lst := public.kiosk_list(legacy);
    perform pg_temp.ok('kiosk_list: 카드 뗀 이전 체험자는 card_uid 없음 + 이전 카드 기록',
      exists (select 1 from jsonb_array_elements(lst) e where e->>'id' = t->>'id'
                and e->'card_uid' = 'null'::jsonb and e->'profile'->>'prev_card_uid' = uid1));
    perform pg_temp.ok('kiosk_list: 응답 개수', exists (select 1 from jsonb_array_elements(lst) e where e->>'id' = r1->>'id' and (e->>'answer_count')::int = 2));
    t := public.kiosk_tag(legacy, uid1);
    perform pg_temp.ok('기존 kiosk_tag로 재등록 카드를 대면 새 체험자', t->>'id' = r1->>'id' and not (t->>'is_new')::boolean);
    perform pg_temp.ok('기존 kiosk_delete', public.kiosk_delete(legacy, (r2->>'id')::uuid));
    perform pg_temp.ok('삭제하면 사진도 함께', public.kiosk_media_get(kio, (r2->>'id')::uuid) is null);

    reset role;
  exception when others then
    reset role;
    perform setval('public.participant_no_seq', seq_last, seq_called);
    raise;
  end;

  -- 번호 시퀀스 되돌리기. 시험 중 다른 곳에서 실제로 등록한 번호가 있으면 그 뒤로
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
