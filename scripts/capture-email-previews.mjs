import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const previewDirectory = path.join(projectRoot, 'artifacts', 'email-previews')
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const debuggingPort = 9333
const templates = ['verify-email', 'reset-pass', 'reset-pin', 'autorenew-success', 'autorenew-fail']

const browser = spawn(edgePath, [
  '--headless=new',
  '--disable-gpu',
  '--disable-background-networking',
  '--disable-component-update',
  '--no-first-run',
  `--remote-debugging-port=${debuggingPort}`,
  `--user-data-dir=${path.join(process.env.TEMP, 'reeplay-email-preview-cdp')}`,
  'about:blank',
], { stdio: 'ignore' })

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function getPage() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const pages = await fetch(`http://127.0.0.1:${debuggingPort}/json/list`, {
        signal: AbortSignal.timeout(500),
      }).then((response) => response.json())
      if (pages[0]?.webSocketDebuggerUrl) return pages[0]
    } catch {}
    await delay(250)
  }
  throw new Error('Timed out while starting the email preview browser')
}

const page = await getPage()
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let requestId = 0
const pendingRequests = new Map()
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data)
  if (!message.id || !pendingRequests.has(message.id)) return
  const { resolve, reject } = pendingRequests.get(message.id)
  pendingRequests.delete(message.id)
  if (message.error) reject(new Error(message.error.message))
  else resolve(message.result)
})

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++requestId
  pendingRequests.set(id, { resolve, reject })
  socket.send(JSON.stringify({ id, method, params }))
})

try {
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  })

  for (const template of templates) {
    const htmlPath = path.join(previewDirectory, `${template}.html`)
    await send('Page.navigate', { url: 'about:blank' })
    await delay(100)
    await send('Page.navigate', { url: pathToFileURL(htmlPath).href })
    await delay(500)
    await send('Runtime.evaluate', {
      expression: `document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        window.scrollTo(0, 0);`,
    })
    const screenshot = await send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: 390, height: 844, scale: 1 },
    })
    await writeFile(path.join(previewDirectory, `${template}-mobile.png`), screenshot.data, 'base64')
  }
} finally {
  socket.close()
  browser.kill()
}

console.log(`Captured ${templates.length} mobile email previews at 390 x 844`)
