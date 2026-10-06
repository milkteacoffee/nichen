# -*- coding: utf-8 -*-
import io
p = r'D:\Projects\nichen\tools\smoke.js'
s = io.open(p, encoding='utf-8').read()
a = "if (!/self\\.step = 'grow'/.test(rcSrc)) {"
b = "if (!/(self|this)\\.step = 'grow'/.test(rcSrc)) {"
assert s.count(a) == 1
s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('regex fixed')
