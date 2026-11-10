// 폰 앱: 라이브러리 스캔 + Media3 재생 + 내장 서버.
// 화면은 저장소 루트의 index.html·css·js 한 벌을 빌드할 때 assets/www로 복사해 WebView로 띄운다(PC 브라우저도 같은 파일).
plugins {
    id("com.android.application")
}

// 버전: -PreleaseVersionName=vX.Y.Z (깃 태그) → versionName X.Y.Z, versionCode X*10000+Y*100+Z. 없으면 1.0.0
val releaseVersionName: String = (findProperty("releaseVersionName") as String?)?.removePrefix("v") ?: "1.0.0"
val releaseVersionCode: Int = releaseVersionName.split(".").map { it.takeWhile(Char::isDigit).toIntOrNull() ?: 0 }
    .let { (it.getOrElse(0) { 0 } * 10000) + (it.getOrElse(1) { 0 } * 100) + it.getOrElse(2) { 0 } }
    .coerceAtLeast(1)

// 서명: 아래 네 프로퍼티가 모두 있을 때만 release 서명 설정을 만든다 (로컬 assembleDebug에는 영향 없음)
val keystorePath = findProperty("releaseKeystorePath") as String?
val keystorePassword = findProperty("releaseKeystorePassword") as String?
val keyAliasName = findProperty("releaseKeyAlias") as String?
val keyPasswordValue = findProperty("releaseKeyPassword") as String?
val hasSigning = listOf(keystorePath, keystorePassword, keyAliasName, keyPasswordValue).all { !it.isNullOrBlank() }

val webAssetsDir = layout.buildDirectory.dir("generated/webAssets")
val syncWebAssets = tasks.register<Sync>("syncWebAssets") {
    val root = rootProject.projectDir.parentFile
    from(root) {
        include("index.html", "css/**", "js/**")
        exclude("js/mock.js")
    }
    into(webAssetsDir.map { it.dir("www") })
}

android {
    namespace = "io.github.huny4daniel.musiccollection"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.huny4daniel.musiccollection"
        minSdk = 29
        targetSdk = 35
        versionCode = releaseVersionCode
        versionName = releaseVersionName
    }

    if (hasSigning) {
        signingConfigs {
            create("release") {
                storeFile = file(keystorePath!!)
                storePassword = keystorePassword
                keyAlias = keyAliasName
                keyPassword = keyPasswordValue
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (hasSigning) signingConfig = signingConfigs.getByName("release")
        }
    }

    sourceSets["main"].assets.srcDir(webAssetsDir)

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.media3:media3-exoplayer:1.5.1")
    implementation("androidx.media3:media3-session:1.5.1")
    implementation("androidx.activity:activity:1.9.3")
    implementation("androidx.core:core:1.13.1")
    implementation("org.nanohttpd:nanohttpd:2.3.1")
}

tasks.named("preBuild") { dependsOn(syncWebAssets) }
tasks.matching { it.name.startsWith("merge") && it.name.endsWith("Assets") || it.name.startsWith("generate") && it.name.endsWith("Assets") }
    .configureEach { dependsOn(syncWebAssets) }
