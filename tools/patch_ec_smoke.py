# -*- coding: utf-8 -*-
"""E-C：smoke 的 birth.grow 契约适配 arcpath 步。"""
import io
p = r'D:\Projects\nichen\tools\smoke.js'
s = io.open(p, encoding='utf-8').read()
a = """  R.step = 'talent';
  enterBtn.onClick();
  if (R.step !== 'grow') errors.push("点「入世」后 step 应为 'grow'，实为 " + R.step);"""
b = """  R.step = 'talent';
  enterBtn.onClick();
  /* v0.79：有命定世时先进入 arcpath 选择，选「浮世轮回」后才到 grow */
  if (R.step === 'arcpath') {
    const freeBtn = R.buttons.filter(function (x) { return x.label === '浮世轮回'; })[0];
    if (!freeBtn) errors.push('命途步缺「浮世轮回」按钮');
    else freeBtn.onClick();
  }
  if (R.step !== 'grow') errors.push("点「入世」后 step 应为 'grow'，实为 " + R.step);"""
assert s.count(a) == 1
s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('smoke birth.grow adapted')
