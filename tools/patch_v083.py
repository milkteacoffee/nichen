# -*- coding: utf-8 -*-
"""v0.83.0：ns.js + HANDOVER（第五世薪火）。"""
import io

p1 = r'D:\Projects\nichen\www\js\core\ns.js'
s = io.open(p1, encoding='utf-8').read()
assert s.count("G.VERSION = 'v0.82.0';") == 1
s = s.replace("G.VERSION = 'v0.82.0';", "G.VERSION = 'v0.83.0';")
io.open(p1, 'w', encoding='utf-8', newline='').write(s)

p2 = r'D:\Projects\nichen\HANDOVER.md'
s = io.open(p2, encoding='utf-8').read()
old_h = "> 最后更新：2026-10-06 · 代码版本 **v0.82.0（第四世天伦 + 幼童立绘）** · 设计基线 **GDD v4.0（文档归档重构）** · 前一里程碑 v0.81.0"
new_h = "> 最后更新：2026-10-06 · 代码版本 **v0.83.0（第五世薪火）** · 设计基线 **GDD v4.0（文档归档重构）** · 前一里程碑 v0.82.0"
assert s.count(old_h) == 1
s = s.replace(old_h, new_h)

anchor = "> **【v0.82.0 第四世·天伦 + 幼童立绘 2026-10-06】**"
block = """> **【v0.83.0 第五世·薪火 2026-10-06】** 《诸世情感》批次 E-E2，**全量 smoke 归零、浏览器实测全链路**。
> arc5.js（dojo 主题）：开山收徒守一（default）、与散修景炎（keeper）结义，各 3 段日常（拆招讲功法/论道结义/古符）；大劫以「传逆命之道罪加一等」，三抉择（令弟子携功法先走/兄弟共抗/己身引劫）；景炎撞劫拦威尸骨无存，守一传道于师弟后含笑而逝；他第一次看见「一个人会朽，道不会」，对复活生出动摇——放手的种子埋下。regret=守一「传道玉简」，deathCause='lineage'。
> 实测 meta：arcs.done=[arc1..arc5]、regrets 5 件、两人 fate doomed 各 3 记忆、next=arc6。
>
"""
assert s.count(anchor) == 1
s = s.replace(anchor, block + anchor)
io.open(p2, 'w', encoding='utf-8', newline='').write(s)
print('version synced v0.83.0')
