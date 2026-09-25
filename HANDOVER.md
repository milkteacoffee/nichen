# 《逆尘》开发交接文档

> 最后更新：2026-09-25 · 代码版本 **v0.5.2** · commit `814d8f2`（已推送 main）
> 用途：换电脑继续开发时的**唯一入口**。仓库里其它文档的分工见 §2.3。

---

## 0. 三十秒速览

**《逆尘》** —— 横屏单机仙侠**轮回** Roguelite RPG。2D 像素、俯视探图 + 回合制战斗。

| 项 | 值 |
|---|---|
| 技术栈 | **纯原生 JS + Canvas2D**，零框架、零构建、零依赖（浏览器直接跑 `<script src>`） |
| 代码风格 | ES5 风（`var` + `function`），全局命名空间 `G` |
| 逻辑分辨率 | **480 × 272**，内部超采样倍率 `S ∈ [3,4]` 按窗口自适应 |
| 打包 | Capacitor（`capacitor.config.json` 已配好，**但 `android/` 还没 init**） |
| 代码量 | `www/js` ≈ 9.7k 行；`tools/` ≈ 4.3k 行（无头测试与审查工具） |
| 当前进度 | **M0 主线全通**（新档 → m0-1..m0-5 → 赤炎狼王），轮回闭环已通，M1 未开工 |
| 回归状态 | smoke 24/24 · playthrough 通过 · rebirth 通过 · shot 42 张 · 浏览器探针零页面错误 |

**最重要的一句话**：这个项目**没有构建步骤**。改完 `www/js/*.js` 直接刷新浏览器就能看到效果；
`tools/` 下的 node 脚本是**测试与审查**用的，不参与运行。

---

## 1. 新机器上跑起来

### 1.1 拉代码

```bash
git clone git@github.com:milkteacoffee/nichen.git
cd nichen
```

> 仓库里已经包含全部素材（`www/assets/img/*.png`，11 个文件：7 张战斗立绘 + 4 张主角四向行走）。
> `_gen/`（切图中间产物）和 `_shots/`（截图输出）被 gitignore，不需要也不应该带过来。

### 1.2 跑游戏本体（只需要这个）

```bash
# 任选一种起静态服务，然后在浏览器开 http://127.0.0.1:8173
npx serve www -l 8173
# 或
python -m http.server 8173 --directory www
```

**必须走 HTTP，不能双击 `index.html`**：素材清单走 `fetch('assets/manifest.json')`，
`file://` 协议下会被 CORS 拦掉，画面会全部退回程序化兜底（能跑，但看不到 AI 素材）。

Windows 上可以直接用 Chrome 的 `--allow-file-access-from-files`，但别养成习惯。

### 1.3 跑测试与审查工具（需要额外装两个东西）

工具不在运行链路上，但**改完代码必须跑**。它们依赖：

| 依赖 | 用途 | 装法 |
|---|---|---|
| **Node ≥ 18** | 全部 `tools/*.js` | 任意版本管理器 |
| `@napi-rs/canvas` | 真实光栅化（截图 / 帧耗基准） | `npm i -D @napi-rs/canvas`（当前用的是 **1.0.9**） |
| **Python ≥ 3.10 + Pillow** | `tools/assets-build.py`（切图/生成 manifest） | `pip install Pillow`（当前用的是 **12.3.0**） |

`@napi-rs/canvas` **不在 `package.json` 里**，是刻意留的（它带原生二进制，
不想让 `npm i` 在没必要的机器上拖 20MB）。装完之后跑工具要指 `NODE_PATH`：

```bash
# 如果装在项目里（推荐，路径最省心）
npm i -D @napi-rs/canvas
NODE_PATH=./node_modules node tools/smoke.js

# 如果装在全局/别处
NODE_PATH=/path/to/node_modules node tools/smoke.js
```

> 本文档里所有命令都写成 `node` / `python`。本机（旧环境）的实际路径见 §7.3，
> 是 WorkBuddy 的托管运行时，**换机后路径一定会变**，不要照抄。

### 1.4 一键自检（换机后第一件事）

