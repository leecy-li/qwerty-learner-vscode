# Change Log

All notable changes to the "qwerty-learner" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.4.0] — 2026-05-31

### 新增
- **跨机同步**：`Qwerty Learner Export Known Words & State` 和
  `Qwerty Learner Import Known Words & State` 两个命令，把已会词、
  连续答对计数、当前练习位置以 JSON 导出，可在另一台机器导入。
  支持 diff 预览 + 章节倒退警告。
- 新增配置 `qwerty-learner.syncIncludesPreferences`（默认 false）
  控制导入/导出是否包含偏好设置（chapterLength、voiceType 等）。
- 新增配置 `qwerty-learner.autoPlayVoice`（默认 true）控制切换
  单词时是否自动发音。

### 修复
- **现代 Linux 上发音失效**：上游 `linux-x64.node` 依赖 libssl1.1，
  Ubuntu 24.04 等系统没有该库导致原生加载失败。重写为 Web Audio API
  + 扩展端 Node `https.get` 抓 mp3 → base64 → webview 解码播放，
  完全脱离 native module 依赖，真正跨平台。
- 发音 webview 从 editor tab 移到底部面板（WebviewView），
  可与 Terminal 一起 `Ctrl+J` 折叠，不再永久占编辑区。
- 音标默认值从 `close` 改为 `us`，状态栏默认即可看到 IPA 音标。

### TOEIC 词典质量提升
- 修正 14 个拼写错误（`duplicte`→`duplicate`、`emplyer`→`employer` 等）
- 解码 27 个 URL 转义条目（`baggage%20claim`→`baggage claim` 等）
- 清理 7 个 Webster 词典 scrape 残留
- 用其它词典 cross-ref 补齐 50+ 个 trans / 音标
- 用 LLM 知识为 10 个无 donor 的复合词补完整 trans + IPA
- 删除 36 个不属于 TOEIC 词汇的垃圾条目（单字母、ESL 后缀、人名等）
- 最终：1694 → 1658 词，所有条目均有完整翻译 + 美英双音标

### 调整
- 状态栏顺序改为 `[词信息] [输入] [<] [音标] [>] [trans]`，
  音标被切换按钮夹住，符合直觉。

## [Unreleased]