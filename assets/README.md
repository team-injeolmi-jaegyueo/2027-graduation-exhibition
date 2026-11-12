# assets

프로그램 실행에 사용하는 모델, 텍스처, 이미지, 영상과 사운드를 관리합니다. 팀이 만든 실행용 파일은 모두 여기에 두고, `app/`과 `experiments/`는 경로로 불러와 씁니다(같은 파일을 두 곳에 두지 않음). 새 종류가 생기면 `audio/` 등 필요한 폴더를 추가합니다.

- 웹에서 사용하는 모델은 용량과 성능을 확인한 배포용 파일을 넣습니다. Maya 원본·고해상도 영상·중간 렌더는 별도 공유 저장소 또는 Git LFS로 관리합니다.
- GitHub는 일반 Git에서 100 MiB를 초과하는 파일을 차단합니다. 큰 파일을 추가하기 전에 보관 방식을 결정합니다.
- 외부 자료는 출처·라이선스·사용 범위를, 팀 제작 자료는 제작자·버전·원본 위치를 README에 기록합니다.
- 장비별 파일 경로를 코드에 고정하지 않습니다.
- 관객 사진과 인식 결과는 에셋에 포함하지 않습니다.

Git LFS는 아직 설정하지 않았습니다. 필요 파일 형식과 크기를 확인한 후 .gitattributes와 사용 방법을 함께 추가합니다.

참고: [GitHub 큰 파일 관리](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)

## 현재 파일

| 경로 | 내용 | 출처 | 쓰는 곳 |
| --- | --- | --- | --- |
| `images/` | 배경·캐릭터·UI 이미지(`home/`, `intro/`, `job/`, `popup/`, `hud/`, `room/`, `icons/`, `logo/`) | 팀 Figma 시안에서 내보낸 팀 제작 자료 | `app/index.html` |
| `images/robot.gif` | 면접 도우미 로봇 애니메이션(약 21MB) | 팀 제작 | `app/index.html` |
| `models/robot/robot.glb` | 3D 로봇, Blender로 만든 웹 배포용(약 1.1MB) | 팀 제작 | `app/index.html` 디자인·개발 과제 |
| `video/robot.webm`, `video/robot.mov` | 투명 배경 로봇 영상(Chrome용 VP9 / Safari용 HEVC) | 팀 제작 | `app/index.html` 면접대기실 |

`app/`에서는 `../assets/...` 경로로 불러옵니다. 그래서 서버는 저장소 루트에서 실행합니다(`python3 -m http.server 8137` → `http://localhost:8137/app/`).

