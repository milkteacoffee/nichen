# -*- coding: utf-8 -*-
import io
p = r'D:\Projects\nichen\tools\smoke.js'
s = io.open(p, encoding='utf-8').read()
a = "  try { fn(); } catch (e) { errors.push(`[${label}] ${e.message}`); }"
b = "  try { fn(); } catch (e) { errors.push(`[${label}] ${e.stack}`); }"
assert s.count(a) == 1
io.open(p, 'w', encoding='utf-8', newline='').write(s.replace(a, b))
print('stack on')
