# -*- coding: utf-8 -*-
"""E-H：总索引 v4.0 更新（存档 v11、v0.79-v0.84 主线完成口径）。"""
import io
p = r'D:\Projects\nichen\doc\《逆尘》设计文档总索引 v4.0.md'
s = io.open(p, encoding='utf-8').read()

a = "- 存档结构：`core/storage.js` 的 `VERSION`（当前 10），结构变更须带迁移。"
b = "- 存档结构：`core/storage.js` 的 `VERSION`（当前 11），结构变更须带迁移。"
assert s.count(a) == 1
s = s.replace(a, b)

a = """- **当前主线（情感向，见《诸世情感与镜花水月主线设计 v1.0》§9）**：
  E-A 牵挂数据层 → E-B 序章深化 → E-C 山门世 → E-D 道侣世 → E-E 子女世 → E-F 复活之路三阶 → E-G 镜花水月终局（沉梦/放手）。"""
b = """- **v0.79.0–v0.83.0 已落地**：情感主线前五世——arc 引擎（`data/arcs.js`：牵挂/共同记忆/执念册/命定门控）+ 通用剧本场景（`scenes/arc.js`：intro→日常→惊变→失去→收场）；arc1 白鹿礁（爷爷姜老药师、晚晴）、arc2 山门（师父玄玑子、师兄裴长庚）、arc3 道侣（阿蘅=晚晴魂碎片）、arc4 天伦（养子念尘，新增 child 幼童立绘）、arc5 薪火（首徒守一、结义景炎，放手埋种）；转世新增「命途」步（天道命定/浮世轮回），存档 v11 迁移。
- **v0.84.0 已落地（主线与结局完成）**：arc6 终世道界——修至道祖，复活之路三阶（招魂冷残影→凝魄夺材→重塑镜碎）；`scenes/ending.js` 重写为「镜花水月」两结局：沉梦入梦 / 放手·逆尘（真结局），全游戏无真正复活路径；旧十章链休眠（pendingFor/blockedBy 恒 null），通关后补遗模式保留自由轮回。smoke 新增 arc.contract（六世结构 + 引擎全六世模拟），全量归零。
- **百世轮回主线状态（见《诸世情感与镜花水月主线设计 v1.0》§9）**：E-A → E-G 全部关闭；E-H 全量走查/回归完成。"""
assert s.count(a) == 1
s = s.replace(a, b)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('index updated')
