# -*- coding: utf-8 -*-
"""一次性补丁：smoke.js 中存档版本断言 10 → 11（v11 = arcs 情感主线）。"""
import io

p = r'D:\Projects\nichen\tools\smoke.js'
s = io.open(p, encoding='utf-8').read()
reps = [
    ("if (mig.version !== 10 || !Array.isArray(mig.beasts) || mig.riding !== null || !mig.rideSkill) {",
     "if (mig.version !== 11 || !Array.isArray(mig.beasts) || mig.riding !== null || !mig.rideSkill) {"),
    ("if (migM.version !== 10 || !migM.bestiary) errors.push('v6→v7 meta 迁移缺图鉴字段');",
     "if (migM.version !== 11 || !migM.bestiary) errors.push('v6→v7 meta 迁移缺图鉴字段');"),
    ("if (meta.version !== 10) e2.push('迁移后版本应为 10');",
     "if (meta.version !== 11) e2.push('迁移后版本应为 11');"),
    ("check(old.homeOwned === true && old.version === 10 && old.stone === 12, '旧档洞府迁移损失');",
     "check(old.homeOwned === true && old.version === 11 && old.stone === 12, '旧档洞府迁移损失');"),
]
for a, b in reps:
    assert s.count(a) == 1, a
    s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('patched')
