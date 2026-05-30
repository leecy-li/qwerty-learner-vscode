import { DictionaryResource } from '@/typings'
import { VoiceType } from './../typings/index'
import { idDictionaryMap } from './../resource/dictionary'
import { compareWord, getConfig, getDictFile } from '.'
import * as vscode from 'vscode'
import { Word } from '@/typings'

export default class PluginState {
  private _globalState: vscode.Memento

  private _dictKey: string
  private dictWords: Word[]
  public dict: DictionaryResource
  public hideDictName: boolean

  public chapterLength: number
  private _readOnlyMode: boolean
  public readOnlyIntervalId: NodeJS.Timeout | null
  public placeholder: string

  public _wordVisibility: boolean
  private currentExerciseCount: number

  private _order: number
  private _chapter: number
  public isStart: boolean
  public hasWrong: boolean
  private curInput: string
  public chapterCycleMode: boolean

  public voiceLock: boolean
  public translationVisible: boolean

  private _wordList: {
    wordList: Word[]
    chapter: number
    dictKey: string
  }

  // 已会词存储：每个词典各自维护一份
  private _knownWords: Record<string, Set<string>>
  // 每个词典中每个词的「连续完美完成次数」，用于自动标记
  private _perfectStreaks: Record<string, Record<string, number>>
  // 当前单词在本轮练习中是否打错过（影响 streak 是否累加）
  private _hadWrongInCurrentWord: boolean

  constructor(context: vscode.ExtensionContext) {
    const globalState = context.globalState
    this._globalState = globalState
    globalState.setKeysForSync(['chapter', 'dictKey', 'knownWords', 'perfectStreaks'])

    this._dictKey = globalState.get('dictKey', 'cet4')
    this.dict = idDictionaryMap[this._dictKey]
    this.dictWords = []
    this.hideDictName = false

    const rawKnown = globalState.get<Record<string, string[]>>('knownWords', {})
    this._knownWords = {}
    for (const k of Object.keys(rawKnown)) {
      this._knownWords[k] = new Set(rawKnown[k])
    }
    this._perfectStreaks = globalState.get<Record<string, Record<string, number>>>('perfectStreaks', {})
    this._hadWrongInCurrentWord = false

    this.loadDict()

    this._order = globalState.get('order', 0)
    this._chapter = globalState.get('chapter', 0)
    this.isStart = false
    this.hasWrong = false
    this.curInput = ''
    this.currentExerciseCount = 0

    this.chapterLength = getConfig('chapterLength')
    this._readOnlyMode = false
    this.readOnlyIntervalId = null
    this.placeholder = getConfig('placeholder') // 用于控制word不可见时，inputBar中是否出现占位符及样式
    this.chapterCycleMode = false

    this._wordVisibility = globalState.get('wordVisibility', true)

    this.voiceLock = false

    this.translationVisible = true
    this._wordList = {
      wordList: [],
      chapter: 0,
      dictKey: this._dictKey,
    }
  }

  get chapter(): number {
    return this._chapter
  }
  set chapter(value: number) {
    this._chapter = value
    this.order = 0
    this.currentExerciseCount = 0
    this._globalState.update('chapter', this._chapter)
    this._globalState.update('order', this.order)
  }

  get order(): number {
    return this._order
  }
  set order(value: number) {
    this._order = value
    this._globalState.update('order', this._order)
  }

  get dictKey(): string {
    return this._dictKey
  }
  set dictKey(value: string) {
    this.order = 0
    this.currentExerciseCount = 0
    this.chapter = 0
    this._dictKey = value
    this.dict = idDictionaryMap[this._dictKey]
    this._globalState.update('dictKey', this._dictKey)
    this.loadDict()
  }

  get wordExerciseTime(): number {
    return getConfig('wordExerciseTime')
  }
  // 过滤掉已会词后的词典池（不含切片）
  private get filteredDictWords(): Word[] {
    const known = this._knownWords[this._dictKey]
    if (!known || known.size === 0) {
      return this.dictWords
    }
    return this.dictWords.filter((w) => !known.has(w.name))
  }

