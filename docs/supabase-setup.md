# Supabase 연결 안내

이 저장소는 Supabase를 데이터베이스로 사용합니다. 테이블 구조는 `supabase/migrations/`의 SQL 파일로 Git에서 관리하고, 원격 프로젝트에는 CLI로 반영합니다. 관련 이슈: #24

## 폴더

| 경로 | 내용 | 커밋 |
| --- | --- | --- |
| `supabase/config.toml` | CLI·로컬 개발 설정 (비밀 값 없음, 비밀은 `env()`로 참조) | O |
| `supabase/migrations/` | 테이블 구조 변경 SQL (테이블 설계 이슈에서 추가) | O |
| `supabase/.temp/` | `supabase link` 후 생기는 로컬 연결 정보 | X (`supabase/.gitignore`) |
| `.env` | 실제 키 값 | X (루트 `.gitignore`) |

## CLI 실행

전역 설치 없이 `npx`로 실행합니다. Node.js가 필요합니다.

```bash
npx supabase --version
```

Homebrew(`brew install supabase/tap/supabase`)로 설치해도 됩니다. 2026-11-24 기준 macOS 26에서 Command Line Tools가 오래되면 Homebrew 설치가 실패하므로, 그 경우 `npx`를 사용합니다.

## 처음 한 번: 로그인과 연결

각자 자기 맥에서 한 번 실행합니다. 로그인하면 브라우저가 열립니다.

```bash
npx supabase login
```

대시보드의 Project Settings → General에서 **Project ID(Reference ID)** 를 확인한 뒤 연결합니다. DB 비밀번호를 물으면 입력합니다(저장소에는 저장되지 않습니다).

```bash
npx supabase link --project-ref <Project ID>
```

연결이 되면 아래 명령이 오류 없이 마이그레이션 목록(처음에는 비어 있음)을 보여줍니다.

```bash
npx supabase migration list
```

## 키 관리

| 키 | 위치 | 브라우저 코드에 넣어도 되나 |
| --- | --- | --- |
| Project URL | `.env` / 앱 설정 | 예 |
| anon(publishable) 키 | `.env` / 앱 설정 | 예. 단 모든 테이블에 RLS를 켭니다 |
| service_role(secret) 키 | 서버·로컬 스크립트 전용 `.env` | **아니요** |
| DB 비밀번호 | 각자 기억 또는 비밀번호 관리자 | **아니요** |

필요한 키 이름은 루트 `.env.example`에 있습니다. 실제 값은 `.env`에 복사해 채웁니다.

## 이후 작업

- 저장할 데이터(설문 응답, 생성 이미지, `.glb` 등)를 정하고 테이블 설계 이슈에서 첫 마이그레이션을 추가합니다.
- 대시보드의 GitHub 연동(Branching)은 필요해지면 별도 이슈로 검토합니다.