```bash
export NODE_PATH=./node_modules          # 或你的实际路径
node tools/smoke.js       && echo "① 冒烟 OK"
node tools/playthrough.js && echo "② 通关 OK"
node tools/rebirth.js     && echo "③ 轮回 OK"
```

三条都过、且**数字与 §3.2 的基线一致**，说明环境完全正常。
不一致但没报错，先看是不是 Node/Pillow 版本差异（概率低），再 diff 数值。

---

## 2. 目录与文件地图

```
nichen/
├── HANDOVER.md              ← 你正在看的这份
├── package.json             Capacitor 依赖 + serve/cap/apk 三个脚本
├── capacitor.config.json    appId com.nichen.game，webDir=www，横屏
├── www/                     ★ 全部游戏代码（部署单元就是这一整个目录）
│   ├── index.html           脚本加载顺序表（见 §4.1，动它要同步改测试）
│   ├── css/style.css        画布居中 + 等比缩放
│   ├── _probe.html          素材接线自检页（手开浏览器用，见 §3.4）
│   ├── assets/              素材层 + README.md（★ 换皮指南，内容很全）
│   └── js/
│       ├── core/            引擎层
│       ├── data/            纯数据表（无逻辑）
│       └── scenes/          场景层
├── tools/                   无头测试与审查工具（不参与运行）
├── doc/                     18 份设计规格（见 §2.3）
├── _gen/                    (gitignore) 切图中间产物
└── _shots/                  (gitignore) 截图/审查输出
```

### 2.1 `www/js/core/` —— 引擎层

| 文件 | 行数 | 职责 |
|---|---|---|
| `art.js` | 2387 | **全部程序化美术**。地面纹理、建筑、家具、装饰、精灵、立绘、图标；三级缓存（`cached` / `G.Sprites` / `G.UI`）都在这里定义 |
| `ui.js` | 735 | UI 套件：调色板 `C`、字体 `F`、`panel/frame/bar/seal/icon/avatar/divider/rr`、`Btn`、打字机 `Typewriter` |
| `sprites.js` | 1070 | 主角四向行走帧 + NPC 精灵，程序化兜底 |
| `explore.js` | 946 | **探索引擎**（镇/山/洞/室内通用）：寻路、交互、遭遇、**HUD** |
| `player.js` | 408 | 数值中枢：`computeStats` / `talentEffects` / `breakState` / `rates` / `lifespanOf` / `xianliOf` |
| `game.js` | 184 | 主控：Canvas 适配、场景路由、主循环、`die()` / `checkAged()` |
| `mapgen.js` | 174 | 地图生成：地面、路、建筑、家具、NPC 落位、可达性 |
| `overlays.js` | 171 | 覆盖层公共件：暗底、对话（立绘+台词）、**角色面板** |
| `assets.js` | 107 | 素材登记/查询/加载（`G.Assets.img/register/load`） |
| `storage.js` | 59 | localStorage 存档（`nichen_meta` / `nichen_save`，各带 `_bak`） |
| `input.js` | 51 | 指针/键盘输入 → `onTap` / `onKey` |
| `rng.js` | 40 | 可复现随机（种子化，测试靠它） |
| `ns.js` | 3 | `window.G = window.G \|\| {}` |

### 2.2 `www/js/scenes/` —— 场景层（**全部是单例**，见 §4.3）

| 文件 | 行数 | 职责 |
|---|---|---|
| `battle.js` | 1196 | 回合制战斗：指令集、行动条、状态、多敌前后排、自动战斗、结算演出 |
| `reincarnation.js` | 365 | 转世流程：**出身 → 灵根 → 天赋 → 直接入世** |
| `town.js` | 350 | 青溪镇：门、NPC 对话表 `NPC_ACTS`、任务钩子 |
| `title.js` | 331 | 标题菜单、关于页 |
| `death.js` | 240 | 死亡结算：死因/享年/走马灯/仙力明细 → 写入轮回档案 |
| `reincarnation-hall.js` | 186 | 轮回殿：五线灌注（仙躯/灵息/魂力/财禄/遁法） |
| `field.js` | 64 | 翠微山（含山神庙覆盖层） |
| `cave.js` | 24 | 赤牙洞 |

