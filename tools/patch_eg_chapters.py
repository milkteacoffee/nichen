# -*- coding: utf-8 -*-
"""E-G：休眠旧十章链（pendingFor/blockedBy 恒 null），主线由 Arcs 接管。"""
import io
p = r'D:\Projects\nichen\www\js\data\chapters.js'
s = io.open(p, encoding='utf-8').read()

a = """  function pendingFor(save) {
    var gl = (save && save.globalLevel) || 1;"""
b = """  function pendingFor(save) {
    /* v0.84：旧十章链休眠，主线由 Arcs 情感世接管（诸世情感 v1.0 §9 E-G）。 */
    return null;
  }
  function _pendingForLegacy(save) {
    var gl = (save && save.globalLevel) || 1;"""
assert s.count(a) == 1
s = s.replace(a, b)

a = """  function blockedBy(save) {
    var gl = (save && save.globalLevel) || 1;"""
b = """  function blockedBy(save) {
    /* v0.84：与 pendingFor 同源休眠。 */
    return null;
  }
  function _blockedByLegacy(save) {
    var gl = (save && save.globalLevel) || 1;"""
assert s.count(a) == 1
s = s.replace(a, b)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('chapters chain dormant')
