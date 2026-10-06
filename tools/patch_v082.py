# -*- coding: utf-8 -*-
"""v0.82.0：ns.js + HANDOVER（第四世天伦 + child 立绘）。"""
import io

p1 = r'D:\Projects\nichen\www\js\core\ns.js'
s = io.open(p1, encoding='utf-8').read()
assert s.count("G.VERSION = 'v0.81.0';") == 1
s = s.replace("G.VERSION = 'v0.81.0';", "G.VERSION = 'v0.82.0';")
io.open(p1, 'w', encoding='utf-8', newline='').write(s)

p2 = r'D:\Projects\nichen\HANDOVER.md'
s = io.open(p2, encoding='utf-8').read()
old_h = "> 最后更新：2026-10-06 · 代码版本 **v0.81.0（第三世道侣）** · 设计基线 **GDD v4.0（文档归档重构）** · 前一里程碑 v0.80.0"
new_h = "> 最后更新：2026-10-06 · 代码版本 **v0.82.0（第四世天伦 + 幼童立绘）** · 设计基线 **GDD v4.0（文档归档重构）** · 前一里程碑 v0.81.0"
assert s.count(old_h) == 1
s = s.replace(old_h, new_h)

anchor = "> **【v0.81.0 第三世·道侣 2026-10-06】**"
block = """> **【v0.82.0 第四世·天伦 + 幼童立绘 2026-10-06】** 《诸世情感》批次 E-E，**全量 smoke 归零、浏览器实测全链路**。
> ① sprites.js 新增 **child 立绘**（大头短身幼童，芽绿短褐，独立 childParts 部件表）。
> ② arc4.js（manor 主题）：冬夜捡回养子念尘（child），3 段日常（教认字/院里练拳/怕雷钻被窝）；三次天妒——分寿元、割道果一一挡下；终因「与轮回者因果太深」列为必除变量，三抉择（再割道果/送密道/独自迎战）改过程；围剿中孩子自愿走进天光赴死，「爹，让我自己走吧」；一夜白头、执念成形（求长生何用）。regret=念尘「小木剑」，deathCause='siege'。
> 实测 meta：arcs.done=[arc1..arc4]、regrets 4 件、nianchen fate doomed+3 记忆、next=arc5。
>
"""
assert s.count(anchor) == 1
s = s.replace(anchor, block + anchor)
io.open(p2, 'w', encoding='utf-8', newline='').write(s)
print('version synced v0.82.0')
