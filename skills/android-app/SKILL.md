---
name: android-app
description: Build, install, test and debug an Android app from its project folder (Gradle, adb, logcat) — use for any Android project.
---

# Building and testing an Android app

Work in the project (bind the conversation to it with `project bind`, or `project open` the folder first).

1. **Check the machine.** `project info` lists the Android commands and what is missing. What is missing is usually a row of Settings → System → System tools — propose it with `install_propose {kind: "tool"}`: `android-sdk` (the SDK, ~1 GB), `android-emulator`, `jdk11` / `jdk21` (Gradle toolchains in `~/.gradle/jdks`), `jdk`. Builds find the SDK through `ANDROID_HOME` (`~/Android/Sdk` on Linux). Gradle comes with the project's `gradlew`; a checkout on a drive without the executable bit runs as `sh ./gradlew`, and a repo with only `gradlew.bat` runs as `java -cp gradle/wrapper/gradle-wrapper.jar org.gradle.wrapper.GradleWrapperMain`.
2. **Build.** `project run build` (`./gradlew assembleDebug`). The APK lands in `app/build/outputs/apk/debug/`. A first build downloads Gradle and dependencies: expect minutes — it runs as a background job; follow it with `shell_job`.
3. **Unit tests.** `project run test` (`testDebugUnitTest`). Read failures from the output; the HTML report is in `app/build/reports/tests/`.
4. **A device.** `project run devices` (`adb devices -l`). None listed: ask the person to connect a phone with USB debugging, or start an emulator (`emulator -list-avds`, then `emulator -avd <name> &` as a background job).
5. **Install and run.** `project run install` (`installDebug`), then `adb shell monkey -p <applicationId> 1` to launch. The applicationId is in `app/build.gradle(.kts)`.
6. **Debug a crash.** `adb logcat -d -t 300 *:E` right after it happens; look for `FATAL EXCEPTION` and the first frame in the app's own package.
7. **Instrumented tests.** `project run device-test` (`connectedDebugAndroidTest`) needs a device.

## What has bitten before

- **Which Java.** Gradle 8.x does not run on Java 25: point `JAVA_HOME` at `~/.gradle/jdks/temurin-21`. A module's `jvmToolchain(11)` needs a JDK 11 Gradle can find (`jdk11` in System tools). A `gradle-daemon-jvm.properties` naming a vendor (`jetbrains`) without download URLs builds only where Android Studio is.
- **Google's tools report usage.** The command-line tools are the "Android CLI"; `sdkmanager` wraps it and uploads usage on every run. Use `cmdline-tools/latest/bin/android --no-metrics sdk install <pkg>` and `android --no-metrics emulator …`; platforms are named with their minor version (`platforms/android-37.0`). The CLI exits 0 on some errors: check what it made.
- **An emulator with no screen:** `emulator -avd <name> -no-window -no-boot-anim -gpu swiftshader_indirect` as a background job; wait for `adb shell getprop sys.boot_completed` = 1. Drive it: `adb shell uiautomator dump /sdcard/ui.xml`, read the node's `bounds`, `adb shell input tap X Y`; `adb exec-out screencap -p > shot.png` and look at it with `show_media`. Text inside a WebView or a link inside a paragraph is not its own node — tap by position.
- **The emulator reaches this machine as `10.0.2.2`.**
- **A WebView's microphone** needs `MODIFY_AUDIO_SETTINGS` as well as `RECORD_AUDIO` (logcat: `Requires MODIFY_AUDIO_SETTINGS and RECORD_AUDIO`).
- **Updates install only over the same signing key.** DOCA's own apps are built and handed out by the hub (panel: Field → API keys → DOCA apps, `POST /api/clients/apps/<app>/build`), signed with the key it keeps. Play Protect may ask to scan an app it has not seen — that is the person's choice.

Before reporting done: the build and unit tests passed (say what they printed), and if it was installed, that it launched. Never sign a release build or change signing config without the person.
