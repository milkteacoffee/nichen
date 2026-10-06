# -*- coding: utf-8 -*-
"""E-G：smoke chapter.contract 第一块（章节链休眠断言）。"""
import io
p = r'D:\Projects\nichen\tools\smoke.js'
s = io.open(p, encoding='utf-8').read()

a = r"""  const blk0 = C.blockedBy(sd);
  if (!blk0 || blk0.reason !== 'dao' || blk0.have !== 0 || blk0.need !== C.daoTotal()) {
    errors.push('blockedBy 应报"卡在九关 0/' + C.daoTotal() + '"，实为 ' +
      (blk0 ? blk0.reason + ' ' + blk0.have + '/' + blk0.need : 'null'));
  }
  sd.daoCleared = C.daoTotal() && new Array(C.daoTotal()).fill(true);
  const last2 = C.pendingFor(sd);
  if (!last2 || last2.id !== c10.id) {
    errors.push('九关尽过 + 境界达标时末章必须弹出，实为 ' + (last2 && last2.id));
  }
  if (C.blockedBy(sd)) errors.push('九关尽过后 blockedBy 应为 null');"""
b = r"""  /* v0.84：旧章节链休眠，pendingFor/blockedBy 恒 null（主线由 Arcs 接管）。 */
  if (C.blockedBy(sd)) errors.push('旧章节链休眠，blockedBy 应恒 null');
  sd.daoCleared = C.daoTotal() && new Array(C.daoTotal()).fill(true);
  if (C.pendingFor(sd)) errors.push('旧章节链休眠，pendingFor 应恒 null');"""
assert s.count(a) == 1
s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('first block adapted')
