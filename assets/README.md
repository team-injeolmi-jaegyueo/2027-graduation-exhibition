# assets

프로그램 실행에 사용하는 모델, 텍스처, 이미지와 사운드를 관리합니다. 실제 파일이 생길 때 `models/`, `images/`, `audio/` 등 필요한 폴더를 추가합니다.

- 웹에서 사용하는 모델은 용량과 성능을 확인한 배포용 파일을 넣습니다. Maya 원본·고해상도 영상·중간 렌더는 별도 공유 저장소 또는 Git LFS로 관리합니다.
- GitHub는 일반 Git에서 100 MiB를 초과하는 파일을 차단합니다. 큰 파일을 추가하기 전에 보관 방식을 결정합니다.
- 외부 자료는 출처·라이선스·사용 범위를, 팀 제작 자료는 제작자·버전·원본 위치를 README에 기록합니다.
- 장비별 파일 경로를 코드에 고정하지 않습니다.
- 관객 사진과 인식 결과는 에셋에 포함하지 않습니다.

Git LFS는 아직 설정하지 않았습니다. 필요 파일 형식과 크기를 확인한 후 .gitattributes와 사용 방법을 함께 추가합니다.

참고: [GitHub 큰 파일 관리](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)
