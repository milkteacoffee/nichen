# -*- coding: utf-8 -*-
"""E-C 收尾：对话框在夜景下对比不足，提升填充与描边不透明度。"""
import io
p = r'D:\Projects\nichen\www\js\scenes\arc.js'
s = io.open(p, encoding='utf-8').read()
a = "x.fillStyle = 'rgba(8,11,20,0.92)';\n      x.strokeStyle = 'rgba(216,183,104,0.6)';"
b = "x.fillStyle = 'rgba(9,13,24,0.97)';\n      x.strokeStyle = 'rgba(216,183,104,0.8)';"
assert s.count(a) == 1
s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('dialog contrast up')
