# -*- coding: utf-8 -*-
"""E-H：smoke 新增 arc.contract（六世结构校验 + 引擎全六世模拟）。"""
import io
p = r'D:\Projects\nichen\tools\smoke.js'
s = io.open(p, encoding='utf-8').read()

anchor = "}, 'chapter.contract');"
assert s.count(anchor) == 1

contract = r"""}, 'chapter.contract');

/* ---------- 情感世契约（v0.84，诸世情感 v1.0 §10） ----------
   ① 六个情感世定义结构完整（intro/日常热点/惊变节点/loss/sprite）；
   ② 引擎头less模拟全六世：next 门控 → begin → 日常 need → 抉择 → complete，
      牵挂注定、执念册落件、六世尽过 next 归 null。 */
step(function () {
  const defs = G.Arcs.list();
  if (defs.length !== 6) errors.push('情感世应登记 6 个，实为 ' + defs.length);
  defs.forEach(function (d) {
    if (!d.n || !d.theme) errors.push(d.id + ' 缺 n/theme');
    if (!d.intro || !d.intro.length) errors.push(d.id + ' 缺 intro');
    (d.intro || []).forEach(function (b) { if (!b.t) errors.push(d.id + ' intro 有缺文拍'); });
    const spots = (d.daily && d.daily.spots) || [];
    if (!spots.length) errors.push(d.id + ' 缺日常热点');
    spots.forEach(function (sp) {
      if (!sp.id || !sp.pid || !sp.label) errors.push(d.id + ' 热点字段不全');
      (sp.beats || []).forEach(function (b) { if (!b.t) errors.push(d.id + ' 热点缺 beat 文'); });
    });
    (d.crisis.nodes || []).forEach(function (n) {
      if (n.k === 'line' || n.k === 'death') { if (!n.t) errors.push(d.id + ' 节点缺文'); }
      else if (n.k === 'choice') {
        if (!n.options || n.options.length < 2) errors.push(d.id + ' 抉择选项不足 2');
        (n.options || []).forEach(function (o) { if (!o.then) errors.push(d.id + ' 选项缺 then 文'); });
      } else if (n.k === 'branch') { if (!n.then || !n.else) errors.push(d.id + ' branch 缺 then/else'); }
      else if (n.k === 'stat' || n.k === 'call') { /* 允许 */ }
      else errors.push(d.id + ' 未知节点类型：' + n.k);
    });
    if (!d.loss || !d.loss.length) errors.push(d.id + ' 缺 loss 段');
    (d.loss || []).forEach(function (b) { if (!b.t) errors.push(d.id + ' loss 缺文'); });
    Object.keys(d.sprites || {}).forEach(function (k) {
      if (!d.sprites[k].sys) errors.push(d.id + ' sprite ' + k + ' 缺 sys');
    });
  });

  /* 引擎全六世模拟 */
  const meta = { bonds: {}, regrets: [], progress: {} };
  G.Arcs.ensure(meta);
  defs.forEach(function (d, i) {
    const next = G.Arcs.next(meta);
    if (!next || next.id !== d.id) {
      errors.push('next 门控应为 ' + d.id + '，实为 ' + (next && next.id));
    }
    const save = { life: i + 1, items: {}, globalLevel: 1, chronicle: [] };
    G.Arcs.begin(save, meta, d);
    const spots = d.daily.spots;
    let guard = 0;
    while (!G.Arcs.needMet(save, d) && guard < 40) {
      G.Arcs.dailyBeat(save, meta, spots[guard % spots.length]); guard++;
    }
    if (!G.Arcs.needMet(save, d)) errors.push(d.id + ' 日常 need 无法满足');
    d.crisis.nodes.forEach(function (n) {
      if (n.k === 'choice') {
        const opt = n.options.filter(function (o) { return G.Arcs.optionOk(save, o); })[0];
        if (!opt) { errors.push(d.id + ' 无可用抉择选项'); return; }
        if (!G.Arcs.runOption(save, meta, opt)) errors.push(d.id + ' 抉择无反馈文');
      } else if (n.k === 'branch') {
        if (!(n.if(save) ? n.then : n.else)) errors.push(d.id + ' branch 无分支文');
      }
    });
    G.Arcs.complete(save, meta);
    if (meta.progress.story.arcs.done.indexOf(d.id) < 0) errors.push(d.id + ' complete 未落 done');
    (d.fated || []).forEach(function (f) {
      const b = meta.bonds[f.pid];
      if (!b || !b.fate.doomed) errors.push(d.id + ' 牵挂 ' + f.pid + ' 未注定');
    });
  });
  if (G.Arcs.next(meta)) errors.push('六世尽过后 next 应为 null');
  if (meta.regrets.length !== 5) {
    errors.push('执念册应有 5 件（arc6 无），实为 ' + meta.regrets.length);
  }
}, 'arc.contract');"""

s = s.replace(anchor, contract, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('arc.contract added')
