import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// local.properties holds this computer's settings; the environment holds GitHub Actions' secrets.
// Neither is committed. A setting is empty when it is in neither, and the build still runs.
val localProps = Properties().apply {
    rootProject.file("local.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) }
}
fun setting(name: String, fallback: String = ""): String =
    providers.environmentVariable(name).orNull ?: localProps.getProperty(name, fallback)

android {
    namespace = "com.glasslauncher.tv"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.glasslauncher.tv"
        minSdk = 26
        targetSdk = 35
        // Own release line, separate from upstream's 3.x: this fork starts at 1.0.0.
        versionCode = 4
        versionName = "1.0.3"
        // Two languages ship: English (source) and German (complete). Everything else is stripped.
        androidResources { localeFilters += listOf("en", "de") }
        // TV boxes are ARM: the depth model's native library only for those (keeps the download small).
        ndk { abiFilters += listOf("armeabi-v7a", "arm64-v8a") }
        // Trakt app (PKCE, no secret), Nuvio and Simkl ids, all optional.
        buildConfigField("String", "TRAKT_CLIENT_ID", "\"${setting("TRAKT_CLIENT_ID")}\"")
        buildConfigField("String", "NUVIO_ANON_KEY", "\"${setting("NUVIO_ANON_KEY")}\"")
        buildConfigField("String", "SIMKL_CLIENT_ID", "\"${setting("SIMKL_CLIENT_ID")}\"")
    }
    // The release key comes from local.properties (this computer) or the environment (GitHub Actions).
    // Without either, the debug key is used, so a build never fails.
    val releaseStore = setting("GLASSIO_STORE_FILE")
    val releaseStorePassword = setting("GLASSIO_STORE_PASSWORD")
    val releaseKeyAlias = setting("GLASSIO_KEY_ALIAS", "glassio")
    val releaseKeyPassword = setting("GLASSIO_KEY_PASSWORD")
    signingConfigs {
        if (releaseStore.isNotBlank() && releaseStorePassword.isNotBlank() && releaseKeyPassword.isNotBlank()) {
            create("release") {
                storeFile = rootProject.file(releaseStore)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                this.keyPassword = releaseKeyPassword
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // One key for every release: only then can the TV install an update over the running copy.
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // NewPipe Extractor uses java.nio / java.time below Android 13.
        isCoreLibraryDesugaringEnabled = true
    }
    buildFeatures { compose = true; buildConfig = true }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    // Unit tests run on the computer (./gradlew testDebugUnitTest); Android calls return defaults there.
    testOptions { unitTests.isReturnDefaultValues = true }
}

kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.10.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.animation:animation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("io.coil-kt.coil3:coil-compose:3.3.0")
    implementation("io.coil-kt.coil3:coil-network-okhttp:3.3.0")
    implementation("io.coil-kt.coil3:coil-video:3.3.0")
    implementation("androidx.media3:media3-exoplayer:1.8.0")
    // Shuffle in other apps' music players (their MediaSessionCompat).
    implementation("androidx.media:media:1.7.0")
    implementation("androidx.media3:media3-ui:1.8.0")
    implementation("androidx.media3:media3-exoplayer-rtsp:1.8.0")
    implementation("androidx.media3:media3-exoplayer-hls:1.8.0")
    implementation("com.google.zxing:core:3.5.3")
    // Trailers played by GlassMyTV's own player (no YouTube page): finds the trailer's video and sound streams.
    implementation("com.github.teamnewpipe:NewPipeExtractor:v0.26.5")
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs_nio:2.1.5")
    implementation("dev.mobile:dadb:1.2.10")
    // Depth effect on photos: runs a small depth model (downloaded on first use) on the TV.
    implementation("com.google.ai.edge.litert:litert:1.4.0")
    implementation("androidx.profileinstaller:profileinstaller:1.4.1")
    testImplementation("junit:junit:4.13.2")
}
