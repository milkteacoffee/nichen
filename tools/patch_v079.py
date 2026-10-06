# -*- coding: utf-8 -*-
"""v0.79.0 版本同步：ns.js + HANDOVER.md（情感主线引擎 + 第一世白鹿礁）。"""
import io

# ns.js
p1 = r'D:\Projects\nichen\www\js\core\ns.js'
s = io.open(p1, encoding='utf-8').read()
assert s.count("G.VERSION = 'v0.78.0';") == 1
s = s.replace("G.VERSION = 'v0.78.0';", "G.VERSION = 'v0.79.0';")
io.open(p1, 'w', encoding='utf-8', newline='').write(s)

# HANDOVER.md
p2 = r'D:\Projects\nichen\HANDOVER.md'
s = io.open(p2, encoding='utf-8').read()
old_h = "> 最后更新：2026-10-06 · 代码版本 **v0.78.0（Boss 程序化立绘：24 元素 Boss + 双路径立绘契约）** · 设计基线 **GDD v4.0（文档归档重构）** · 前一里程碑 v0.77.0"
new_h = "> 最后更新：2026-10-06 · 代码版本 **v0.79.0（情感主线 Arc 引擎 + 第一世白鹿礁）** · 设计基线 **GDD v4.0（文档归档重构）** · 前一里程碑 v0.78.0"
assert s.count(old_h) == 1
s = s.replace(old_h, new_h)

anchor = "> **【情感主线定稿 2026-10-06】**"
block = """> **【v0.79.0 情感主线 Arc 引擎 + 第一世 2026-10-06】** 《诸世情感与镜花水月主线设计 v1.0》批次 E-A/E-B，**全量 smoke 归零**。
> ① **Arc 引擎（data/arcs.js，G.Arcs）**：register/byId/list；ensure（建 story.arcs{done,current}、story.tokens、regrets，旧 bonds 补形 memories/fate）；bond/addMemory（共同记忆具体小事，上限 60）/addMeeting/addPeril/doom；门控 next（按登记序取未完成世）；begin（建 save.arc 运行态 intro→daily→crisis→loss→end）；dailyBeat/needMet；抉择 optionOk/runOption（item/glm/if 门控，consume/fx/then 真实结果）；complete（done 落定、fated 注定、tokens 信物、regrets 一件憾）。
> ② **通用剧本场景（scenes/arc.js）**：开场对话（Typewriter + 名牌 + 立绘按 96px 目标高度自适应、正文避让）；日常相位程序化主题背景（reef/sect/cottage/manor/dojo/mirror 六套，昼/夜变体）+ 点击 NPC 相处热点（进度面板 0/need，满足后「入夜」按钮）；惊变相位节点 line/choice/stat/death/call + 雨丝；失去相位收场后 complete → 死（arc1-5）或 endFlow 进结局（arc6）。
> ③ **第一世·白鹿礁（data/arc1.js）**：姜老药师（爷爷，elder 立绘）+ 晚晴/阿蘅（青梅，新增 girl 配色），各 3 段相处小事；血煞教夜袭（云幕冷眼=天道借刀），抉择「挡在爷爷身前/拉晚晴往礁后跑」可改过程；爷爷护他死在怀里、晚晴被抽魂不见尸，只余半截平安穗（tokens.pingsui）；立报仇+复活两愿后首次死亡。
> ④ **接线**：reincarnation.finish 第 1 世强制 arc1（其后几世命定/浮世选择 E-C 接入）；storage VERSION 10→11（meta 迁移走 Arcs.ensure）；index.html 注册 arcs/arc1-6 与 arc 场景；smoke 版本断言同步 11。
> 浏览器实测：标题→难度→灵根/天赋→成长→白鹿礁开场/日常（6 beat）/惊变（含抉择）/失去→天道拦魂→死亡结算（+42 仙力）全链路通过；meta 校验 arcs.done=[arc1]、tokens.pingsui=1、regrets 1 件、两牵挂 fate 注定、next=arc2。
>
"""
assert s.count(anchor) == 1
s = s.replace(anchor, block + anchor)
io.open(p2, 'w', encoding='utf-8', newline='').write(s)
print('version synced v0.79.0')
