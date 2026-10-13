# 협업 안내

이 저장소의 협업 규칙은 [convention.md](convention.md)를 기준으로 합니다. 작업 전에 해당 문서를 읽습니다.

- 모든 파일 변경: 이슈 생성·확인 → 작업 브랜치 생성·확인 → 작업·검증 → 커밋·푸시 → PR
- 커밋 타입: feat, fix, design, refactor, docs, chore, test
- 브랜치: main(시연 기준), dev(개발 통합), feature/<이슈번호>-<설명>(일반 작업), codex/<이슈번호>-<설명>(Codex)
- 일반 PR 대상: dev. 시연 버전 반영은 dev → main
- 팀원 승인: 필수 아님. 작성자 검증 후 Squash and merge

현재는 초기 설정 단계이며 dev는 아직 생성하지 않았습니다. 기존 초기 설정 PR #4 → #2 → main 흐름과 이후 dev 생성 절차는 convention.md의 브랜치 항목을 참고합니다.

AI 프로젝트 지침은 [AGENTS.md](AGENTS.md)와 [CLAUDE.md](CLAUDE.md)에 있습니다. 자동 검사 도구와 GitHub 브랜치 보호는 아직 설정하지 않았습니다.
