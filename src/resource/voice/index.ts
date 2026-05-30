import * as vscode from 'vscode'
import * as https from 'https'
import { getConfig } from '../../utils'
interface NativeModule {
  playerPlay(voiceUrl: string, callback: () => void): void
}

let NATIVE: any = null

try {
  NATIVE = require(`node-loader!./rodio/mac-arm.node`) as NativeModule
} catch (error) {
  NATIVE = null
}

if (!(NATIVE && NATIVE.playerPlay)) {
  try {
    NATIVE = require(`node-loader!./rodio/win32.node`) as NativeModule
  } catch (error) {
    NATIVE = null
  }
}
if (!(NATIVE && NATIVE.playerPlay)) {
  try {
    NATIVE = require(`node-loader!./rodio/mac-intel.node`) as NativeModule
  } catch (error) {
    NATIVE = null
  }
}
if (!(NATIVE && NATIVE.playerPlay)) {
  try {
    NATIVE = require(`node-loader!./rodio/linux-x64.node`) as NativeModule
  } catch (error) {
    NATIVE = null
  }
}
if (!(NATIVE && NATIVE.playerPlay)) {
  NATIVE = null
}

function buildVoiceUrl(word: string): string {
  const type = getConfig('voiceType') === 'us' ? 2 : 1
  return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=${type}`
}

const WEBVIEW_HTML = `<!DOCTYPE html>
<html>
<head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src https:; media-src https:;">
</head>
<body style="margin:0;padding:12px;font-family:sans-serif;color:#ccc;">
<div style="margin-bottom:8px;">Qwerty Voice Player</div>
<button id="enable" style="font-size:14px;padding:8px 16px;cursor:pointer;background:#0078d4;color:white;border:none;border-radius:4px;">
  Click to enable audio (once)
</button>
<div id="status" style="font-size:11px;color:#888;margin-top:8px;"></div>
<script>
  const vscodeApi = acquireVsCodeApi()
  const statusEl = document.getElementById('status')
  const enableBtn = document.getElementById('enable')
  const queue = []
  let enabled = false
  let audioContext = null

  function setStatus(msg) { statusEl.textContent = msg }

  function base64ToArrayBuffer(b64) {
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes.buffer
  }

  async function playBase64(label, b64) {
    try {
      if (audioContext.state === 'suspended') await audioContext.resume()
      const arrayBuffer = base64ToArrayBuffer(b64)
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
      const source = audioContext.createBufferSource()
      source.buffer = audioBuffer
      source.connect(audioContext.destination)
      source.onended = () => setStatus('Ready')
      source.start(0)
      setStatus('Playing: ' + label)
    } catch (err) {
      setStatus('Decode failed: ' + err.message)
    }
  }

  enableBtn.addEventListener('click', async () => {
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)()
      await audioContext.resume()
      enabled = true
      enableBtn.style.display = 'none'
      setStatus('Enabled, ready')
      if (queue.length > 0) {
        const last = queue.pop()
        queue.length = 0
        playBase64(last.label, last.b64)
      }
    } catch (err) {
      setStatus('Enable failed: ' + err.message)
    }
  })

  window.addEventListener('message', (event) => {
    const { label, b64, error } = event.data || {}
    if (error) { setStatus('Download failed: ' + error); return }
    if (!b64) return
    if (!enabled) {
      queue.push({ label, b64 })
      setStatus('Waiting for enable (' + queue.length + ' queued)')
      return
    }
    playBase64(label, b64)
  })

  setStatus('Not enabled - click the button above')
  vscodeApi.postMessage({ type: 'ready' })
</script>
</body>
</html>`

function downloadAsBase64(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error('HTTP ' + res.statusCode))
          res.resume()
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks as unknown as Uint8Array[]).toString('base64')))
        res.on('error', reject)
      })
      .on('error', reject)
  })
}

export const QWERTY_AUDIO_VIEW_ID = 'qwertyAudioView'

class QwertyAudioViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | null = null
  private isReady = false
  private pending: { label: string; b64: string } | { error: string } | null = null

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView
    this.isReady = false
    webviewView.webview.options = { enableScripts: true }
    webviewView.webview.html = WEBVIEW_HTML

    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg && msg.type === 'ready') {
        this.isReady = true
        if (this.pending && this.view) {
          this.view.webview.postMessage(this.pending)
          this.pending = null
        }
      }
    })

    webviewView.onDidDispose(() => {
      this.view = null
      this.isReady = false
      this.pending = null
    })
  }

  async play(word: string, url: string) {
    if (!this.view) {
      await vscode.commands.executeCommand('qwertyAudioView.focus')
    }
    try {
      const b64 = await downloadAsBase64(url)
      const payload = { label: word, b64 }
      if (this.view && this.isReady) {
        this.view.webview.postMessage(payload)
      } else {
        this.pending = payload
      }
    } catch (err: any) {
      const errPayload = { error: err.message || String(err) }
      if (this.view && this.isReady) {
        this.view.webview.postMessage(errPayload)
      } else {
        this.pending = errPayload
      }
    }
  }
}

export function registerVoiceView(context: vscode.ExtensionContext) {
  const provider = new QwertyAudioViewProvider()
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(QWERTY_AUDIO_VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  )
  return provider
}

export function createVoicePlayer(provider: QwertyAudioViewProvider) {
  const playViaWebview = async (word: string, url: string, callback: () => void) => {
    try {
      await provider.play(word, url)
    } finally {
      callback()
    }
  }

  return (word: string, callback: () => void) => {
    const url = buildVoiceUrl(word)
    if (NATIVE) {
      NATIVE.playerPlay(url, callback)
      return
    }
    playViaWebview(word, url, callback)
  }
}
