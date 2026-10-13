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
└── convention.md           # 협업 규칙의 기준 문서
```

관객용 통합 앱은 아직 없습니다. [웹캠·로봇 연동 실험](experiments/webcam-robot/README.md)은 로컬에서 실행할 수 있으며, 정지 이미지 인식과 임시 3D 부위 배치를 검증합니다. 실제 장비·최종 모델 검증은 진행 중입니다.

## 작업 시작

작업 전에 [convention.md](convention.md)를 읽습니다. 이슈 생성부터 PR까지의 절차와 모든 협업 규칙은 이 문서에서 관리합니다.

[AGENTS.md](AGENTS.md)와 [CLAUDE.md](CLAUDE.md)는 AI 도구가 기준 문서를 읽도록 하는 진입점입니다.

## 문서

- [프로젝트 구조와 통합 원칙](docs/architecture.md)
- [작업계획서 작성 양식](docs/work-plan-template.md)
- [에셋 관리 안내](assets/README.md)

기획·회의록은 Notion에서 관리하고, 코드 실행에 필요한 사양과 기술 결정은 이 저장소에 남깁니다.
