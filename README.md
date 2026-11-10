# 소장곡

폰에 저장된 mp3를 "수집한 작품"처럼 듣는 플레이어. 폰이 원본이고, 같은 Wi-Fi에 있는 PC는 브라우저로 폰에 접속해 듣고 재생목록을 편집한다.

## 구조

- `index.html`, `css/`, `js/`: 화면 한 벌. 폰 앱(WebView)과 PC 브라우저가 같은 파일을 쓴다.
  - `js/api.js`: 폰 내장 서버 API
  - `js/player.js`: 대기열·셔플. 소리는 폰에서는 Media3(NativeEngine), PC에서는 `<audio>`(WebEngine)가 낸다
  - `js/app.js`: 화면 전체 (홈, 나의 컬렉션, 앨범·아티스트, 소장품 카드, 재생목록, 검색, 가사·대기열)
  - `js/mock.js`: 폰 없이 화면을 확인할 때 쓰는 가짜 라이브러리 (`mock.html`)
- `pc/tape_player.py`: PC 프로그램 「나의 테이프」 (pywebview). 같은 Wi-Fi에서 폰을 찾아 폰이 내려주는 화면을 창으로 띄운다
  - 지난번 주소를 먼저 확인하고, 없으면 PC의 사설 네트워크(가상 어댑터 제외)를 PC 주소와 가까운 순서로 훑어 8642 포트를 연 폰을 찾는다
  - 창의 쿠키를 `%APPDATA%\tape-player\webview`에 남겨 PIN은 처음 한 번만 넣는다
- `android/`: 폰 앱 (Java)
  - `Library`: MediaStore 스캔. 곡 id는 제목·아티스트·앨범·길이로 만든 고정 키
  - `FolderFilter`: 설정에서 끈 폴더(RELATIVE_PATH)는 스캔에서 뺀다. 처음 보는 폴더는 가장 가까운 상위 폴더 설정을, 없으면 「새 폴더 자동으로 넣기」를 따른다
  - `PlaylistImport`: 스캔할 때 다른 플레이어의 재생목록(MediaStore 재생목록, `.m3u`/`.m3u8`, 설정에서 고른 폴더의 삼성뮤직 `.smpl`)을 가져온다. 이 앱에서 고치거나 지우기 전까지는 원본 변경을 따라간다
  - `Db`: 수집 번호·재생 기록·아끼는 곡·메모·재생목록 (SQLite). 컬렉션에서 빠진 곡의 기록도 남긴다
  - `Id3Lyrics`: ID3 태그의 SYLT/USLT 가사, USLT 안의 `[mm:ss.xx]` 시간 가사
  - `ArtCache`: mp3에 든 앨범아트를 크기별 JPEG로 캐시
  - `WebServer`: 내장 서버 (포트 8642). 폰 밖의 요청은 「PC에서 접속」이 켜져 있고 PIN으로 짝을 맺은 브라우저만 받는다
  - `PlaybackService`: Media3 재생, 들은 시간·재생 횟수 기록
  - `ServerService`: PC 접속을 켜 둔 동안 Wi-Fi·CPU가 잠들지 않게 붙잡는 포그라운드 서비스

## 개발

- 화면만 볼 때: 저장소 루트에서 `python -m http.server` 후 `http://localhost:8000/mock.html` (파일을 직접 열어도 된다)
- 폰 앱: `cd android && ./gradlew assembleDebug` → `android/app/build/outputs/apk/debug/app-debug.apk`
  - 빌드할 때 루트의 웹 파일이 `assets/www`로 복사된다 (`mock.html`, `mock.js` 제외)

- PC 프로그램: `pip install -r pc/requirements.txt` 후 `python pc/tape_player.py`

## PC에서 접속

1. 폰 앱 → 라이브러리 → 설정 · 연결 → 「PC에서 접속」 켜기
2. PC에서 「나의 테이프」(`tape-player_vX.Y.Z.exe`) 실행 → 폰을 알아서 찾는다
   - 브라우저로 볼 때는 표시된 주소(`http://192.168.x.x:8642`, https 아님)를 직접 입력
3. 처음 한 번 PIN 6자리 입력