### 2.3 `doc/` —— 设计规格（18 份）

按版本号排：`v0.1 角色成长` → `v0.2 战斗/P0剧情/探图存档/经济/美术音频/炼丹炼器/御兽`
→ `v0.3 灵根` → `v0.4 轮回转世与仙力Meta` → `v0.5 天道意志LLM`
→ `v0.6 出身天赋与全流程` → `v0.7 天赋扩池` → `v0.8 万界轮回世界生成` → `v0.9 终审勘误与开工令`。

> ⚠️ **这些是版本快照，不是当前实现**。已知至少两份已经过期：
> - `v0.1 角色成长与功法修炼系统规格` —— **六维系统已整体删除**（v0.5.2）
> - `v0.6 出身天赋与全流程` —— **幼年阶段（1–15 岁事件卡）已整体删除**（v0.5.2）
>
> 判断"现在到底怎么实现"的**权威顺序**是：
> `代码` > `www/assets/README.md`（技术手册） > `HANDOVER.md`（本文件） > `doc/*.md`（设计意图）。
> 要不要回改这两份规格，等用户拍板（见 §6）。

### 2.4 `tools/` —— 工具（改完代码必须跑）

| 工具 | 行数 | 用途 |
|---|---|---|
| `smoke.js` | 1424 | **冒烟测试**：加载全部脚本、走遍所有场景、几十组契约断言。改任何东西后第一件事 |
| `playthrough.js` | 392 | **M0 通关模拟**：新档 → m0-1..m0-5 → 赤炎狼王，打印每步数值 |
| `rebirth.js` | 562 | **轮回闭环模拟**：一世终结算 → 五线灌注 → 浮世重生，验证"第二世确实变强" |
| `browser-probe.js` | 677 | **真实浏览器探针**（CDP 驱动本机 Chrome/Edge），唯一能验证素材是否生效的工具 |
| `shot.js` | 488 | 42 个场景导出 PNG（`@napi-rs/canvas` 真实光栅化） |
| `zoom.js` | 182 | 单场景局部放大审查（看精灵清晰度） |
| `portrait-sheet.js` | 126 | 立绘总览 + ASCII 缩略图（图片直读会间歇失败，文本化更可靠） |
| `sprite-sheet.js` | 105 | 战斗立绘高倍导出 |
| `bench-frame.js` | 113 | 帧耗基准（S=4 最小帧耗） |
| `bench-ground.js` | 50 | 地面纹理烘焙耗时基准 |
| `assets-build.py` | 199 | 切图 + 生成/校验 manifest（`--check` 模式） |

---

## 3. 常用命令 + 当前基线

### 3.1 命令速查

```bash
export NODE_PATH=./node_modules      # 只对 node 工具需要

# —— 每次改完代码 ——
node tools/smoke.js                       # 必须过
node tools/shot.js 04_hud                 # 只落这一张（其它帧照常推进）
node tools/shot.js                        # 全部 42 张
node tools/playthrough.js                 # 数值回归
node tools/rebirth.js                     # 轮回回归
node tools/bench-frame.js                 # 帧耗回归

# —— 真实浏览器（要常驻服务）——
python -m http.server 8173 --directory www &     # 必须常驻！
node tools/browser-probe.js town                 # 场景见下
# 场景：town | field | cave | town_home | town_shop | town_market |
#       field_temple | battle | charpanel | perf | ablate | ground

# —— 素材 ——
python tools/assets-build.py --check      # 校验 manifest 与文件是否对得上
node tools/portrait-sheet.js              # 立绘审查
```

### 3.2 当前回归基线（**换机后拿这三个对表**）

> ✅ 以下数字已于 **2026-09-25 换机前在本机实测复核**（smoke 通过 / playthrough 13 步逐字吻合 /
> rebirth 仙力 +386 / shot 共 42 张）。新机上跑出来不一致，基本就是环境问题，别怀疑代码。

