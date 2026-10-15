# -*- coding: utf-8 -*-
"""在 MainActivity 上锁定横屏。"""
import io
p = r'D:\Projects\nichen\android\app\src\main\AndroidManifest.xml'
s = io.open(p, encoding='utf-8').read()
old = '            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode"\n            android:name=".MainActivity"'
new = '            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode"\n            android:name=".MainActivity"\n            android:screenOrientation="sensorLandscape"'
assert s.count(old) == 1
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('landscape locked')
