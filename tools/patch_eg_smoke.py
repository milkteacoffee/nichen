# -*- coding: utf-8 -*-
"""E-G：smoke chapter.contract 适配——章节链休眠断言 + 新结局场景菜单驱动。"""
import io
p = r'D:\Projects\nichen\tools\smoke.js'
s = io.open(p, encoding='utf-8').read()

a = """  const blk0 = C.blockedBy(sd);
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
b = """  /* v0.84：旧章节链休眠，pendingFor/blockedBy 恒 null（主线由 Arcs 接管）。 */
  if (C.blockedBy(sd)) errors.push('旧章节链休眠，blockedBy 应恒 null');
  sd.daoCleared = C.daoTotal() && new Array(C.daoTotal()).fill(true);
  if (C.pendingFor(sd)) errors.push('旧章节链休眠，pendingFor 应恒 null');"""
assert s.count(a) == 1
s = s.replace(a, b)

a = """  /* ④ 结局场景真跑一帧 */
  if (!G.scenes.ending) { errors.push('没有 ending 场景'); return; }
  const metaBak = G.game.meta, saveBak = G.game.save;
  const s2 = JSON.parse(JSON.stringify(save));
  s2.pos = { x: 5, y: 5 }; s2.items = s2.items || {}; s2.beasts = s2.beasts || [];
  s2.chapters = L.map(function (c) { return c.id; });
  s2.daoHeart = 6;                        /* → 证道 */
  s2.chronicle = s2.chronicle || [];
  G.game.save = s2;
  G.game.meta = { endings: {} };
  G.game.changeScene('ending');
  if (G.game.sceneName !== 'ending') errors.push('changeScene(\\'ending\\') 失败');
  if (!G.game.meta.endings.zheng) errors.push('结局成就未写进 meta.endings（跨世记录）');
  if (s2.ending !== 'zheng') errors.push('本世结局未写进 save.ending');
  if (!(G.game.scene.buttons || []).length) errors.push('结局场景没有按钮（出不去）');
  /* 真跑几帧渲染（新增场景最容易漏的是"能建不能画"） */
  try { G.game.scene.render(G.game.ctx); } catch (e) {
    errors.push('结局场景渲染抛异常：' + e.message);
  }
  /* 换成逆天再跑一次（三条结局的配色/文案分支都要能画） */
  G.game.meta = { endings: {} };
  G.game.save.daoHeart = -9;
  G.game.changeScene('ending');
  if (!G.game.meta.endings.ni) errors.push('逆天结局未写进 meta.endings');
  try { G.game.scene.render(G.game.ctx); } catch (e) {
    errors.push('逆天结局渲染抛异常：' + e.message);
  }
  G.game.meta = metaBak; G.game.save = saveBak;
  G.game.changeScene('town', { toSpawn: true });""".replace("\\'", "'")
b = """  /* ④ 结局场景：菜单 → 放手（真结局）走完全程，再重入走沉梦 */
  if (!G.scenes.ending) { errors.push('没有 ending 场景'); return; }
  const metaBak = G.game.meta, saveBak = G.game.save;
  const s2 = JSON.parse(JSON.stringify(save));
  s2.pos = { x: 5, y: 5 }; s2.items = s2.items || {}; s2.beasts = s2.beasts || [];
  s2.chronicle = s2.chronicle || [];
  G.game.save = s2;
  G.game.meta = { endings: {} };
  G.game.changeScene('ending');
  if (G.game.sceneName !== 'ending') errors.push('changeScene(\\'ending\\') 失败');
  function endWalk(label, key) {
    const sc = G.game.scenes.ending;
    const btn = (sc.buttons || []).filter(function (x) { return x.label.indexOf(label) >= 0; })[0];
    if (!btn) { errors.push('结局菜单缺「' + label + '」按钮'); return; }
    btn.onClick();
    if (!G.game.meta.endings[key]) errors.push(key + ' 结局未写进 meta.endings');
    if (s2.ending !== key) errors.push('本世结局未写进 save.ending（' + key + '）');
    let guard = 0;
    while (sc.phase !== 'done' && guard < 80) { sc.onTap(); guard++; }
    if (sc.phase !== 'done') errors.push(key + ' 结局未能走完（guard=' + guard + '）');
    try { sc.render(G.game.ctx); } catch (e) { errors.push(key + ' 结局渲染抛异常：' + e.message); }
  }
  endWalk('放手', 'release');
  /* 重入菜单走沉梦（两条分支配色文案都要能画） */
  G.game.meta = { endings: {} };
  G.game.changeScene('ending');
  endWalk('沉梦', 'dream');
  G.game.meta = metaBak; G.game.save = saveBak;
  G.game.changeScene('town', { toSpawn: true });""".replace("\\'", "'")
assert s.count(a) == 1
s = s.replace(a, b)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('chapter.contract adapted')
