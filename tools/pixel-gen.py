#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""像素素材出图：打印**逐条的最终提示词**，供逐张喂给生图工具。

为什么要有这个脚本（而不是手敲提示词）：
  · 提示词 = 主题 + PIXEL_PROMPT + 收尾，三段拼接。手敲 29 遍必然有一两条漏段/串主题，
    而"漏段"的表现只是"这张图风格不一样" —— 肉眼要一张张比对才发现。
  · 逻辑名 → 主题的映射走 `pixel-spec.py`，与 `regions.js: TINT` 有契约校验（见下）。

用法：
  python tools/pixel-gen.py list                 # 列出全部待出条目（逻辑名 + 完整提示词）
  python tools/pixel-gen.py list ground fan      # 只看 ground 里 fan 开头的
  python tools/pixel-gen.py check                # 校验 主题表 ↔ regions.js TINT 对齐

⚠️ 本脚本**不直接调用生图 API**（工具链在对话侧），只负责"生成正确的提示词"。
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import importlib.util


def _load_spec():
    p = os.path.join(ROOT, 'tools', 'pixel-spec.py')
    spec = importlib.util.spec_from_file_location('pixel_spec', p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


SPEC = _load_spec()

# 区域 id → 主题预设名（从 regions.js 的 TINT 读，**不在本文件里抄一份**）
def tint_of():
    s = open(os.path.join(ROOT, 'www/js/data/regions.js'), encoding='utf-8').read()
    m = re.search(r'var TINT = \{(.*?)\n  \};', s, re.S)
    body = m.group(1) if m else ''
    out = {}
    for k, v in re.findall(r"([a-z0-9]+):\s*'([a-z_]+)'", body):
        out[k] = v
    return out


# 复用型区域：`regions.js: R({id, map:'...'})` —— 它们**没有自己的 ground.<id>**，
# 用的是手写图的 tex，所以不参与出图（出了也不会被取到）。
def reused_regions():
    s = open(os.path.join(ROOT, 'www/js/data/regions.js'), encoding='utf-8').read()
    out = []
    for rid, body in re.findall(r"R\(\{\s*id:\s*'([a-z0-9]+)'(.*?)\}\)", s, re.S):
        if re.search(r"map\s*:\s*'", body):
            out.append(rid)
    return out


TAIL_TEX = '四方连续无缝平铺纹理，正俯视，画面填满无边框。'
TAIL_BLD = ('俯视 45 度等距视角，能同时看到屋顶和正面两个面。'
            '纯透明背景，建筑完整居中，四周留出边距。')


def ground_entries():
    """返回 [(逻辑名, 主题描述), ...]。"""
    tint = tint_of()
    reused = set(reused_regions())
    out = []
    # 四界生成型区域：只出**非复用型**的
    for rid in sorted(tint.keys()):
        if rid in reused:
            continue
        theme_key = tint[rid]
        desc = SPEC.GROUND_THEME.get(theme_key)
        if not desc:
            continue
        out.append(('ground.' + rid, desc))
    # 通用兜底四张（手写图实际取的就是它们）
    for k, desc in sorted(SPEC.GROUND_PLAIN.items()):
        out.append((k, desc))
    return out


def struct_entries():
    return sorted(SPEC.STRUCT_THEME.items())


def prompt_for(desc, kind):
    """拼最终提示词。

    ⚠️ 三段之间要**去重句号**：`PIXEL_PROMPT` 结尾自带「。」，
       直接 `desc + '。' + PIXEL_PROMPT + '。' + tail` 会拼出 `。。`。
       实测两组连续句号不影响出图，但会让"逐张比对提示词"时难以肉眼发现
       真正的漏段 —— 保持干净，异常才看得见。"""
    tail = TAIL_TEX if kind == 'tex' else TAIL_BLD
    parts = [desc.strip(), SPEC.PIXEL_PROMPT.strip(), tail]
    return '。'.join(p.rstrip('。') for p in parts if p) + '。'


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'list'
    if mode == 'check':
        tint = tint_of()
        have = set(SPEC.GROUND_THEME)
        used = set(v for k, v in tint.items())
        missing = sorted(used - have)
        extra = sorted(have - used)
        print('regions.js 用了', len(used), '个预设；规格表有', len(have), '个')
        print('规格表缺:', missing or '无')
        print('规格表多:', extra or '无')
        print('复用型区域（不出图）:', sorted(reused_regions()))
        return 0 if not missing else 1
    kind_filter = sys.argv[2] if len(sys.argv) > 2 else ''
    items = []
    for name, desc in ground_entries():
        if kind_filter and not name.startswith(kind_filter):
            continue
        items.append((name, prompt_for(desc, 'tex')))
    for name, desc in struct_entries():
        if kind_filter and not name.startswith(kind_filter):
            continue
        items.append((name, prompt_for(desc, 'bld')))
    for name, p in items:
        print('=' * 4, name)
        print(p)
    print()
    print('共', len(items), '条')
    return 0


if __name__ == '__main__':
    sys.exit(main())
