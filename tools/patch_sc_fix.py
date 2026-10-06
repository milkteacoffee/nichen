# -*- coding: utf-8 -*-
import io
p = r'D:\Projects\nichen\tools\smoke.js'
s = io.open(p, encoding='utf-8').read()
a = "    const sc = G.game.scenes.ending;"
b = "    const sc = G.scenes.ending;"
assert s.count(a) == 1
io.open(p, 'w', encoding='utf-8', newline='').write(s.replace(a, b))
print('sc fixed')
