/* 앱 설정 (#37)
 *
 * Supabase Project URL과 anon(publishable) 키는 브라우저에 공개돼도 되는 값이다
 * (테이블은 RLS로 막혀 있고, 키오스크 함수는 장치 키를 따로 확인한다).
 * service_role 키와 DB 비밀번호는 절대 여기에 넣지 않는다.
 *
 * 비워 두면 Supabase 없이 지금처럼 이 브라우저의 localStorage에만 저장한다.
 * 장치 키는 여기가 아니라 키오스크 URL에 붙인다: …/app/?kiosk=<장치 키>  (docs/nfc-participants.md)
 */
window.APP_CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
};
