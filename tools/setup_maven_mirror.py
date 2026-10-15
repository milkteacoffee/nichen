# -*- coding: utf-8 -*-
"""为 Android 工程配置国内 Maven 镜像（阿里云 google/public 代理，官方源兜底）。"""
import io
p = r'D:\Projects\nichen\android\build.gradle'
s = io.open(p, encoding='utf-8').read()

old = """    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath 'com.android.tools.build:gradle:8.2.1'"""
new = """    repositories {
        maven { url 'https://maven.aliyun.com/repository/google' }
        maven { url 'https://maven.aliyun.com/repository/public' }
        maven { url 'https://maven.aliyun.com/repository/gradle-plugin' }
        google()
        mavenCentral()
    }
    dependencies {
        classpath 'com.android.tools.build:gradle:8.2.1'"""
assert s.count(old) == 1
s = s.replace(old, new)

old2 = """allprojects {
    repositories {
        google()
        mavenCentral()
    }
}"""
new2 = """allprojects {
    repositories {
        maven { url 'https://maven.aliyun.com/repository/google' }
        maven { url 'https://maven.aliyun.com/repository/public' }
        google()
        mavenCentral()
    }
}"""
assert s.count(old2) == 1
s = s.replace(old2, new2)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('maven mirrors configured')
