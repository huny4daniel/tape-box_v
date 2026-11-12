# 폰에 디버그 빌드를 깔고 실행한 뒤 로그를 본다.
#   .\debug.ps1            빌드 → 설치 → 실행 → 로그
#   .\debug.ps1 -NoBuild   이미 만든 APK로 설치부터
#   .\debug.ps1 -LogOnly   로그만 다시 보기
# 웹 화면은 PC 크롬에서 chrome://inspect 를 열면 'WebView in ...debug' 항목으로 들여다볼 수 있다.
# 화면 파일을 실시간으로 고치며 볼 때는 저장소 루트의 dev.bat (빌드·설치도 알아서 한다)
param([switch]$NoBuild, [switch]$LogOnly)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# SDK: local.properties 의 sdk.dir → ANDROID_HOME 순
$sdk = $env:ANDROID_HOME
if (Test-Path local.properties) {
    $line = Get-Content local.properties | Where-Object { $_ -match '^sdk\.dir=' } | Select-Object -First 1
    if ($line) { $sdk = ($line -replace '^sdk\.dir=', '') -replace '\\:', ':' -replace '\\\\', '\' }
}
if (-not $sdk -or -not (Test-Path $sdk)) { throw "안드로이드 SDK를 찾지 못했어요. local.properties 에 sdk.dir=경로 를 적어 주세요." }
$adb = Join-Path $sdk "platform-tools\adb.exe"

# JDK: 이 프로젝트의 Gradle(8.11)은 JDK 17~23에서 돈다. JAVA_HOME이 그보다 새 버전이면 17을 찾아 쓴다
function JdkMajor($home_) {
    $rel = Join-Path $home_ "release"
    if (-not (Test-Path $rel)) { return 0 }
    $v = (Select-String -Path $rel -Pattern 'JAVA_VERSION="(\d+)' | Select-Object -First 1).Matches.Groups[1].Value
    return [int]$v
}
if (-not $LogOnly -and -not $NoBuild) {
    $jdk = $env:JAVA_HOME
    $major = if ($jdk) { JdkMajor $jdk } else { 0 }
    if ($major -lt 17 -or $major -gt 23) {
        $cand = Get-ChildItem "C:\DevTools\Java", "C:\Program Files\Java", "C:\Program Files\Eclipse Adoptium", "C:\Program Files\Zulu" -Directory -ErrorAction SilentlyContinue |
            Where-Object { $m = JdkMajor $_.FullName; $m -ge 17 -and $m -le 23 } | Sort-Object Name -Descending | Select-Object -First 1
        if (-not $cand) { throw "JDK 17~23이 필요해요 (지금 JAVA_HOME: $jdk)." }
        $env:JAVA_HOME = $cand.FullName
    }
    Write-Host "JDK: $env:JAVA_HOME"
}

$devices = & $adb devices | Select-Object -Skip 1 | Where-Object { $_ -match '\tdevice$' }
if (-not $devices) { throw "연결된 폰이 없어요. USB 디버깅을 켜고 연결하거나, 무선 디버깅이면 먼저: $adb pair <IP:포트> → $adb connect <IP:포트>" }
# 같은 폰이 무선 디버깅 주소와 mDNS 이름으로 두 번 잡히면 adb가 기기를 못 고르니 첫 번째로
if (-not $env:ANDROID_SERIAL) { $env:ANDROID_SERIAL = (($devices | Select-Object -First 1) -split "\t")[0] }
& $adb reverse tcp:8655 tcp:8655 | Out-Null   # 디버그 앱이 PC 개발 서버(dev.bat)의 화면 파일을 받도록

$pkg = "io.github.huny4daniel.musiccollection.debug"
if (-not $LogOnly) {
    if (-not $NoBuild) {
        # 안드로이드 빌드 도구는 경로에 한글이 있으면 거부한다 ("바탕 화면") → 빈 드라이브 글자에 잠깐 연결해 영문 경로로 빌드
        $root = Split-Path $PSScriptRoot -Parent
        $drive = $null
        if ($root -match '[^\x00-\x7F]') {
            $drive = [char[]]([int][char]'T'..[int][char]'Z') | Where-Object { -not (Test-Path "$($_):\") } | Select-Object -First 1
            if (-not $drive) { throw "연결할 빈 드라이브 글자(T~Z)가 없어요." }
            subst "$($drive):" $root
            Push-Location "$($drive):\android"
        }
        try { .\gradlew.bat assembleDebug; $code = $LASTEXITCODE }
        finally { if ($drive) { Pop-Location; subst "$($drive):" /D } }
        if ($code) { throw "빌드 실패" }
    }
    & $adb install -r app\build\outputs\apk\debug\app-debug.apk
    if ($LASTEXITCODE) { throw "설치 실패" }
    & $adb shell am start -n "$pkg/io.github.huny4daniel.musiccollection.MainActivity" | Out-Null
    Start-Sleep -Seconds 2
}

# 이 앱 프로세스의 로그만 (웹 화면의 console.log 도 chromium 태그로 함께 나온다)
$appPid = (& $adb shell pidof $pkg).Trim()
if (-not $appPid) { throw "앱이 실행 중이 아니에요." }
Write-Host "로그 보기 (pid $appPid) — 끝내려면 Ctrl+C"
& $adb logcat -v color --pid=$appPid
