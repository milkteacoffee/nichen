# -*- coding: utf-8 -*-
"""v0.80.0 版本同步：ns.js + HANDOVER.md（第二世山门 + 命途选择）。"""
import io

p1 = r'D:\Projects\nichen\www\js\core\ns.js'
s = io.open(p1, encoding='utf-8').read()
assert s.count("G.VERSION = 'v0.79.0';") == 1
s = s.replace("G.VERSION = 'v0.79.0';", "G.VERSION = 'v0.80.0';")
io.open(p1, 'w', encoding='utf-8', newline='').write(s)

p2 = r'D:\Projects\nichen\HANDOVER.md'
s = io.open(p2, encoding='utf-8').read()
old_h = "> 最后更新：2026-10-06 · 代码版本 **v0.79.0（情感主线 Arc 引擎 + 第一世白鹿礁）** · 设计基线 **GDD v4.0（文档归档重构）** · 前一里程碑 v0.78.0"
new_h = "> 最后更新：2026-10-06 · 代码版本 **v0.80.0（第二世山门 + 命途选择）** · 设计基线 **GDD v4.0（文档归档重构）** · 前一里程碑 v0.79.0"
assert s.count(old_h) == 1
s = s.replace(old_h, new_h)

anchor = "> **【v0.79.0 情感主线 Arc 引擎 + 第一世 2026-10-06】**"
block = """> **【v0.80.0 第二世·山门 + 命途选择 2026-10-06】** 《诸世情感》批次 E-C，**全量 smoke 归零、浏览器实测全链路**。
> ① **arc2.js 完整内容**：师父玄玑子（elder）雪夜捡他回山、师兄裴长庚（keeper）同食同练，各 3 段相处小事；天道遣持尺白衣代行者以「窝藏轮回孽障」问罪；三抉择（劝暂避/挡身前/求留情，写 arc.flags）可改死法遗言；新增 **branch 节点**（按 save 状态分支台词）；师父自散修为撞代行者而亡、师兄断后战死；regret=玄玑子「活下去。别回头。」（半卷讲经手稿）。
> ② **命途选择步（reincarnation）**：life≥2 天赋步后，若 Arcs.next 有命定世，主按钮显「择命途」→ arcpath 步两按钮「天道命定·n」（arcChoice=id）与「浮世轮回」（null），再播成长；finish 按 arcChoice 路由命定世。
> ③ 对话框夜景对比增强（填充 0.97 / 金边 0.8）；smoke birth.grow 契约适配 arcpath。
> 实测 meta：arcs.done=[arc1,arc2]、regrets 2 件、xuanjizi/changgeng fate doomed（deathLife=4、deathText 在）、各 3 共同记忆、next=arc3。
>
"""
assert s.count(anchor) == 1
s = s.replace(anchor, block + anchor)
io.open(p2, 'w', encoding='utf-8', newline='').write(s)
print('version synced v0.80.0')
