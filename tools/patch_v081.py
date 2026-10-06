# -*- coding: utf-8 -*-
"""v0.81.0：ns.js + HANDOVER（第三世道侣）。"""
import io

p1 = r'D:\Projects\nichen\www\js\core\ns.js'
s = io.open(p1, encoding='utf-8').read()
assert s.count("G.VERSION = 'v0.80.0';") == 1
s = s.replace("G.VERSION = 'v0.80.0';", "G.VERSION = 'v0.81.0';")
io.open(p1, 'w', encoding='utf-8', newline='').write(s)

p2 = r'D:\Projects\nichen\HANDOVER.md'
s = io.open(p2, encoding='utf-8').read()
old_h = "> 最后更新：2026-10-06 · 代码版本 **v0.80.0（第二世山门 + 命途选择）** · 设计基线 **GDD v4.0（文档归档重构）** · 前一里程碑 v0.79.0"
new_h = "> 最后更新：2026-10-06 · 代码版本 **v0.81.0（第三世道侣）** · 设计基线 **GDD v4.0（文档归档重构）** · 前一里程碑 v0.80.0"
assert s.count(old_h) == 1
s = s.replace(old_h, new_h)

anchor = "> **【v0.80.0 第二世·山门 + 命途选择 2026-10-06】**"
block = """> **【v0.81.0 第三世·道侣 2026-10-06】** 《诸世情感》批次 E-D，**全量 smoke 归零、浏览器实测全链路**。
> arc3.js（cottage 主题）：桥头卖花姑娘阿蘅（girl 立绘，晚晴一魂碎片，初见似曾相识）；3 段日常（编平安穗/劈柴烧火/结发系一缕发）；渡劫夜天道以她为心魔破绽，三抉择（连心结替挡/替身法宝代一次/独自硬抗，挡第一次挡不住第二重局）；她主动替应心劫，殒言「这一世，我很欢喜」；凭残魂与同源平安穗认出每世爱上同一人。regret=阿蘅「一缕发」，tokens.pingsui 1→2，deathCause='heart'。
> 实测 meta：arcs.done=[arc1..arc3]、regrets 3 件、aheng fate doomed+3 记忆、next=arc4。
>
"""
assert s.count(anchor) == 1
s = s.replace(anchor, block + anchor)
io.open(p2, 'w', encoding='utf-8', newline='').write(s)
print('version synced v0.81.0')
