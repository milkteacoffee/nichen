# -*- coding: utf-8 -*-
"""设置 APK 版本号与游戏版本一致。"""
import io
p = r'D:\Projects\nichen\android\app\build.gradle'
s = io.open(p, encoding='utf-8').read()
assert s.count('versionCode 1\n        versionName "1.0"') == 1
s = s.replace('versionCode 1\n        versionName "1.0"',
              'versionCode 2159\n        versionName "2.15.9"')
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('app version 2.15.9 (2159)')