  get wordList(): Word[] {
    if (this._wordList.wordList.length > 0 && this._wordList.dictKey === this.dictKey && this._wordList.chapter === this.chapter) {
      return this._wordList.wordList
    } else {
      const filtered = this.filteredDictWords
      let wordList = filtered.slice(this.chapter * this.chapterLength, (this.chapter + 1) * this.chapterLength)
      wordList.forEach((word) => {
        // API 字典会出现括号，但部分 vscode 插件会拦截括号的输入
        word.name = word.name.replace('(', '').replace(')', '')
      })

      const isRandom = getConfig('random')
      if (isRandom) {
        wordList = wordList.sort(() => Math.random() - 0.5)
      }

      this._wordList = {
        wordList,
        chapter: this.chapter,
        dictKey: this.dictKey,
      }

      return wordList
    }
  }

  private invalidateWordListCache() {
    this._wordList = { wordList: [], chapter: -1, dictKey: '' }
  }

  get wordVisibility(): boolean {
    return this._wordVisibility
  }
  set wordVisibility(value: boolean) {
    this._wordVisibility = value
    this._globalState.update('wordVisibility', this._wordVisibility)
  }

  get totalChapters(): number {
    const pool = this.filteredDictWords
    if (pool && pool.length > 0) {
      return Math.ceil(pool.length / this.chapterLength)
    } else {
      return 0
    }
  }

  get autoMarkThreshold(): number {
    return getConfig('autoMarkThreshold') ?? 3
  }

  get knownCount(): number {
    return this._knownWords[this._dictKey]?.size ?? 0
  }

  get totalDictSize(): number {
    return this.dictWords.length
  }

  isKnown(name: string): boolean {
    return this._knownWords[this._dictKey]?.has(name) ?? false
  }

  markKnown(name: string): void {
    if (!this._knownWords[this._dictKey]) {
      this._knownWords[this._dictKey] = new Set()
    }
    this._knownWords[this._dictKey].add(name)
    this.persistKnownWords()

    // 已会的词不再需要记录 streak
    if (this._perfectStreaks[this._dictKey]) {
      delete this._perfectStreaks[this._dictKey][name]
      this.persistStreaks()
    }

    this.invalidateWordListCache()
    this.clampChapterAndOrder()

    // 当前词被移出练习池，重置每词练习状态，避免 curInput 残留到下一个词
    this.curInput = ''
    this.currentExerciseCount = 0
    this._hadWrongInCurrentWord = false
  }

  unmarkAllKnownForCurrentDict(): void {
    this._knownWords[this._dictKey] = new Set()
    this._perfectStreaks[this._dictKey] = {}
    this.persistKnownWords()
    this.persistStreaks()
    this.invalidateWordListCache()
  }

  private persistKnownWords(): void {
    const serializable: Record<string, string[]> = {}
    for (const k of Object.keys(this._knownWords)) {
      serializable[k] = Array.from(this._knownWords[k])
    }
    this._globalState.update('knownWords', serializable)
  }

  private persistStreaks(): void {
    this._globalState.update('perfectStreaks', this._perfectStreaks)
  }

  /**
   * 章节或顺序可能因为已会词数量变化而越界，需要 clamp 到合法范围
   */
  private clampChapterAndOrder(): void {
    const total = this.totalChapters
    if (total === 0) {
      this._chapter = 0
      this._order = 0
      return
    }
    if (this._chapter >= total) {
      this._chapter = total - 1
      this._globalState.update('chapter', this._chapter)
    }
    const list = this.wordList
    if (this._order >= list.length) {
      this._order = Math.max(0, list.length - 1)
      this._globalState.update('order', this._order)
    }
  }

