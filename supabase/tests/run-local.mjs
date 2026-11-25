// supabase/migrations/*.sql 을 빈 PGlite(Postgres 17 WASM)에 순서대로 적용한 뒤
// 이 폴더의 *.test.sql 을 실행한다. Docker 없이 로컬에서 마이그레이션을 확인하려고 둔다 (#45)
//   cd supabase/tests && npm install && npm test
// Supabase에만 있는 것(anon·authenticated 역할, extensions 스키마)은 여기서 흉내 낸다.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migDir = join(here, '..', 'migrations');
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec('create role anon nologin; create role authenticated nologin; create schema extensions;');

for (const f of readdirSync(migDir).filter(f => f.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(join(migDir, f), 'utf8'));
  console.log('applied', f);
}

let failed = 0;
for (const f of readdirSync(here).filter(f => f.endsWith('.test.sql')).sort()) {
  console.log(`\n# ${f}`);
  try {
    await db.exec(readFileSync(join(here, f), 'utf8'), { onNotice: n => console.log(' ', n.message) });
  } catch (e) {
    failed++; console.error(' ', e.message);
    await db.exec('rollback').catch(() => {});
  }
}
// 시험은 rollback으로 끝나야 한다: 남은 행이 없고 번호 시퀀스도 처음 그대로인지
const left = (await db.query('select (select count(*) from public.participants)::int n, (select count(*) from private.kiosk_keys)::int k')).rows[0];
const seq = (await db.query('select last_value::int v, is_called c from public.participant_no_seq')).rows[0];
if (left.n || left.k || seq.v !== 17 || seq.c) { failed++; console.error('\n시험 뒤에 데이터가 남음', left, seq); }
else console.log('\n남은 데이터 없음, 번호 시퀀스 그대로(NO17부터)');
await db.close();
if (failed) { console.error(`\n${failed}개 시험 파일 실패`); process.exit(1); }
