# NFC 카드별 체험자 정보

체험자마다 NFC 카드를 1장씩 나눠 주고, 키오스크 어디서든 카드를 태그하면 그 체험자의 정보를 불러옵니다. 관련 이슈: #37

## 동작

1. 키오스크(라즈베리파이 Chromium)에 꽂힌 리더기가 카드 UID를 키보드처럼 입력합니다(10자리 숫자 + Enter).
2. `app/card-reader.js`가 빠르게 이어진 숫자 + Enter를 카드 태그로 가로챕니다. 사람이 누른 숫자 키는 그대로 앱에 전달되므로 답변 선택·PIN 입력과 섞이지 않습니다.
3. `app/participants.js`가 Supabase 함수 `kiosk_tag`를 불러 체험자 정보를 받습니다. 처음 보는 카드는 다음 면접자 번호(NO17부터)로 자동 등록됩니다.
4. 화면 위쪽에 "NO18 홍길동님 정보를 불러왔어요"가 뜨고, 이후 직무·진행 단계·응답이 그 체험자에게 저장됩니다. 다른 키오스크에서 같은 카드를 태그하면 같은 정보가 나옵니다.

카드를 태그한 뒤 **면접 시작하기**를 누르면 새 면접자를 만들지 않고 태그한 체험자로 진행합니다. 카드 없이 시작하면 지금처럼 그 브라우저에만 기록됩니다.

체험자 정보를 불러온 뒤 화면을 어디로 보낼지(예: 키오스크마다 다른 섹션)는 아직 정하지 않았습니다. 앱은 태그마다 `stage`에 `participantload` 이벤트(detail = 체험자)를 보내므로, 흐름이 정해지면 이 이벤트에서 화면을 이동합니다.

## 저장하는 데이터

`supabase/migrations/20261124120000_participants.sql`

| 테이블 | 내용 |
| --- | --- |
| `participants` | 카드 UID(고유), 면접자 번호 `no`, 이름 `name`, 직무 `job`, 진행 단계 `stage`, 추가 정보 `profile`(JSON), 등록·마지막 태그 장치와 시각 |
| `participant_answers` | 응답 기록. 앱의 `answer` 이벤트(섹션, 문항 번호, 선택 번호, 로봇화 값, 질문·답 문구, 과제 결과)를 그대로 쌓습니다. 같은 질문을 다시 하면 새 행이 쌓이고 가장 최근 것이 유효합니다 |
| `private.kiosk_keys` | 키오스크 장치 키의 sha256과 장치 이름 |

이 문서는 #37 때의 내용입니다. #45부터는 입구에서 찍은 사진을 `participant_media`에 저장하고, 입구 등록·섹션 진행·로봇화 점수 테이블과 함수가 추가됐습니다. 지금 전체 구조는 [NFC 체험 데이터·처리 설계](nfc-data-design.md)를 봅니다. 이름·사진은 개인정보이므로 전시가 끝나면 지웁니다(삭제 절차는 따로 정함).

## 보안

브라우저 코드는 관객도 열어 볼 수 있으므로 다음처럼 막았습니다.

- 테이블은 RLS를 켜고 정책을 두지 않았습니다. anon 키로는 테이블을 직접 읽거나 쓸 수 없습니다.
- 키오스크는 `kiosk_tag`, `kiosk_update`, `kiosk_answer`, `kiosk_list`, `kiosk_delete` 함수로만 접근하고, 모든 함수가 **장치 키**를 확인합니다.
- 장치 키는 저장소에 넣지 않습니다. 각 파이의 키오스크 URL에만 두고, 앱은 처음 열 때 키를 브라우저에 기억한 뒤 주소창에서 지웁니다.
- `npx supabase db advisors --remote`는 `kiosk_*` 함수 5개를 "anon이 실행할 수 있는 SECURITY DEFINER 함수"로 경고합니다. 키오스크가 anon 키로 불러야 하므로 의도한 것이고, 각 함수는 장치 키부터 확인합니다. 이 밖의 경고가 새로 나오면 확인합니다.

## 설정

### 1. 테이블 만들기 (한 번, 2026-11-24 팀 프로젝트에 적용 완료)

[Supabase 연결 안내](supabase-setup.md)대로 `login`·`link`를 한 뒤 저장소 루트에서 실행합니다.

```bash
npx supabase db push --remote
```

### 2. 앱에 Supabase 주소 넣기 (팀 프로젝트 값으로 넣어 둠)

다른 프로젝트로 바꿀 때만 고칩니다. 대시보드 **Project Settings → API**의 Project URL과 anon(publishable) 키를 `app/config.js`에 넣습니다. 둘 다 공개돼도 되는 값입니다. service_role 키는 넣지 않습니다.

```js
window.APP_CONFIG = {
  SUPABASE_URL: 'https://<프로젝트 ID>.supabase.co',
  SUPABASE_ANON_KEY: '<anon 키>',
};
```

비워 두면 Supabase 없이 브라우저 localStorage에만 저장합니다(카드 태그도 그 브라우저 안에서만 동작).

### 3. 키오스크마다 장치 키 만들기

대시보드 **SQL Editor**에서 키오스크 하나당 한 번 실행합니다(또는 `npx supabase db query --remote "select private.new_kiosk_key('kiosk-1')"`). 결과로 나온 32자리 키는 이때만 보이므로 바로 옮겨 적습니다.

```sql
select private.new_kiosk_key('kiosk-1');
```

키를 잃어버리거나 바꾸려면 `delete from private.kiosk_keys where label = 'kiosk-1';` 후 다시 만듭니다.

### 4. 키오스크 URL에 장치 키 붙이기

파이에서 키오스크 주소 뒤에 `?kiosk=<장치 키>`를 붙여 한 번 엽니다. 이후에는 브라우저가 기억합니다(Chromium 프로필을 지우면 다시 필요).

```bash
~/kiosk.sh "https://2027-graduation-exhibition.vercel.app/kiosk?kiosk=<장치 키>"
```

입구(맥)는 `https://2027-graduation-exhibition.vercel.app/entrance?kiosk=<입구 키>`로 엽니다. 짧은 주소 `/entrance`·`/kiosk`는 각각 `/app/?mode=register`·`/app/?mode=kiosk`로 이동합니다(#53).

부팅할 때마다 같은 주소로 열려면 `~/kiosk.sh`의 `URL_DEFAULT`를 이 주소로 바꿉니다.

### 5. 확인

- 카드를 태그하면 화면 위에 안내가 뜹니다. "장치 키가 맞지 않아요"가 뜨면 3·4단계를 다시 확인합니다.
- 관리자설정(PIN) → 진행 중인 면접자에 카드 번호·응답 개수가 보이고, 이름을 입력해 저장할 수 있습니다. 면접자 목록은 모든 키오스크의 체험자를 보여 줍니다.
- 개발 중에는 콘솔에서 `CardReader.simulate('0000790572')`로 태그를 흉내 낼 수 있습니다.

## 인터넷이 끊길 때

- 태그(정보 불러오기)는 실패 안내를 띄우고, 다시 태그하면 됩니다.
- 이름·직무·단계·응답 저장은 실패하면 브라우저에 쌓아 두었다가 순서대로 다시 보냅니다(새로고침해도 유지).
- 장시간 인터넷이 없는 전시장이라면 [NFC 체험 데이터·처리 설계](nfc-data-design.md) 6절·10절대로 중앙 PC 로컬 서버안을 다시 검토합니다.