  /**
   * 用户完成当前单词的一次输入后调用。
   * @returns true 表示该词刚刚因连续答对达到阈值，已被自动标记为已会
   */
  private bumpPerfectStreak(name: string): boolean {
    if (this.autoMarkThreshold <= 0) {
      return false
    }
    if (!this._perfectStreaks[this._dictKey]) {
      this._perfectStreaks[this._dictKey] = {}
    }
    const bucket = this._perfectStreaks[this._dictKey]
    bucket[name] = (bucket[name] ?? 0) + 1
    if (bucket[name] >= this.autoMarkThreshold) {
      // 达到阈值，自动标记。markKnown 内部会清掉这个 streak。
      this.markKnown(name)
      return true
    }
    this.persistStreaks()
    return false
  }

  private resetPerfectStreak(name: string): void {
    if (this._perfectStreaks[this._dictKey]?.[name]) {
      delete this._perfectStreaks[this._dictKey][name]
      this.persistStreaks()
    }
  }

  get currentWord(): Word {
    return this.wordList[this.order]
  }
  get compareResult(): number {
    return compareWord(this.currentWord.name, this.curInput)
  }
  get highlightWrongColor(): string {
    return getConfig('highlightWrongColor')
  }
  get highlightWrongDelay(): number {
    return getConfig('highlightWrongDelay')
  }
  get readOnlyMode(): boolean {
    return this._readOnlyMode
  }
  set readOnlyMode(value: boolean) {
    this._readOnlyMode = value
    this._globalState.update('readOnlyMode', this._readOnlyMode)
  }
  get readOnlyInterval(): number {
    return getConfig('readOnlyInterval')
  }
  get voiceType(): VoiceType {
    return getConfig('voiceType')
  }
  get shouldPlayVoice(): boolean {
    return this.voiceType !== 'close' && !this.voiceLock
  }

  wrongInput() {
    this.hasWrong = true
    this.curInput = ''
    this._hadWrongInCurrentWord = true
  }

  clearWrong() {
    this.hasWrong = false
  }

  /**
   * @returns 若该单词刚因连续答对被自动标记为已会，则返回该单词；否则返回 null
   */
  finishWord(): string | null {
    const finishedWordName = this.currentWord?.name ?? ''
    this.curInput = ''
    this.currentExerciseCount += 1

    let autoMarkedWord: string | null = null
    if (this.currentExerciseCount >= this.wordExerciseTime) {
      // 本词的所有练习次数已完成，根据是否打错过来更新 streak
      if (finishedWordName) {
        if (this._hadWrongInCurrentWord) {
          this.resetPerfectStreak(finishedWordName)
        } else {
          const justMarked = this.bumpPerfectStreak(finishedWordName)
          if (justMarked) {
            autoMarkedWord = finishedWordName
          }
        }
      }
      this.nextWord()
    }
    this.voiceLock = false
    return autoMarkedWord
  }

  prevWord() {
    if (this.order > 0) {
      this.order -= 1
      this.currentExerciseCount = 0
      this._hadWrongInCurrentWord = false
    }
  }

  nextWord() {
    if (this.order === this.wordList.length - 1) {
      //是否章节循环
      if (this.chapterCycleMode) {
      } else {
        // 结束本章节
        if (this.chapter === this.totalChapters - 1) {
          this.chapter = 0
        } else {
          this.chapter += 1
        }
      }

      this.order = 0
    } else {
      this.order += 1
    }
    this.currentExerciseCount = 0
    this._hadWrongInCurrentWord = false
  }
  toggleDictName() {
    this.hideDictName = !this.hideDictName
  }

  toggleTranslation() {
    this.translationVisible = !this.translationVisible
  }
  getInitialWordBarContent() {
    const name = this.hideDictName ? '' : this.dict.name
    return `${name} chp.${this.chapter + 1}  ${this.order + 1}/${this.wordList.length}  ${this.wordVisibility ? this.currentWord.name : ''}`
  }

  getInitialInputBarContent() {
    let content = ''
    if (this.wordVisibility || this.placeholder === '') {
      content = ''
    } else {
      // 拼接占位符
      content = this.placeholder.repeat(this.currentWord.name.length)
    }
    return content
  }

