---
name: android-app
description: Build, install, test and debug an Android app from its project folder (Gradle, adb, logcat) — use for any Android project.
---

# Building and testing an Android app

Work in the project (bind the conversation to it with `project bind`, or `project open` the folder first).

1. **Check the machine.** `project info` lists the Android commands and what is missing. Without an SDK (`android-sdk` missing), say so and stop: the person installs Android Studio or the command-line tools and sets `ANDROID_HOME`. Java must be present; Gradle comes with the project's `gradlew`.
2. **Build.** `project run build` (`./gradlew assembleDebug`). The APK lands in `app/build/outputs/apk/debug/`. A first build downloads Gradle and dependencies: expect minutes — it runs as a background job; follow it with `shell_job`.
3. **Unit tests.** `project run test` (`testDebugUnitTest`). Read failures from the output; the HTML report is in `app/build/reports/tests/`.
4. **A device.** `project run devices` (`adb devices -l`). None listed: ask the person to connect a phone with USB debugging, or start an emulator (`emulator -list-avds`, then `emulator -avd <name> &` as a background job).
5. **Install and run.** `project run install` (`installDebug`), then `adb shell monkey -p <applicationId> 1` to launch. The applicationId is in `app/build.gradle(.kts)`.
6. **Debug a crash.** `adb logcat -d -t 300 *:E` right after it happens; look for `FATAL EXCEPTION` and the first frame in the app's own package.
7. **Instrumented tests.** `project run device-test` (`connectedDebugAndroidTest`) needs a device.

Before reporting done: the build and unit tests passed (say what they printed), and if it was installed, that it launched. Never sign a release build or change signing config without the person.
