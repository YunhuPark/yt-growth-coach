# 사용한 외부 소프트웨어

이 프로젝트가 쓰는 것들과 그 라이선스입니다. 패키지 목록은 `package.json`과 설치된 `node_modules/*/package.json`의 `license` 항목에서 옮겼습니다(버전은 작성 시점). 이 저장소 자체의 라이선스는 아직 정하지 않았습니다.

## 실행에 쓰는 패키지

| 패키지 | 버전 | 라이선스 | 쓰는 곳 |
|---|---|---|---|
| next, react, react-dom | 16.4.3, 19.3.0 | MIT | 웹 앱 |
| zod | 4.6.6 | MIT | 요청 검증 |
| @anthropic-ai/sdk | 0.133.0 | MIT | AI 기능(사용자의 API 키로만 호출) |
| @huggingface/transformers | 4.3.1 | Apache-2.0 | 내 컴퓨터에서 사람 찾기·음성 인식 실행 |
| music-tempo | 1.0.3 | MIT | 박자 찾기(BeatRoot 알고리즘) |
| ffmpeg-static | 5.3.0 | GPL-3.0-or-later | 영상 처리용 ffmpeg 실행 파일을 내려받아 둠 |

## 개발에만 쓰는 패키지

tailwindcss·@tailwindcss/turbopack(MIT), eslint·eslint-config-next(MIT), tsx(MIT), typescript(Apache-2.0), @types/*(MIT).

## ffmpeg에 대해

ffmpeg는 **별도의 프로그램으로 실행**할 뿐 이 프로젝트 코드에 링크하거나 이 저장소에 포함하지 않습니다. `ffmpeg-static`이 설치할 때 실행 파일을 내려받고, 패키지 정보에는 GPL-3.0-or-later로 적혀 있습니다. Docker 이미지는 Debian의 ffmpeg 패키지를 설치합니다. 이 프로젝트를 이미지나 실행 파일 형태로 **배포**하려면 ffmpeg 쪽 라이선스 조건(소스 제공 등)을 별도로 확인하세요. 이 문서는 법률 자문이 아닙니다.

## 모델 (처음 쓸 때 내려받아 `.data/models`에 저장, 저장소에는 없음)

- 사람·동물 찾기: `Xenova/yolos-tiny`
- 음성 인식(군말 찾기): `Xenova/whisper-small`

두 모델의 라이선스는 **여기서 확인하지 못했습니다**(내려받은 폴더에 모델 카드가 없음). 사용하거나 배포하기 전에 Hugging Face의 각 모델 페이지에서 확인하세요.

## 글꼴

Docker 이미지에는 `fonts-nanum`(SIL OFL로 알고 있으나 확인하지 않았습니다)을 설치합니다. Windows에서는 시스템에 있는 맑은 고딕·나눔고딕을 그대로 씁니다.

## 아이디어를 참고한 곳

시청 지속 분석의 "도입·급락·완만한 하락으로 나눠 보기"는 MIT 라이선스의 [youtube-agent-skill](https://github.com/Jakeschincariol/youtube-agent-skill)에서 아이디어를 얻었고 코드는 새로 작성했습니다.
