# Qwerty Learner VSCode 用户手册（leecy 自用版）

## 0. 这是什么

VSCode 摸鱼背单词扩展。在状态栏显示一个单词，你边写代码边盲打，打完自动切下一个。

本仓库基于 [Kaiyiwing/qwerty-learner-vscode](https://github.com/Kaiyiwing/qwerty-learner-vscode)（MIT 协议）fork，主要在原版基础上**增加了「标记已会词并跳过」功能**：背过的词以后自动从练习池移除，只练不熟的。

**仅供本人自用，不发布到 VS Code Marketplace。**
版本号沿用上游 `0.3.9`，未单独 bump；后续若有冲突再升。

---

## 1. 安装

### 前置条件

- VSCode ≥ 1.75
- 如果原本装了官方 `kaiyi.qwerty-learner`，**先卸载或禁用**，否则会冲突

### 步骤

1. 在仓库目录里有打包好的 `qwerty-learner-0.3.9.vsix`
2. VSCode 命令面板（`Ctrl+Shift+P`）→ 输入 `Install from VSIX` → 回车
3. 选 `/home/leecy/repo/qwerty-learner-vscode/qwerty-learner-0.3.9.vsix`
4. 重启 VSCode（或 reload window）让插件生效

### 验证安装

`Ctrl+Shift+P` 搜 `Qwerty Learner`，能看到 10 条命令就装好了。

### 卸载

Extensions 面板 → 找到 `Qwerty Learner` → 齿轮 → Uninstall。
已会词记录存在 VSCode `globalState` 里，卸载会一起清。

---

## 2. 第一次使用（30 秒上手）

1. 随便打开/新建一个文件（不能在 Welcome 页面，需要 `editorTextFocus`）
2. 按 `Ctrl+Shift+Q` 启动 —— 状态栏底部左下角出现单词
3. 直接在编辑器里盲打这个单词。打对自动切下一个，打错红色提示后会清空让你重打
4. 想暂停：再按一次 `Ctrl+Shift+Q`

---

## 3. 功能详解

### 3.1 基础功能（来自上游）

| 操作 | 入口 |
|---|---|
| 启动 / 暂停 | `Ctrl+Shift+Q` |
| 切换词典 | 命令面板 → `Qwerty Learner Change Dictionary` |
| 跳转章节 | 命令面板 → `Qwerty Learner Change Chapter` |
| 显示 / 隐藏当前词 | 命令面板 → `Qwerty Learner Toggle Word Visibility` |
| 显示 / 隐藏中文翻译 | 点状态栏的眼睛图标 |
| 切换发音 | 在设置里改 `voiceType`（us/uk/close） |
| 只读模式（自动切词） | 命令面板 → `Qwerty Learner Toggle Read Only Mode` |
| 章节循环 | `Ctrl+Shift+C`（同一章反复练，不进下一章） |
| 上一词 / 下一词 | 点状态栏的 `<` / `>` |

### 3.2 ⭐ 新增：跳过已会词

**问题**：原版每次启动都从头开始，背过的简单词还要再打一遍，浪费时间。
**解决**：把会的词标记掉，从此练习池里就没它了，永久跳过。

#### 手动标记（一键跳过）

练词过程中觉得「这词我熟，不想再练了」，按 `Shift+Alt+K`（Mac: `Ctrl+Shift+K`）：

- 当前词立刻从练习池移除
- 弹通知 `✓ <word> 已加入已会列表`
- 自动跳到下一个词
- 章节边界自动收缩（不会卡在空章节）

#### 自动标记（连续答对几次就自动跳过）

设置项 `qwerty-learner.autoMarkThreshold`（默认 `3`）：连续 N 次**整轮无错完成**同一个词，自动标记为已会，弹通知 `🎯 <word> 已掌握，自动加入已会列表`。

- 「整轮」= `wordExerciseTime` 设的次数（默认 1）。比如阈值 3 + 每词练 1 次 = 连续 3 次无错完成才自动标
- 中间打错一次，streak 清零重新数
- 设为 `0` 关闭自动标记

#### 查看已会统计

命令面板 → `Qwerty Learner View Known Stats`
弹提示：`当前词典 [CET-4]: 已会 42 / 共 4034`

#### 重置当前词典的已会列表

命令面板 → `Qwerty Learner Unmark All Known (Current Dict)`
有 modal 二次确认，确定后清空当前词典的所有已会记录与连续答对计数。

**注意**：只清当前词典的。切到其他词典不影响。

#### 已会词存储说明

- 存在 VSCode `globalState`，按词典隔离（`cet4`、`cet6`、`gre`... 各自一份）
- 走 VSCode Settings Sync，登录同账号的多台机器会同步
- 卸载扩展会一起清掉
- 章节会因为已会词被剔除而**重新分块**：比如原本 4034 词、每章 20，标了 42 个之后总词数 3992，第 200 章会比之前的 200 章里的内容稍有不同（接受这个行为）

---

## 4. 快捷键速查

| 快捷键（Win/Linux） | Mac | 功能 |
|---|---|---|
| `Shift+Alt+Q` | `Ctrl+Shift+Q` | 启动 / 暂停 |
| `Shift+Alt+C` | `Ctrl+Shift+C` | 章节循环模式开关 |
| `Shift+Alt+K` | `Ctrl+Shift+K` | **标记当前词为已会**（新） |

其他功能走命令面板（`Ctrl+Shift+P` 搜 `Qwerty Learner`）。

---

## 5. 全部配置项

`Ctrl+,` 打开 Settings，搜 `qwerty-learner`。

| 配置项 | 默认 | 说明 |
|---|---|---|
| `keySound` | `true` | 键盘音效 |
| `phonetic` | `close` | 音标显示（`us` / `uk` / `close`） |
| `voiceType` | `us` | 发音（`us` / `uk` / `close`） |
| `chapterLength` | `20` | 每章单词数 |
| `wordExerciseTime` | `1` | 每个词需练习几次 |
| `placeholder` | `-` | 输入区占位符样式 |
| `random` | `false` | 章节内随机顺序 |
| `highlightWrongColor` | `#EE3D11` | 输错时的高亮色 |
| `highlightWrongDelay` | `400` | 输错后清空输入的延迟（ms） |
| `readOnlyInterval` | `5000` | 只读模式切词间隔（ms） |
| **`autoMarkThreshold`** | **`3`** | **连续无错完成几次自动标记（0 关闭）** |

---

## 6. 注意事项 & 已知问题

- **快捷键 `Shift+Alt+K` 在某些 VSCode 主题里和「无序选择全部出现位置」冲突**。如有冲突，去 `File → Preferences → Keyboard Shortcuts` 搜 `markCurrentWordAsKnown` 改键
- **`editorTextFocus` 限制**：所有快捷键只在编辑器获焦时生效。在终端、Welcome 页、设置 UI 里按没反应
- **版本号 `0.3.9` 与上游同号**：如果之后跟上游某次升级冲突（比如上游真发了 0.4.0），按上游版本 + 0.0.1 重新 bump 即可
- **已会词不导出**：目前只能在 VSCode 内部 `globalState` 里，没有导出到 JSON 的功能。如果以后切机器或想备份，可以再加（让 Claude 接着加就行）

---

## 7. 二次开发

完整开发流程见仓库根目录的 `HANDOFF.md`（已在 `.gitignore` 中，仅本地存档）。

简单回顾：

```bash
yarn install            # 装依赖
yarn run watch          # 开发时持续编译
# F5 启动 Extension Development Host 调试
yarn run compile        # 一次性编译
npx @vscode/vsce package   # 打包 .vsix
```

要再加新功能（比如「已会词清单查看 UI」「按章节级别标记」「导入/导出已会列表」），直接告诉 Claude 改就行。
