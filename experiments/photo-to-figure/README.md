# 체험자 사진 → 토이 이미지 → Tripo 3D 모델

- 관련 이슈: #23
- 기존 #17의 "사진으로 미리 만든 아바타 꾸미기" 방식을 대체할 후보입니다.

## 검증할 질문

1. 체험자 사진 한 장과 마스터 토이 이미지로, 같은 컬렉션의 피규어처럼 보이는 전신 이미지를 GPT 이미지 API로 만들 수 있는가?
2. 그 이미지를 Tripo 이미지→3D로 변환해 전시에 쓸 만한 `.glb`가 나오는가?
3. 두 단계를 합쳐 면접 질문 시간(약 1–3분) 안에 끝나는가? 1인당 비용은 얼마인가?

## 흐름

```
체험자 사진 (Image 2) ─┐
마스터 토이 (Image 1) ─┼─▶ OpenAI 이미지 편집 (/v1/images/edits, prompt.txt) ─▶ figure.png (1024×1536)
                       ┘                                                          │
                     Tripo: 업로드(/v3/files) → 작업 생성(/v3/generation/image-to-model) → 상태 확인(/v3/tasks/{id}) ─▶ model.glb
```

- 사진 순서가 곧 프롬프트의 Image 1, Image 2입니다. 마스터를 먼저 보냅니다.
- Tripo 모델 URL은 5분 뒤 만료되므로 작업이 끝나면 바로 내려받습니다.
- 각 단계 시간, OpenAI 토큰 사용량, Tripo 크레딧을 `report.json`에 남깁니다.

## 준비

Node 22 이상. 설치할 패키지는 없습니다.

1. **API 키**: 이 폴더의 `.env.example`을 `.env`로 복사하고 키를 넣습니다. `.env`는 git에 올라가지 않습니다.
   - OpenAI: platform.openai.com에서 결제 등록 후 키 발급. ChatGPT 구독과는 별개입니다. GPT 이미지 모델은 조직 인증(Organization Verification)을 요구할 수 있습니다.
   - Tripo: developers.tripo3d.ai 콘솔에서 키 발급.
2. **마스터 이미지**: 저장소 루트의 `local-data/photo-to-figure/master.png`에 둡니다. `local-data/`는 git에 올라가지 않습니다. 출처·사용 범위를 확인하기 전에는 저장소에 넣지 않습니다.
3. **체험자 사진**: 팀원 사진처럼 공유 가능한 테스트 자료만 씁니다. 저장소에는 넣지 않습니다.

## 실행

저장소 루트에서:

```sh
# 전체 (이미지 + 3D)
node experiments/photo-to-figure/run.mjs --photo ~/Desktop/test-person.jpg

# 이미지만 (Tripo 크레딧 아끼며 프롬프트 다듬을 때)
node experiments/photo-to-figure/run.mjs --photo ~/Desktop/test-person.jpg --skip-3d

# 이미 만든 이미지로 3D만 (ChatGPT에서 만든 이미지와 비교할 때도)
node experiments/photo-to-figure/run.mjs --image ~/Desktop/figure.png
```

결과는 `experiment-output/photo-to-figure/<시각>/`에 저장됩니다 (git 제외).

| 파일 | 내용 |
| --- | --- |
| `figure.png` | GPT가 만든 토이 이미지 |
| `model.glb` | Tripo 3D 모델 |
| `tripo-preview.png` | Tripo가 렌더한 미리보기 |
| `report.json` | 단계별 소요 시간, 토큰 사용량, 크레딧 |

설정은 `.env`에서 바꿉니다 (`.env.example` 참고).