  getInitialPlayVoiceBarContent() {
    let content = `/${this._getCurrentWordPhonetic()}/`
    content = content.replace(/\n/g, ' ')
    return content
  }
  getInitialTranslationBarContent() {
    const content = this.translationVisible ? '$(eye)' : this.currentWord.trans.join('; ')
    return content
  }

  getCurrentInputBarContent(input: string) {
    let content = ''
    if (this.wordVisibility || this.placeholder === '') {
      // 没有使用placeholder，不需要特殊处理
      this.curInput += input
      content = this.curInput
    } else {
      // 拼接占位符 && 获取当前已经键入的值进行比较
      this.curInput += input
      content = this.curInput + this.placeholder.repeat(this.currentWord.name.length - this.curInput.length)
    }
    return content
  }

  private _getCurrentWordPhonetic() {
    let phonetic = ''
    switch (getConfig('phonetic')) {
      case 'us':
        phonetic = this.currentWord.usphone || ''
        break
      case 'uk':
        phonetic = this.currentWord.ukphone || ''
        break
      case 'close':
        phonetic = ''
        break
    }
    return phonetic
  }

  private loadDict() {
    this.dictWords = getDictFile(this.dict.url)
  }

  // ============================================================
  // 跨机同步 (export / import)
  // ============================================================

