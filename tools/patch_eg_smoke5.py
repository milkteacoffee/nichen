# -*- coding: utf-8 -*-
import io
p = r'D:\Projects\nichen\tools\smoke.js'
s = io.open(p, encoding='utf-8').read()

a = r"""  /* ② 顺序推进 + 一次性 */
  const s = JSON.parse(JSON.stringify(save));
  s.globalLevel = 1; s.chapters = []; s.daoHeart = 0;
  s.quest = s.quest || { step: 'm1done', flags: {} };
  if (C.pendingFor(s)) errors.push('淬体境不该弹出任何章节');
  s.globalLevel = 700;
  const first = C.pendingFor(s);
  if (!first || first.id !== L[0].id) {
    errors.push('境界拉满时应从第一章开始，实为 ' + (first && first.id));
  }
  /* 只标第 1 章完成 → 下一章应是第 2 章（不能跳） */
  C.markDone(s, L[0].id);
  const second = C.pendingFor(s);
  if (!second || second.id !== L[1].id) {
    errors.push('第 1 章完成后应轮到第 2 章，实为 ' + (second && second.id));
  }
  /* 把第 2 章也标了 → 再调一次不会重复给第 2 章 */
  C.markDone(s, L[1].id);
  const third = C.pendingFor(s);
  if (third && third.id === L[1].id) errors.push('章节 ' + L[1].id + ' 完成后仍在重复触发');
  /* markDone 幂等 */
  C.markDone(s, L[0].id);
  if (s.chapters.filter(function (x) { return x === L[0].id; }).length !== 1) {
    errors.push('markDone 不是幂等的（同一章记了两次）');
  }
  const pr = C.progressOf(s);
  if (pr.done !== 2 || pr.total !== L.length) {
    errors.push('progressOf 应报 2/' + L.length + '，实为 ' + pr.done + '/' + pr.total);
  }

  /* ②b 末章的**九关闸**（v0.73.0）：c10 的台词是"九关尽过"，光看境界会让玩家
     只打六关（第 6 关锚点 gl 648）再闭关进道祖境就吃到结局。断言四件事：
     ① c10 必须挂 requiresDao；② 境界够但九关不满 → 不弹；③ 九关满 → 弹；
     ④ blockedBy 能说出卡在"九关"而不是别的原因。 */
  const c10 = L[L.length - 1];
  if (!c10 || c10.requiresDao !== C.daoTotal()) {
    errors.push('末章 ' + (c10 && c10.id) + ' 必须要求本世九关尽过（requiresDao=' +
      (c10 && c10.requiresDao) + '，应为 ' + C.daoTotal() + '）—— 否则"九关尽过"只是台词');
  }
  const sd = JSON.parse(JSON.stringify(save));
  sd.chapters = L.slice(0, L.length - 1).map(function (c) { return c.id; });
  sd.globalLevel = 700; sd.daoCleared = [];
  if (C.pendingFor(sd)) {
    errors.push('境界拉满但九关一关没过时，末章不该弹出（台词与数值分叉）');
  }
  /* v0.84：旧章节链休眠，pendingFor/blockedBy 恒 null（主线由 Arcs 接管）。 */
  if (C.blockedBy(sd)) errors.push('旧章节链休眠，blockedBy 应恒 null');
  sd.daoCleared = C.daoTotal() && new Array(C.daoTotal()).fill(true);
  if (C.pendingFor(sd)) errors.push('旧章节链休眠，pendingFor 应恒 null');"""

b = r"""  /* ② 旧章节链 v0.84 起休眠（主线由 Arcs 情感世接管）：
     章节定义/道心口径（endingOf）保留为 legacy，仅断言链不再触发。 */
  const s = JSON.parse(JSON.stringify(save));
  s.globalLevel = 1; s.chapters = []; s.daoHeart = 0;
  s.quest = s.quest || { step: 'm1done', flags: {} };
  if (C.pendingFor(s)) errors.push('休眠后任何境界都不该弹旧章节（淬体）');
  s.globalLevel = 700;
  if (C.pendingFor(s)) errors.push('休眠后任何境界都不该弹旧章节（拉满）');
  if (C.blockedBy(s)) errors.push('休眠后 blockedBy 应恒 null');
  /* markDone / progressOf 仍可用于补遗模式记录 */
  C.markDone(s, L[0].id); C.markDone(s, L[1].id);
  C.markDone(s, L[0].id);
  if (s.chapters.filter(function (x) { return x === L[0].id; }).length !== 1) {
    errors.push('markDone 不是幂等的（同一章记了两次）');
  }
  const pr = C.progressOf(s);
  if (pr.done !== 2 || pr.total !== L.length) {
    errors.push('progressOf 应报 2/' + L.length + '，实为 ' + pr.done + '/' + pr.total);
  }"""

assert s.count(a) == 1, s.count(a)
s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('sections 2/2b replaced')