**`smoke.js`** → `冒烟测试通过：脚本加载 + 标题/转世/镇/山/洞/战斗/死亡/轮回殿 全场景渲染无异常。`

**`playthrough.js`** → 最终一行：

```
  ⑬ 击杀狼王 · M0 通关   境界 炼气三段  灵气 4013  灵力 696  灵石 1422  战斗 16 场  任务 free
```

完整 13 步（**任何一步对不上就是回归**）：

```
 ① 入世             淬体一段    100    0   50   0 场 m0-1
 ② m0-1 教学        淬体一段    100    0   50   0 场 m0-1
 ③ 首战胜利          淬体一段    411   24   68   1 场 m0-1
 ④ 得灵石 → m0-2     淬体一段    411   24  118   1 场 m0-2
 ⑤ 杀手战 → m0-3     淬体一段   1411   24  218   1 场 m0-3
 ⑥ 珠内梦境 → m0-4   淬体一段   3911   24  218   1 场 m0-4
 ⑦ 淬体九段          淬体九段    221  344  458   9 场 m0-4
 ⑧ 沈伯赠丹          淬体九段    221  344  658   9 场 m0-4
 ⑨ 灵气备足          淬体九段   3331  584  838  14 场 m0-4
 ⑩ 心魔战 → 炼气一段  炼气一段    521  584  838  14 场 m0-5
 ⑪ 炼气三段          炼气三段   1013  696  922  16 场 m0-5
 ⑫ 入赤牙洞          炼气三段   1013  696  922  16 场 m0-5
 ⑬ 击杀狼王 · 通关    炼气三段   4013  696 1422  16 场 free
```

**`rebirth.js`** → 结尾三行：

```
  仙力合计  +386
  第 2 世变强（同 炼气三段）：攻击 41→43　防御 27→28　气血 382→394　速度 16→17
  轮回闭环通过：一世终结算 → 五线灌注 → 浮世重生，第 2 世确已变强。
```

**`bench-frame.js`（S=4 最小帧耗，软件光栅器）**：

| 场景 | ms/帧 |
|---|---|
| 镇 `town` | 1.9 – 2.1 |
| 野外 `field` | 2.7 – 3.4 |
| 洞 `cave` | 1.7 – 2.6 |
| 室内（四张） | 1.3 – 2.5 |

> 16.7ms 预算下余量 5 倍以上。**单轮噪声极大（同场景能差 2 倍），只认多轮最小值。**

**`browser-probe.js`** → `页面错误：无`，且 `超采样 S=3 美术 K=3 ✅ 一致`。

### 3.3 基线为什么会变（改数值前先想清楚）

改了数值公式/天赋/出身，上面这些数字**一定会动**。动之前先判断"这是预期内的还是断链"：

- v0.5.2 那次：战斗场次从 17 → 16 场，是因为出身给了灵气 +8%，更快攒够突破所需。
  **是合理结果，不是断链**。
- 判断方法：看 `playthrough` 的**逐步**输出，如果某一步的境界/任务突然错位，那才是真断链。

### 3.4 `www/_probe.html`

一个独立自检页：手动在浏览器打开，它会 `G.game.start()` → 进镇 → 走四向 → 进战斗 →
把"素材命中情况 / 精灵位图尺寸 / S 与 K / 页面错误"写进 `#probe-report`，
并把 `document.title` 设成 `PROBE_DONE`（方便脚本轮询）。
比 `browser-probe.js` 轻量，适合"我怀疑素材没生效"时手开一下。

---

## 4. 架构与硬约束

### 4.1 脚本加载顺序 = 依赖顺序

`index.html` 里的 `<script src>` 是**有序的**，而且**被 `smoke.js` / `shot.js` / `bench-frame.js`
用正则解析**（它们不自己维护脚本列表）。所以：

- 加/删 js 文件 → **只改 `index.html`**，测试会自动跟上（也会自动发现你漏改了）。
- 删了一个文件但忘了摘 `<script>` → 测试会报 `缺失脚本：xxx`。
- 顺序约定：`ns → rng/input/storage/assets/art/ui/sprites/game` →
  `data/*` → `player/mapgen/explore/overlays` → `scenes/*`。

