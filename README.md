# 2027-graduation-exhibition

인절미와 재규어의 2027 졸업전시 프로젝트입니다. 작품명 변경과 관계없이 이 저장소에서 프로그램과 기술 실험을 함께 관리합니다.

## 체험 흐름

관객 촬영 → 면접 질문과 답변 → 부위별 로봇 변환 → 최종 판정과 결과 표시.

현재 기획은 웹캠으로 받은 **정지 이미지**를 사용합니다. 실시간 연속 추적은 초기 요구 사항에 포함하지 않습니다. 인식·합성 방식과 실행 프레임워크는 기술 검증 후 결정합니다.

## 폴더 구조

```text
2027-graduation-exhibition/
├── app/                    # 관객용 통합 프로그램
├── experiments/            # 웹캠 인식·로봇 변환 등 독립 기술 실험
├── assets/                 # 실행에 사용하는 모델·이미지·사운드
├── docs/                   # 작업계획·실행 안내·기술 결정
├── .github/ISSUE_TEMPLATE/ # 작업 및 버그 이슈 양식
├── .github/pull_request_template.md
└── CONTRIBUTING.md         # 협업 규칙
```

현재는 폴더 안내와 협업 양식만 있으며 실행 가능한 앱은 아직 없습니다. 설치·실행 명령은 실제 구현과 함께 각 폴더 README에 추가합니다.

## 작업 시작

1. [이슈](https://github.com/team-injeolmi-jaegyueo/2027-graduation-exhibition/issues)에서 목표와 완료 기준을 작성합니다.
2. 최신 main에서 작업 브랜치를 만듭니다.
3. 작은 단위로 커밋하고 작업 브랜치를 푸시합니다.
4. 이슈를 연결한 PR을 만들고 변경 사항과 검증 결과를 확인한 뒤 병합합니다.

세부 명명 규칙과 명령 예시는 [협업 규칙](CONTRIBUTING.md)을 참고하세요. AI 작업 지침은 [Codex](AGENTS.md)와 [Claude Code](CLAUDE.md)에 마련되어 있습니다.

## 문서

- [프로젝트 구조와 통합 원칙](docs/architecture.md)
- [작업계획서 작성 양식](docs/work-plan-template.md)
- [에셋 관리 안내](assets/README.md)

기획·회의록은 Notion에서 관리하고, 코드 실행에 필요한 사양과 기술 결정은 이 저장소에 남깁니다.
