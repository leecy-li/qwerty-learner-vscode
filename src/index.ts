import { dictionaries } from './resource/dictionary'
import { DictPickItem } from './typings/index'
import * as vscode from 'vscode'
import { range } from 'lodash'
import { getConfig } from './utils'
import { soundPlayer } from './sound'
import { createVoicePlayer, registerVoiceView } from './resource/voice'
import PluginState from './utils/PluginState'

const PLAY_VOICE_COMMAND = 'qwerty-learner.playVoice'
const PREV_WORD_COMMAND = 'qwerty-learner.prevWord'
const NEXT_WORD_COMMAND = 'qwerty-learner.nextWord'
const TOGGLE_TRANSLATION_COMMAND = 'qwerty-learner.toggleTranslation'
const TOGGLE_DIC_NAME_COMMAND = 'qwerty-learner.toggleDicName'

export function activate(context: vscode.ExtensionContext) {
  const pluginState = new PluginState(context)
  const voiceProvider = registerVoiceView(context)
  const voicePlayer = createVoicePlayer(voiceProvider)

  const wordBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -100)
  const inputBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -101)
  const prevWord = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -102)
  const playVoiceBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -103)
  const nextWord = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -104)
  const translationBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -105)
  prevWord.text = '<'
  prevWord.tooltip = '切换上一个单词'
  prevWord.command = PREV_WORD_COMMAND
  nextWord.text = '>'
  nextWord.tooltip = '切换下一个单词'
  nextWord.command = NEXT_WORD_COMMAND
  playVoiceBar.command = PLAY_VOICE_COMMAND
  playVoiceBar.tooltip = '播放发音'
  translationBar.tooltip = '显示/隐藏中文翻译'
  translationBar.command = TOGGLE_TRANSLATION_COMMAND
  wordBar.command = TOGGLE_DIC_NAME_COMMAND
  wordBar.tooltip = '隐藏/显示字典名称'

  vscode.workspace.onDidChangeTextDocument((e) => {
    if (!pluginState.isStart) {
      return
    }

    if (pluginState.readOnlyMode) {
      return
    }

    const { uri } = e.document
    // 避免破坏配置文件
    if (uri.scheme.indexOf('vscode') !== -1) {
      return
    }

    const { range, text, rangeLength } = e.contentChanges[0]
    if (!(text !== '' && text.length === 1)) {
      return
    }
    // 删除用户输入的字符
    const newRange = new vscode.Range(range.start.line, range.start.character, range.end.line, range.end.character + 1)
    const editAction = new vscode.WorkspaceEdit()
    editAction.delete(uri, newRange)
    vscode.workspace.applyEdit(editAction)
    if (pluginState.hasWrong) {
      return
    }
    soundPlayer('click')
    inputBar.text = pluginState.getCurrentInputBarContent(text)

    const compareResult = pluginState.compareResult
    if (compareResult === -2) {
      // 用户完成单词输入
      soundPlayer('success')
      const autoMarked = pluginState.finishWord()
      if (autoMarked) {
        vscode.window.showInformationMessage(`🎯 ${autoMarked} 已掌握，自动加入已会列表`)
      }
      initializeBar()
    } else if (compareResult >= 0) {
      pluginState.wrongInput()
      inputBar.color = pluginState.highlightWrongColor
      soundPlayer('wrong')
      setTimeout(() => {
        pluginState.clearWrong()
        inputBar.color = undefined
        initializeBar()
      }, pluginState.highlightWrongDelay)
    }
  })

  vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('qwerty-learner.placeholder')) {
      pluginState.placeholder = getConfig('placeholder')
      initializeBar()
    }

    if (event.affectsConfiguration('qwerty-learner.chapterLength')) {
      pluginState.chapterLength = getConfig('chapterLength')
      initializeBar()
    }
  })

  // 注册 vscode commands
  context.subscriptions.push(
    ...[
      vscode.commands.registerCommand('qwerty-learner.start', () => {
        pluginState.isStart = !pluginState.isStart
        if (pluginState.isStart) {
          initializeBar()
          wordBar.show()
          inputBar.show()
          playVoiceBar.show()
          prevWord.show()
          nextWord.show()
          translationBar.show()
          if (pluginState.readOnlyMode) {
            setUpReadOnlyInterval()
          }
        } else {
          wordBar.hide()
          inputBar.hide()
          playVoiceBar.hide()
          prevWord.hide()
          nextWord.hide()
          translationBar.hide()
          removeReadOnlyInterval()
        }
      }),
      vscode.commands.registerCommand('qwerty-learner.changeChapter', async () => {
        const inputChapter = await vscode.window.showQuickPick(
          range(1, pluginState.totalChapters + 1).map((i) => i.toString()),
          { placeHolder: `当前章节: ${pluginState.chapter + 1}   共 ${pluginState.totalChapters}章节` },
        )
        if (inputChapter !== undefined) {
          pluginState.chapter = parseInt(inputChapter) - 1
          initializeBar()
        }
      }),
      vscode.commands.registerCommand('qwerty-learner.changeDict', async () => {
        const dictList: DictPickItem[] = []
        dictionaries.forEach((dict) => {
          dictList.push({ label: dict.name, path: dict.url, detail: dict.description, key: dict.id })
        })
        const inputDict = await vscode.window.showQuickPick(dictList, { placeHolder: `当前字典: ${pluginState.dict.name}` })
        if (inputDict !== undefined) {
          pluginState.dictKey = inputDict.key
          initializeBar()
        }
      }),
      vscode.commands.registerCommand('qwerty-learner.toggleWordVisibility', () => {
        pluginState.wordVisibility = !pluginState.wordVisibility
        initializeBar()
      }),
      vscode.commands.registerCommand('qwerty-learner.toggleReadOnlyMode', () => {
        pluginState.readOnlyMode = !pluginState.readOnlyMode
        if (pluginState.readOnlyMode) {
          setUpReadOnlyInterval()
        } else {
          removeReadOnlyInterval()
        }
      }),
      vscode.commands.registerCommand(PLAY_VOICE_COMMAND, playVoice),
      vscode.commands.registerCommand(TOGGLE_TRANSLATION_COMMAND, () => {
        pluginState.toggleTranslation()
        initializeBar()
      }),
      vscode.commands.registerCommand(TOGGLE_DIC_NAME_COMMAND, () => {
        pluginState.toggleDictName()
        wordBar.text = pluginState.getInitialWordBarContent()
      }),
      vscode.commands.registerCommand(PREV_WORD_COMMAND, () => {
        pluginState.prevWord()
        initializeBar()
      }),
      vscode.commands.registerCommand(NEXT_WORD_COMMAND, () => {
        pluginState.nextWord()
        initializeBar()
      }),
      vscode.commands.registerCommand('qwerty-learner.toggleChapterCycleMode', () => {
        pluginState.chapterCycleMode = !pluginState.chapterCycleMode
        if (pluginState.chapterCycleMode) {
          vscode.window.showInformationMessage('章节循环模式已开启')
        } else {
          vscode.window.showInformationMessage('章节循环模式已关闭')
        }
      }),
      vscode.commands.registerCommand('qwerty-learner.markCurrentWordAsKnown', () => {
        if (!pluginState.isStart) {
          return
        }
        const w = pluginState.currentWord
        if (!w) {
          return
        }
        const name = w.name
        pluginState.markKnown(name)
        vscode.window.showInformationMessage(`✓ ${name} 已加入已会列表`)
        initializeBar()
      }),
      vscode.commands.registerCommand('qwerty-learner.viewKnownStats', () => {
        vscode.window.showInformationMessage(
          `当前词典 [${pluginState.dict.name}]: 已会 ${pluginState.knownCount} / 共 ${pluginState.totalDictSize}`,
        )
      }),
      vscode.commands.registerCommand('qwerty-learner.unmarkAllKnown', async () => {
        const ok = await vscode.window.showWarningMessage(
          `确定清空 [${pluginState.dict.name}] 的全部已会记录吗？此操作无法撤销。`,
          { modal: true },
          '确定',
        )
        if (ok === '确定') {
          pluginState.unmarkAllKnownForCurrentDict()
          vscode.window.showInformationMessage('已重置当前词典的已会列表')
          if (pluginState.isStart) {
            initializeBar()
          }
        }
      }),
      vscode.commands.registerCommand('qwerty-learner.exportKnown', async () => {
        const includePref = !!getConfig('syncIncludesPreferences')
        const payload = pluginState.exportState(includePref)
        const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
        const defaultName = `qwerty-learner-known-${today}.json`
        const uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(defaultName),
          filters: { JSON: ['json'] },
          saveLabel: 'Export',
        })
        if (!uri) return
        const fs = require('fs')
        try {
          fs.writeFileSync(uri.fsPath, JSON.stringify(payload, null, 2), 'utf-8')
          const totalKnown = Object.values(payload.knownWords).reduce((a, b) => a + b.length, 0)
          vscode.window.showInformationMessage(
            `✓ 已导出 ${Object.keys(payload.knownWords).length} 个词典，共 ${totalKnown} 个已会词` +
              (includePref ? '（含偏好设置）' : '（不含偏好设置）'),
          )
        } catch (err: any) {
          vscode.window.showErrorMessage(`导出失败: ${err.message ?? err}`)
        }
      }),
      vscode.commands.registerCommand('qwerty-learner.importKnown', async () => {
        const includePref = !!getConfig('syncIncludesPreferences')
        const uris = await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { JSON: ['json'] },
          openLabel: 'Import',
        })
        if (!uris || uris.length === 0) return

        const fs = require('fs')
        let payload: any
        try {
          const raw = fs.readFileSync(uris[0].fsPath, 'utf-8')
          payload = JSON.parse(raw)
        } catch (err: any) {
          vscode.window.showErrorMessage(`无法解析导入文件: ${err.message ?? err}`)
          return
        }
        if (!payload || typeof payload !== 'object' || payload.version !== 1) {
          vscode.window.showErrorMessage(`导入文件 version 不识别（仅支持 version=1）`)
          return
        }

        const preview = pluginState.previewImport(payload)

        // 构建 diff 摘要
        const lines: string[] = []
        lines.push(`来源时间: ${payload.exportedAt ?? '未知'}`)
        lines.push('')
        lines.push('【已会词典】')
        for (const k of Object.keys(preview.knownDelta)) {
          const d = preview.knownDelta[k]
          lines.push(`  ${k}: 当前 ${d.current} → 合并后 ${d.current + d.newlyAdded}  (新增 ${d.newlyAdded})`)
        }
        if (preview.sessionDiff) {
          const cur = preview.sessionDiff.current
          const inc = preview.sessionDiff.incoming
          lines.push('')
          lines.push('【当前会话】')
          lines.push(`  词典: ${cur.dictKey} → ${inc.dictKey}`)
          lines.push(`  章节: ${cur.chapter + 1} → ${inc.chapter + 1}${preview.sessionRegression ? '  ⚠ 倒退' : ''}`)
          lines.push(`  位置: ${cur.order + 1} → ${inc.order + 1}`)
        }
        lines.push('')
        lines.push(`【Streak】将更新 ${preview.streakChanges} 个词的连续答对计数`)
        if (preview.preferencesChanges !== null) {
          if (includePref) {
            lines.push(`【偏好设置】将更新 ${preview.preferencesChanges} 项 VSCode 配置`)
          } else {
            lines.push(`【偏好设置】文件中含偏好但当前 syncIncludesPreferences=false，跳过`)
          }
        }

        const confirmLabel = preview.sessionRegression ? '仍然导入 (含倒退)' : '确认导入'
        const choice = await vscode.window.showInformationMessage(
          lines.join('\n'),
          { modal: true },
          confirmLabel,
        )
        if (choice !== confirmLabel) return

        try {
          pluginState.applyImport(payload, includePref)
          vscode.window.showInformationMessage('✓ 导入完成')
          if (pluginState.isStart) {
            initializeBar()
          }
        } catch (err: any) {
          vscode.window.showErrorMessage(`导入失败: ${err.message ?? err}`)
        }
      }),
    ],
  )

  function initializeBar() {
    setUpWordBar()
    setUpPlayVoiceBar()
    setUpTranslationBar()
    setUpInputBar()
  }
  function playVoice() {
    if (pluginState.shouldPlayVoice) {
      pluginState.voiceLock = true
      voicePlayer(pluginState.currentWord.name, () => {
        pluginState.voiceLock = false
      })
    }
  }
  function setUpWordBar() {
    wordBar.text = pluginState.getInitialWordBarContent()
    if (getConfig('autoPlayVoice')) {
      playVoice()
    }
  }
  function setUpPlayVoiceBar() {
    playVoiceBar.text = pluginState.getInitialPlayVoiceBarContent()
  }
  function setUpTranslationBar() {
    translationBar.text = pluginState.getInitialTranslationBarContent()
  }
  function setUpInputBar() {
    inputBar.text = pluginState.getInitialInputBarContent()
  }

  function setUpReadOnlyInterval() {
    if (!pluginState.readOnlyIntervalId) {
      pluginState.readOnlyIntervalId = setInterval(() => {
        const autoMarked = pluginState.finishWord()
        if (autoMarked) {
          vscode.window.showInformationMessage(`🎯 ${autoMarked} 已掌握，自动加入已会列表`)
        }
        initializeBar()
      }, pluginState.readOnlyInterval)
    }
  }
  function removeReadOnlyInterval() {
    if (pluginState.readOnlyIntervalId) {
      clearInterval(pluginState.readOnlyIntervalId)
      pluginState.readOnlyIntervalId = null
    }
  }
}