### 4.2 分辨率与三级缓存（**最容易出错的地方**）

- 逻辑坐标恒为 **480×272**，内部超采样倍率 `G.game.S` 由 `resize()` 按窗口算：
  `S = clamp(ceil(显示倍率 × dpr), 3, 4)`。
- **`G.Art.K` 必须等于 `G.game.S`**，靠 `game._rebakeArt()` 保证。
- 缓存分三级，**改倍率要全清**，漏一级就会残留旧倍率位图：
  1. `G.Art` 的 `store`（`A.clear()` / `A.setK()`）
  2. `G.Sprites`（`Sprites.clear()`）
  3. `G.UI`（`UI.clearCache()`）
- **素材到货也要清这三级**（`game.js` 的 `Assets.load` 回调里）。只清 `Art` 的话，
  首个场景已经烘进去的程序化精灵会一直复用，表现成"人物形象和素材不一致"。
- 缓存画布是 **K 倍超采样**的：`x.drawImage(c, dx, dy, 逻辑宽, 逻辑高)`，
  给逻辑尺寸，别给像素尺寸。要从缓存画布上**取源矩形**（比如圆形头像）时，
  源坐标必须 **×K**。

### 4.3 场景是**单例**

`G.scenes[name]` 在脚本加载时创建一次，`enter()` 只重置它关心的字段。
**状态会跨进出复用**，所以：

- 每个 `enter()` 必须显式重置自己的瞬时状态。反例（真实 bug）：
  `explore.enter()` 忘了清 `flash/flashDir/_pending`，导致"在 A 图踩到暗雷、
  闪白没走完就离开、再回 A 图第一帧当场进战斗"。
- 测试里往场景上打的桩（比如覆盖 `_heldDir`）**必须还回去**，否则会污染后续用例。

### 4.4 UI 的硬约束

- **HUD 顶栏高度 `explore.js: HUD_H = 48`**，它同时是"点地不响应"的高度
  （`onTap` 里 `p.y < HUD_H`）。画得比它高 → "点在 HUD 上人却动了"。
- **数值绝不压在进度条上**。旧版把 `155 / 155` 画在血条正中，数字和条的高光叠一起，
  亮色地面背景直接糊成一片（用户明确报过"粗糙"）。一律排在条的**右侧**。
- 室内地图的家具**不能摆进 `y < 5`**，NPC 同理 —— 会被顶栏压住。
- `G.UI.icon` / `G.UI.panel` 等带缓存的件要复用；**HUD 是常驻层，每帧重建的渐变/路径
  都要预烘**（见 §5.6）。

### 4.5 数值来源（v0.5.2 之后）

角色面板上的数字**只有五个来源**，别再往里塞第六个中间层（六维就是这么被删掉的）：

```
computeStats = 境界成长  +  功法  ×(1 + 天赋百分比 + 出身百分比)  +  仙躯(meta.perfusion.body)
```

- 天赋与出身走**同一套聚合**：`Player.talentEffects()` 开头
  `mergeInto(e, save.originFx)`，然后逐个天赋 `mergeInto(e, t.e)`。
- 可用的效果键（`ADD_KEYS` / `MERGE_KEYS`）在 `player.js` 顶部，
  加新键要同步改这三处：`empty()`、`mergeInto()`、`ADD_KEYS`/`MERGE_KEYS`。
- 出身只发**百分比**，不发固定值 —— 发固定值面板上就会出现"看不见来源"的数字。

### 4.6 存档

- `localStorage`，键 `nichen_meta`（跨世）与 `nichen_save`（当世），各带一个 `_bak` 兜底。
- `meta` 存：`lives / xianli / totalXianli / perfusion{body,qi,po,stone,rescue} /
  pity / achieve / heaven / past[]`。
- 写完当世档要 `G.Storage.saveCurrent(save)`；切世时 `clearCurrent()`。

---

## 5. 踩过的坑（照抄别重犯）

> 这一节是**血泪清单**，每条都对应一个真实 bug。改相关代码前先读一眼。

