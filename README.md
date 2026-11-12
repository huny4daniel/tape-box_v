# tape-box 테이프 박스

폰에 저장된 mp3를 "수집한 작품"처럼 듣는 플레이어. 폰이 원본이고, 같은 Wi-Fi에 있는 PC는 브라우저로 폰에 접속해 듣고 재생목록을 편집한다.

## 구조

- `index.html`, `css/`, `js/`: 화면 한 벌. 폰 앱(WebView)과 PC 브라우저가 같은 파일을 쓴다.
  - `js/api.js`: 폰 내장 서버 API
  - `js/player.js`: 대기열·셔플. 소리는 폰에서는 Media3(NativeEngine), PC에서는 `<audio>`(WebEngine)가 낸다
  - `js/app.js`: 화면 전체 (홈, 나의 컬렉션, 앨범·아티스트, 소장품 카드, 재생목록, 검색, 가사·대기열)
- `pc/tape_player.py`: PC 프로그램 「테이프 박스」 (pywebview). 같은 Wi-Fi에서 폰을 찾아 폰이 내려주는 화면을 창으로 띄운다
  - `pc/lyricsync.py`: 싱크 가사 생성기의 설치·실행 관리. 고른 폴더 아래 `TapeBox-LyricSync`에 uv로 Python·PyTorch·모델을 따로 받는다 (exe에는 넣지 않음)
  - `pc/lyricsync_worker.py`: 그 환경에서 도는 생성기. 시간 정보 없는 가사의 곡을 보컬 분리(demucs) 후 Whisper(stable-ts)로 줄마다 시각을 맞춰 LRC로 만들어 `made/`에 남긴다
    - PC 폴더 방식: PC에 복사한 음원 파일의 태그를 직접 읽어 만든다(폰 불필요). 다 만든 뒤 「폰에 보내기」가 폰 곡 목록과 제목·아티스트·앨범·길이로 짝을 맞춰 폰 DB에 넣는다
    - 폰 방식: 폰에서 곡을 하나씩 받아 만들고 바로 저장한다. 연결이 끊기면 다시 붙을 때까지 기다린다
  - 지난번 주소를 먼저 확인하고, 없으면 PC의 사설 네트워크(가상 어댑터 제외)를 PC 주소와 가까운 순서로 훑어 8642 포트를 연 폰을 찾는다
  - 창의 쿠키를 `%APPDATA%\tape-player\webview`에 남겨 PIN은 처음 한 번만 넣는다
- `android/`: 폰 앱 (Java)
  - `Library`: MediaStore 스캔. 곡 id는 제목·아티스트·앨범·길이로 만든 고정 키
  - `FolderFilter`: 설정에서 끈 폴더(RELATIVE_PATH)는 스캔에서 뺀다. 처음 보는 폴더는 가장 가까운 상위 폴더 설정을, 없으면 「새 폴더 자동으로 넣기」를 따른다
  - `PlaylistImport`: 스캔할 때 다른 플레이어의 재생목록(MediaStore 재생목록, `.m3u`/`.m3u8`, 설정에서 고른 폴더의 삼성뮤직 `.smpl`)을 가져온다. 이 앱에서 고치거나 지우기 전까지는 원본 변경을 따라간다
  - `Db`: 수집 번호·재생 기록·아끼는 곡·메모·재생목록·PC가 만든 시간 가사 (SQLite). 컬렉션에서 빠진 곡의 기록도 남긴다
  - `Id3Lyrics`: ID3 태그의 SYLT/USLT 가사, USLT 안의 `[mm:ss.xx]` 시간 가사. PC가 만든 시간 가사(Db)가 있으면 그쪽을 먼저 쓴다
  - `ArtCache`: mp3에 든 앨범아트를 크기별 JPEG로 캐시
  - `WebServer`: 내장 서버 (포트 8642). 폰 밖의 요청은 「PC에서 접속」이 켜져 있고 PIN으로 짝을 맺은 브라우저만 받는다
  - `PlaybackService`: Media3 재생, 들은 시간·재생 횟수 기록
  - `ServerService`: PC 접속을 켜 둔 동안 Wi-Fi·CPU가 잠들지 않게 붙잡는 포그라운드 서비스

## 개발

- 폰·PC 함께 디버깅: 폰을 USB로 연결하고 `dev.bat` 더블클릭 → PC 브라우저에 실제 폰 데이터로 화면이 뜬다
  - 폰에 디버그 앱이 없거나 `android/`의 소스(Java 등)가 마지막 설치 이후 바뀌었으면 시작할 때 알아서 빌드·설치한다 (앱 데이터 유지)
  - 화면 파일을 저장하면 PC 브라우저와 폰 앱 화면이 함께 새로고침된다 (css만 바뀌면 스타일만 갈아 끼움)
  - `pc/devserver.py`(포트 8655)가 화면 파일은 저장소에서, `/api/`는 `adb forward`로 폰에서 가져온다. 폰 앱은 `adb reverse`로 같은 화면 파일을 읽는다 (개발 서버가 없으면 APK 사본)
  - 검사: PC 화면은 브라우저 F12, 폰 화면은 크롬 `chrome://inspect`
- 폰 앱: `cd android && ./gradlew assembleDebug` → `android/app/build/outputs/apk/debug/app-debug.apk`
  - 빌드할 때 루트의 웹 파일(`index.html`, `css/`, `js/`)이 `assets/www`로 복사된다
- PC 프로그램: `pip install -r pc/requirements.txt` 후 `python pc/tape_player.py`

## PC에서 접속

1. 폰 앱 → 라이브러리 → 설정 · 연결 → 「PC에서 접속」 켜기
2. PC에서 「테이프 박스」 실행 (릴리즈의 `tape-box_vX.Y.Z.zip`을 풀고 폴더 안 `tape-box.exe`) → 폰을 알아서 찾는다
   - 브라우저로 볼 때는 표시된 주소(`http://192.168.x.x:8642`, https 아님)를 직접 입력
3. 처음 한 번 PIN 6자리 입력
