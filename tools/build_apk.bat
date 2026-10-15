@echo off
rem 《逆尘》debug APK 一键构建脚本（Windows）
rem 前置：JDK17 在 C:\MyFiles\Development\JDK17，Android SDK 在 C:\Android\Sdk
set JAVA_HOME=C:\MyFiles\Development\JDK17
set ANDROID_HOME=C:\Android\Sdk
cd /d "%~dp0.."
call npx cap sync android
cd android
call gradlew.bat assembleDebug --no-daemon --console=plain
echo.
echo APK: android\app\build\outputs\apk\debug\app-debug.apk