### 5.1 无头测试的虚拟时钟必须单调递增

`tools/smoke.js` / `shot.js` 用虚拟时钟驱动 `requestAnimationFrame`。
以前每次 `pump()` 都重新 `let t = sandbox.performance.now()` 起算，而
`game.loop` 的 `this._last` 还停在上一次 pump 末尾 —— 虚拟时间每帧 +16.7ms，
几十帧就比真实时间快 1 秒多，于是**下一次 pump 的第一帧 `now - _last` 是负数**：

`dt` 变负 → 所有 `-= dt` 的计时器**倒着走** → 闪白从 1 涨到 4、
战斗 cue 永不结束、结算演出收不了尾。

**一个时钟 bug 能伪造出一整屏"游戏逻辑坏了"。** 现在虚拟时钟在模块加载时取一次基准、
跨 `pump()` 单调递增；`game.loop` 的 `dt` 也**上下都夹**（下夹 0，上夹 0.05）。

### 5.2 延迟渲染下"逐阶段计时"完全不可信

Canvas2D 是**延迟渲染**的，`drawImage` 只是把命令塞进 display list，
真正光栅化发生在 flush 时。给每个 `_draw*` 包一层计时，时间会被记到
"恰好触发 flush 的那一步"头上 —— 曾把地面层的开销全记到 `_drawDecor`，得出相反结论。

**要看真实开销，用消融**（把某一步换成空函数，比较整帧耗时的差值）。

### 5.3 消融的"基准帧间隔"也要先怀疑

`browser-probe ablate` 是**先灌 60 帧同步渲染、再采样 rAF**，合成器还压着一堆待画内容，
于是 `field / cave / field_temple` 会读到 **33.3ms（30fps）**，
而同一份代码 `bench-frame.js` 的最小帧耗只有 3–5ms —— **差 7 倍，是量法不是代码**。

**解读规则**：如果**每一个**步骤禁用后都得到同一个改善值
（`field` 里 13 个步骤全是 `-16.6ms`），说明**没有任何一步是瓶颈**，
只是整帧刚好越过 vsync 边界掉档；这时候"优化哪一步"是伪命题。
只有**少数几步**显著大于其它步时，才有真瓶颈。

可信的替代：`browser-probe perf` 的**「每帧」列**（`update+render` 的 60 帧同步平均），
`> 16.7ms` 才算真掉帧。

### 5.4 别在跑循环测试的同时改 `www/` 源码

`smoke.js` 每个进程启动时**读盘**。24 连跑时我中途改了 `ui.js`，
有 4 次跑到了重构中间态（语法错 → `G.UI` 没挂上），报了一屏
`Cannot read properties of undefined (reading 'Btn')` —— **假失败**。
干净环境重跑 24/24。跑循环测试时要么改文档，要么改完再跑。

### 5.5 立绘的取景与兜底链

- **三级兜底链**：`portrait.<key>` 素材 > `art.js: PORTRAIT_ART`（复用战斗立绘）
  > 程序化 `PORTRAIT_P`。漏掉中间这级，角色面板会显示一张跟地图上走着的人
  毫无关系的程序化半身像（用户报过"面板和人物不一致"）。
- 素材支会先量**不透明像素包围盒**（`contentBox`）再**按内容**居中 ——
  AI 出图四周留白不对称（刀往左伸、头发往右飘），按整图居中的话可见内容会整体偏出画心。
  裁完乘 `PORTRAIT_FIT = 0.92` 留呼吸位，否则头顶只剩 0.7px。
- **圆形头像的取景走显式表 `art.js: AVATAR_HEAD`，不要写自动检测**。
  实测 `battle.hero` 逐行 alpha 宽度是
  `y3:w3 → y10:w17 → y17:w11 → y24:w18 → y45:w25 → y56:w32`，
  **肩颈是平滑过渡，没有"脖子塌陷"这个断点**，任何"宽度突变就停"的启发式都会一路扫到腰
  （第一版头像里只剩一件蓝袍子）。立绘有两种版式（全身站姿 / 半身像），取景本来就不该同规则。
  **换立绘素材时这张表要一起改。**

