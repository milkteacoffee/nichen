# -*- coding: utf-8 -*-
"""v0.84.0：恢复 stack 口径 + ns/HANDOVER（终世 + 两结局）。"""
import io

# 恢复 smoke stack 口径
p0 = r'D:\Projects\nichen\tools\smoke.js'
s = io.open(p0, encoding='utf-8').read()
a = "  try { fn(); } catch (e) { errors.push(`[${label}] ${e.stack}`); }"
b = "  try { fn(); } catch (e) { errors.push(`[${label}] ${e.message}`); }"
assert s.count(a) == 1
s = s.replace(a, b)
io.open(p0, 'w', encoding='utf-8', newline='').write(s)

# ns 版本
p1 = r'D:\Projects\nichen\www\js\core\ns.js'
s = io.open(p1, encoding='utf-8').read()
assert s.count("G.VERSION = 'v0.83.0';") == 1
s = s.replace("G.VERSION = 'v0.83.0';", "G.VERSION = 'v0.84.0';")
io.open(p1, 'w', encoding='utf-8', newline='').write(s)

# HANDOVER
p2 = r'D:\Projects\nichen\HANDOVER.md'
s = io.open(p2, encoding='utf-8').read()
old_h = "> 最后更新：2026-10-06 · 代码版本 **v0.83.0（第五世薪火）** · 设计基线 **GDD v4.0（文档归档重构）** · 前一里程碑 v0.82.0"
new_h = "> 最后更新：2026-10-06 · 代码版本 **v0.84.0（终世道界 + 镜花水月两结局）** · 设计基线 **GDD v4.0（文档归档重构）** · 前一里程碑 v0.83.0"
assert s.count(old_h) == 1
s = s.replace(old_h, new_h)

anchor = "> **【v0.83.0 第五世·薪火 2026-10-06】**"
block = """> **【v0.84.0 终世·道界 + 镜花水月两结局 2026-10-06】** 《诸世情感》批次 E-F/E-G，**全量 smoke 归零、浏览器实测两结局全链路**。
> arc6.js（mirror 主题，endFlow）：修至道祖，复活之路三阶——招魂（残影魂火是冷的、重复生前话）→ 凝魄（夺战俘生魂/割天地灵机/自身道果，一人圆满另一人替死、一方天地失序；被补全者说出别人的记忆）→ 重塑（倾尽诸世「完整复活」实为天道温柔陷阱，转身时笑声停、晚晴问「你为什么在哭呢」、镜面裂）。
> ending.js 完整重写：「镜花水月」菜单两结局——**沉梦入梦**（主动入镜，世界渐空色淡，末镜逆命珠一粒尘光不灭）；**放手·逆尘（真结局）**（道果逆命珠为祭不复活，斩牵挂因果送魂魄新生，自碎长生归于尘芥；春日人间三幕无人识他，「我让你们，都好好活过了。这一世，我很欢喜」）。
> chapters.js：旧十章链 pendingFor/blockedBy 休眠恒 null（legacy 函数保留），主线由 Arcs 情感世接管；smoke chapter.contract 同步重写（菜单驱动两结局走完全程）。
> 实测：arcs.done=[arc1..arc6]，meta.endings.release/dream 均落、save.ending、story.ending 正确。
>
"""
assert s.count(anchor) == 1
s = s.replace(anchor, block + anchor)
io.open(p2, 'w', encoding='utf-8', newline='').write(s)
print('v0.84.0 synced')