| 변수 | 기본값 | 비고 |
| --- | --- | --- |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2.6-sunburst` | API 문서의 현재 기본값. 가이드 예시는 `gpt-image-2.5-sunburst`. `gpt-image-1`은 2026-10-23 종료 |
| `OPENAI_IMAGE_QUALITY` | `high` | `low`·`medium`·`high`·`auto` |
| `TRIPO_MODEL` | `v3.1-20260211` | Tripo 문서 권장 최신 H 시리즈 |
| `TRIPO_TEXTURE_QUALITY` | `standard` | `fast`·`standard`·`detailed`·`extreme` (위로 갈수록 비쌈) |
| `TRIPO_TIMEOUT_SEC` | `300` | 이 시간 안에 안 끝나면 실패로 처리 |

테스트 (가짜 서버 사용, 실제 API·크레딧을 쓰지 않음):

```sh
cd experiments/photo-to-figure && node --test
```

## 앱 연동: 배지 얼굴을 AI 이미지로 (`server.mjs`)

면접 앱(`app/`)에서 촬영하면 그 사진으로 토이 이미지를 만들어, 섹션 화면 오른쪽 위 지원자 배지 얼굴을 바꿉니다.

```
촬영(photocaptured) ──▶ POST /api/figure { photo: data URL } ──▶ server.mjs → OpenAI ──▶ { image: data URL }
배지에 촬영 사진 착지 (변환 중: 얼굴 테두리에 초록 빛이 돎) ──▶ 완료되면 토이 이미지로 교체 (figureready)
```

- `server.mjs`는 저장소 루트의 정적 파일(앱·에셋)과 `/api/figure`를 함께 서빙합니다. `.env`·`local-data/`·`experiment-output/`·`node_modules/`는 서빙하지 않습니다.
- 사진은 서버 메모리에서만 쓰고 저장하지 않습니다.
- 실패하거나 서버가 없으면 촬영 사진을 그대로 둡니다. 다시 찍거나 처음으로 가면 이전 요청 결과는 버립니다.
- 배지 원 안에 머리가 오도록 전신 이미지(2:3)를 확대해 자릅니다. 마스터 이미지 구도 기준 값이며 `app/index.html`의 `--fig-zoom`(135%), `--fig-y`(13%)로 조정합니다.

```sh
# 저장소 루트에서
node experiments/photo-to-figure/server.mjs                # 실제 OpenAI (.env 키 필요)
FIGURE_MOCK=1 node experiments/photo-to-figure/server.mjs  # 키 없이: 5초 뒤 마스터 이미지
# → http://localhost:8137/app/  (PORT, FIGURE_MOCK_DELAY_MS 로 바꿀 수 있음)
```

## 관찰 결과

| 항목 | 결과 |
| --- | --- |
| 요청 형식·흐름 (가짜 서버: 사진 순서, 업로드→작업→상태 확인→내려받기, 실패·시간 초과·HTTP 오류) | `node --test` 6개 통과 |
| 키·사진이 없을 때 안내 후 종료 | 통과 |
| 앱 배지 교체 (모의 모드, 가짜 카메라): 촬영 → 착지 → 변환 중 표시 → 토이 이미지로 교체 | 통과 (Chromium, 1920×1080) |
| 서버 없음(python 서버)일 때 촬영 사진 유지 | 통과 |
| 서버가 `.env`·`local-data/`·상위 경로를 막는지 | 통과 (404) |
| 실제 OpenAI 이미지 생성 | **미검증** — API 키 필요 |
| ChatGPT 결과와 API 결과 비교 | **미검증** |
| 실제 Tripo 변환·`.glb` 품질 | **미검증** — API 키 필요 |
| 소요 시간·1인당 비용 | **미검증** |

## 한계 / 다음 결정

- 마스터 이미지가 356×509로 작습니다. 고해상도 원본이 있으면 결과가 좋아질 수 있습니다.
- 마스터 토이 디자인의 출처를 확인해야 합니다. 기존 상품이라면 전시 전 팀 오리지널 캐릭터로 바꾸는 것을 검토합니다.
- 체험자 사진이 외부 서비스(OpenAI, Tripo)로 전송됩니다. 전시장 안내 문구와 삭제 원칙이 필요합니다.
- 실제 전시에서는 API 키를 키오스크(브라우저)에 두지 않고 중앙 PC 서버에서만 호출합니다. 이 실험 스크립트는 그 서버의 핵심 로직이 됩니다.
- 생성된 모델은 뼈대가 없습니다. 로봇 부위 전환(#17)과 연결하려면 Tripo 리깅 또는 부위 분리 방식을 따로 검토해야 합니다.
- 인터넷이 끊기거나 생성이 실패하면 기본 캐릭터로 넘어가는 대체 흐름이 필요합니다.