### 5.6 HUD 是常驻层，每帧重建的渐变/路径都要预烘

`stone` 图标每次都要现建线性渐变、`qi`/`po` 要现描路径；资源格底与铭牌底
每帧现描圆角矩形 + 现填 + 现描边。这些在**每个探索场景每帧**都要跑一遍。
改成预烘后（`G.UI.icon` → `drawIcon` 预烘；底走带缓存的 `G.UI.panel`），
HUD 开销从 ~0.9–1.1ms/帧降到 **~0.5–0.7ms/帧**。

### 5.7 探索遭遇闪白（曾经的 P0）

`_encounter` 只置 `flash = 0; flashDir = 1`，而 `_checkFlash` 要求 `flash >= 1`，
**全项目没有一行推进 `flash`** → 暗雷一踩中**永久卡死**：`_pending` 永远排队、
`onTap` 因 `flashDir === 1` 永远 early return。手机上只有点击寻路，
表现就是"**这张图动不了**"（画面一切正常，没有任何提示）。v0.4.4 就上线了。

修法：`update()` 里 `flashDir === 1 → flash += dt * 3.2`（到 1 交给 `_checkFlash`）并 `return`。
回归用例：`smoke.js` 的 `encounter.enter`。

### 5.8 无头环境跑不到素材路径

`smoke.js` 等用的是**桩 canvas + 桩 fetch**，`fetch` 被桩成 reject，
`manifest` 永远加载失败 —— **素材路径在无头环境里根本跑不到**。
只有 `browser-probe.js`（真 Chrome）能回答"素材到底生效没有"。
`browser-probe.js` 需要**常驻**的 `http.server 8173`（用后台任务起），
中途断掉会让所有子资源变 502，表现为"驱动里 `window.G` 是 undefined"。

---

## 6. 已知遗留 / 下一步

### 6.1 待用户拍板

- **`doc/` 里的设计规格要不要回改？**
  `v0.1 角色成长与功法修炼系统规格`（六维）与 `v0.6 出身天赋与全流程`（幼年阶段）
  已与实现不符。目前按"版本快照"处理，没有回改。

### 6.2 明确未接线 / 未开工

| 项 | 状态 |
|---|---|
| `bg.battle` / `bg.cave` 背景素材 | 逻辑名已定，**未接线** |
| `portrait.elder` / `portrait.killer` | key 已备好，山神庙老者 / 杀手战仍是**纯文本覆盖层** |
| 真实 `portrait.*` 立绘素材 | 全走三级兜底（战斗立绘 / 程序化） |
| `android/` | Capacitor **未 init**，`npm run cap:sync` / `apk:debug` 现在会失败 |
| M1 内容 | 未开工 |
| 御兽 / 炼丹炼器 | 有规格（`doc/` v0.2），未实现 |

### 6.3 工具层面的欠账

- `browser-probe ablate` 的基准帧间隔不可信，应改成"丢弃预热帧 + 多轮取最小"。
- `bench-frame.js` 的头条数字只取 5 轮最小，在这台机器上噪声仍偏大；
  可以考虑加 `--rounds N` 参数。

### 6.4 建议的下一步

1. 先跑 §1.4 的三条自检，确认新环境与基线一致。
2. 开 `npm run serve` 手玩一遍 M0 主线（新档 → 赤炎狼王），感受一下当前手感。
3. 然后按用户意图推进 —— 大概率是 **M1 内容** 或 **补立绘/背景素材接线**。

---

## 7. Git 与协作

### 7.1 仓库

- 远程：`git@github.com:milkteacoffee/nichen.git`，默认分支 `main`
- 提交身份：**周鑫 `<h-zhoux11@vanke.com>`**
  （旧机写在仓库级 `git config`，换机后重新设一次：
  `git config user.name "周鑫" && git config user.email "h-zhoux11@vanke.com"`）
- 提交信息风格：`vX.Y.Z 逆尘：<一句话>（+ 正文分条说明）`，中文。

### 7.2 SSH