  /**
   * 导出当前所有学习状态为可序列化对象
   */
  exportState(includePreferences: boolean): ExportPayload {
    const knownWords: Record<string, string[]> = {}
    for (const k of Object.keys(this._knownWords)) {
      knownWords[k] = Array.from(this._knownWords[k])
    }
    const payload: ExportPayload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      knownWords,
      perfectStreaks: this._perfectStreaks,
      session: {
        dictKey: this._dictKey,
        chapter: this._chapter,
        order: this._order,
      },
    }
    if (includePreferences) {
      const config = vscode.workspace.getConfiguration('qwerty-learner')
      payload.preferences = {
        wordVisibility: this._wordVisibility,
        settings: {
          keySound: config.get('keySound'),
          phonetic: config.get('phonetic'),
          chapterLength: config.get('chapterLength'),
          wordExerciseTime: config.get('wordExerciseTime'),
          voiceType: config.get('voiceType'),
          placeholder: config.get('placeholder'),
          random: config.get('random'),
          autoMarkThreshold: config.get('autoMarkThreshold'),
          autoPlayVoice: config.get('autoPlayVoice'),
        },
      }
    }
    return payload
  }

  /**
   * 计算导入会带来的变化（不实际应用），用于显示 diff 给用户确认
   */
  previewImport(payload: ExportPayload): ImportPreview {
    const knownDelta: Record<string, { current: number; incoming: number; newlyAdded: number }> = {}
    for (const k of Object.keys(payload.knownWords || {})) {
      const cur = this._knownWords[k] ?? new Set<string>()
      const inc = new Set(payload.knownWords[k])
      let newly = 0
      for (const w of inc) {
        if (!cur.has(w)) newly++
      }
      knownDelta[k] = { current: cur.size, incoming: inc.size, newlyAdded: newly }
    }

    let sessionDiff: ImportPreview['sessionDiff'] = null
    let sessionRegression = false
    if (payload.session) {
      const inc = payload.session
      const cur = { dictKey: this._dictKey, chapter: this._chapter, order: this._order }
      if (inc.dictKey !== cur.dictKey || inc.chapter !== cur.chapter || inc.order !== cur.order) {
        sessionDiff = { current: cur, incoming: inc }
        // 同字典下章节倒退算 regression
        if (inc.dictKey === cur.dictKey && (inc.chapter < cur.chapter || (inc.chapter === cur.chapter && inc.order < cur.order))) {
          sessionRegression = true
        }
      }
    }

    let streakChanges = 0
    for (const dk of Object.keys(payload.perfectStreaks || {})) {
      for (const w of Object.keys(payload.perfectStreaks[dk] || {})) {
        const cur = this._perfectStreaks[dk]?.[w] ?? 0
        const inc = payload.perfectStreaks[dk][w]
        if (Math.max(cur, inc) !== cur) streakChanges++
      }
    }

    let preferencesChanges: number | null = null
    if (payload.preferences) {
      preferencesChanges = 0
      const config = vscode.workspace.getConfiguration('qwerty-learner')
      for (const key of Object.keys(payload.preferences.settings || {})) {
        if (config.get(key) !== (payload.preferences.settings as any)[key]) {
          preferencesChanges++
        }
      }
      if (payload.preferences.wordVisibility !== undefined && payload.preferences.wordVisibility !== this._wordVisibility) {
        preferencesChanges++
      }
    }

    return { knownDelta, sessionDiff, sessionRegression, streakChanges, preferencesChanges }
  }

  /**
   * 应用导入：merge knownWords（并集）、merge streaks（每词 max）、覆盖 session、可选覆盖 preferences
   */
  applyImport(payload: ExportPayload, includePreferences: boolean): void {
    // knownWords 并集
    for (const k of Object.keys(payload.knownWords || {})) {
      if (!this._knownWords[k]) this._knownWords[k] = new Set()
      for (const w of payload.knownWords[k]) {
        this._knownWords[k].add(w)
      }
    }

    // streaks 每词取 max，已在 knownWords 里的直接跳过
    for (const dk of Object.keys(payload.perfectStreaks || {})) {
      if (!this._perfectStreaks[dk]) this._perfectStreaks[dk] = {}
      for (const w of Object.keys(payload.perfectStreaks[dk] || {})) {
        if (this._knownWords[dk]?.has(w)) continue
        const cur = this._perfectStreaks[dk][w] ?? 0
        const inc = payload.perfectStreaks[dk][w]
        this._perfectStreaks[dk][w] = Math.max(cur, inc)
      }
    }

    // session 直接覆盖（如果字典存在）
    if (payload.session) {
      if (payload.session.dictKey && idDictionaryMap[payload.session.dictKey]) {
        this._dictKey = payload.session.dictKey
        this.dict = idDictionaryMap[this._dictKey]
        this._globalState.update('dictKey', this._dictKey)
        this.loadDict()
        this.invalidateWordListCache()
      }
      if (typeof payload.session.chapter === 'number') {
        this._chapter = payload.session.chapter
        this._globalState.update('chapter', this._chapter)
      }
      if (typeof payload.session.order === 'number') {
        this._order = payload.session.order
        this._globalState.update('order', this._order)
      }
    }

    // preferences
    if (includePreferences && payload.preferences) {
      if (typeof payload.preferences.wordVisibility === 'boolean') {
        this._wordVisibility = payload.preferences.wordVisibility
        this._globalState.update('wordVisibility', this._wordVisibility)
      }
      if (payload.preferences.settings) {
        const config = vscode.workspace.getConfiguration('qwerty-learner')
        for (const key of Object.keys(payload.preferences.settings)) {
          const value = (payload.preferences.settings as any)[key]
          if (value !== undefined) {
            // Fire-and-forget; thenable promise but we don't need to await
            config.update(key, value, vscode.ConfigurationTarget.Global)
          }
        }
      }
    }

    this.persistKnownWords()
    this.persistStreaks()
    this.invalidateWordListCache()
    this.clampChapterAndOrder()
  }
}

// ============================================================
// 跨机同步类型定义
// ============================================================

export interface ExportPayload {
  version: 1
  exportedAt: string
  knownWords: Record<string, string[]>
  perfectStreaks: Record<string, Record<string, number>>
  session: {
    dictKey: string
    chapter: number
    order: number
  }
  preferences?: {
    wordVisibility?: boolean
    settings?: Record<string, unknown>
  }
}

export interface ImportPreview {
  knownDelta: Record<string, { current: number; incoming: number; newlyAdded: number }>
  sessionDiff: { current: { dictKey: string; chapter: number; order: number }; incoming: { dictKey: string; chapter: number; order: number } } | null
  sessionRegression: boolean
  streakChanges: number
  preferencesChanges: number | null
}