旧机用的是 `C:\Users\h-zhoux11\.ssh\id_ed25519_yitiandao`（ED25519，无口令）。
**这是本机专属文件，不会跟仓库走。** 换机后要么把私钥拷过去，要么在 GitHub 上
注册新机的公钥。验证：

```bash
ssh -T git@github.com
git ls-remote origin      # 能列出 refs 就通了
```

### 7.3 旧机的运行时路径（**仅作参考，换机后会变**）

```bash
# WorkBuddy 托管运行时
node   = D:/SoftWare/WorkBuddyAI/data/config/binaries/node/versions/22.22.2-3/node.exe
python = D:/SoftWare/WorkBuddyAI/data/config/binaries/python/envs/default/Scripts/python.exe
         （Pillow 12.3.0 装在这个 venv 里，不在 base）
NODE_PATH = D:/SoftWare/WorkBuddyAI/data/config/binaries/node/workspace/node_modules
            （@napi-rs/canvas 1.0.9）
```

新机上装好 §1.3 的两个依赖，把 `NODE_PATH` 指向你的 `node_modules` 即可。

### 7.4 `.gitignore` 与"什么不入库"

```
_gen/            切图中间产物（可重新生成）
_shots/          截图/审查输出
node_modules/
.workbuddy-ai/   ★ AI 的项目记忆（daily log + MEMORY.md）
*.log
```

> ⚠️ **`.workbuddy-ai/` 不入库**，所以换机后**项目记忆不会跟过来**。
> 那份记忆里有相当多的踩坑记录与经验。本文件（`HANDOVER.md`）已经把其中
> 对开发有长期价值的部分**搬了过来**（§4 / §5 / §6）。
> 新机上的 AI 会话如果需要更细的历史，可以看 git log 的提交正文
> —— v0.5.0 之后的提交都写了比较详细的分条说明。

---

## 8. 最近一次改了什么（v0.5.2，`814d8f2`）

用户报三件事，一次做完：

1. **角色面板的六维是错的** —— 角色只有攻击/生命/防御
   → **六维整体删除**（不是藏起来）。出身改发百分比（`save.originFx`），
   15 个发六维的天赋改写成百分比，死亡账目 `sixSum` → `atk`。
2. **不需要 1–16 岁选择事件加属性，太多太乱**
   → **幼年阶段整体删除**。`scenes/childhood.js` + `data/events.js` 已 `git rm`；
   `reincarnation.finish()` 直接产出入世态（16 岁 / `m0-1` / 进镇），并自己写 `birth` 大事记。
3. **主界面顶部做得很粗糙**，参考《烟雨江湖》《宝可梦》
   → **HUD 重做**：`HUD_H` 34 → 48；左圆头像 + 境界·第N世 + 气血/修为双条
   + 右上菜单 + 三格等宽资源；数值一律排到条的右侧（修掉 `155/155` 压在血条上的问题）。
   角色面板同步改成「攻击/气血/防御 三张主属性卡 + 2×2 次要属性格」。

验证：`smoke` 24/24、`playthrough` 新基线（见 §3.2）、`rebirth` 仙力 +386、
`shot` 42 张、`browser-probe` 六个场景页面错误全无。

---

## 9. 给下一个会话的最短上手路径

```bash
# 1) 拉代码 + 装依赖
git clone git@github.com:milkteacoffee/nichen.git && cd nichen
npm i -D @napi-rs/canvas && export NODE_PATH=./node_modules

# 2) 自检（三条都要过，且数字与 §3.2 一致）
node tools/smoke.js && node tools/playthrough.js && node tools/rebirth.js

# 3) 手玩
python -m http.server 8173 --directory www &
# 浏览器开 http://127.0.0.1:8173

# 4) 改完代码
node tools/smoke.js            # 必须过
node tools/shot.js 04_hud      # 看一眼 HUD 有没有被改坏
node tools/bench-frame.js      # 帧耗没退化
```

**改任何东西之前**，先读 §4（硬约束）和 §5（踩过的坑）。
**`www/assets/README.md` 是素材/美术方向的技术手册**，内容比本文件细，换皮前必读。
