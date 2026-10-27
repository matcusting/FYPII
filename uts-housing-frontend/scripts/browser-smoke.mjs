#!/usr/bin/env node
// Browser-level smoke test for a running local site and its API. No test data
// is created: use the fictional seed account described in the repository README.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const site = new URL(process.env.SMOKE_BASE_URL || 'http://127.0.0.1:5173/')
if (!['127.0.0.1', 'localhost'].includes(site.hostname)) throw new Error('Browser smoke tests must target a local site.')
const adminEmail = process.env.SMOKE_ADMIN_EMAIL || 'admin@demo.local'
const adminPassword = process.env.SMOKE_ADMIN_PASSWORD || 'Demo12345!'

async function browserBinary() {
  const candidates = [process.env.CHROME_BIN,
    '/usr/bin/chromium', '/usr/bin/google-chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean)
  for (const candidate of candidates) {
    try { await access(candidate); return candidate } catch { /* Try the next installed browser. */ }
  }
  throw new Error('Chromium/Chrome was not found. Set CHROME_BIN to its full path.')
}

async function pause(ms) { await new Promise(resolve => setTimeout(resolve, ms)) }

async function debuggingPort(profile) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const value = await readFile(join(profile, 'DevToolsActivePort'), 'utf8')
      const port = Number(value.split('\n')[0])
      if (Number.isInteger(port) && port > 0) return port
    } catch { /* Browser has not started yet. */ }
    await pause(100)
  }
  throw new Error('Chrome did not start its debugging server.')
}

function connectDebugger(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    let serial = 0
    const pending = new Map()
    socket.addEventListener('open', () => resolve({
      command(method, params = {}) {
        const id = ++serial
        return new Promise((done, fail) => {
          const timer = setTimeout(() => { pending.delete(id); fail(new Error(`CDP ${method} timed out`)) }, 15000)
          pending.set(id, { done, fail, timer })
          socket.send(JSON.stringify({ id, method, params }))
        })
      },
      close() { socket.close() },
    }))
    socket.addEventListener('message', event => {
      const packet = JSON.parse(event.data)
      if (!packet.id || !pending.has(packet.id)) return
      const item = pending.get(packet.id)
      pending.delete(packet.id)
      clearTimeout(item.timer)
      if (packet.error) item.fail(new Error(packet.error.message))
      else item.done(packet.result)
    })
    socket.addEventListener('error', () => reject(new Error('Could not connect to Chrome debugging socket.')))
    socket.addEventListener('close', () => {
      for (const item of pending.values()) { clearTimeout(item.timer); item.fail(new Error('Chrome closed unexpectedly.')) }
      pending.clear()
    })
  })
}

async function main() {
  const probe = await fetch(new URL('/api/v1/listings?limit=1', site)).catch(() => null)
  assert.ok(probe?.ok, 'Start the local API and frontend (or preview server) before running the browser smoke test.')
  const profile = await mkdtemp(join(tmpdir(), 'housing-browser-smoke-'))
  const browser = spawn(await browserBinary(), [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' })
  let cdp
  try {
    const port = await debuggingPort(profile)
    const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    const tab = tabs.find(item => item.type === 'page')
    assert.ok(tab?.webSocketDebuggerUrl, 'Chrome did not expose a page target.')
    cdp = await connectDebugger(tab.webSocketDebuggerUrl)
    await cdp.command('Page.enable')
    await cdp.command('Runtime.enable')

    async function run(script) {
      const result = await cdp.command('Runtime.evaluate', { expression: script, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser script failed')
      return result.result.value
    }
    async function until(expression, label) {
      const value = await run(`(async () => { for (let i = 0; i < 100; i++) { const found = (${expression}); if (found) return found; await new Promise(resolve => setTimeout(resolve, 100)); } return null })()`)
      if (!value) {
        const state = await run('({ path: location.pathname, text: document.body?.innerText.slice(0, 500) })')
        throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(state)}`)
      }
      return value
    }
    async function visit(path, text) {
      await cdp.command('Page.navigate', { url: new URL(path, site).toString() })
      await until(`document.body && document.body.innerText.includes(${JSON.stringify(text)})`, text)
    }

    await visit('/login', 'System Login')
    assert.equal(await run('document.documentElement.lang'), 'en', 'English must be the default language')
    await run(`(() => { const select = document.querySelector('select[aria-label="Language"]'); select.value = 'ms'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`)
    await until(`document.documentElement.lang === 'ms'`, 'Malay language switch')
    await until(`document.body.innerText.includes('Log Masuk Sistem')`, 'Malay login copy')
    await run(`(() => { const select = document.querySelector('select[title="Language"], select[aria-label="Bahasa"]') || document.querySelector('select'); select.value = 'zh-CN'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`)
    await until(`document.documentElement.lang === 'zh-CN'`, 'Chinese language switch')
    await until(`document.body.innerText.includes('系统登录')`, 'Chinese login copy')
    await run(`(() => { const select = document.querySelector('select'); select.value = 'en'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`)
    await until(`document.documentElement.lang === 'en'`, 'English language switch')

    await run(`(() => {
      const set = (id, value) => { const input = document.getElementById(id); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); };
      set('login-email', ${JSON.stringify(adminEmail)});
      set('login-password', ${JSON.stringify(adminPassword)});
      document.querySelector('form').requestSubmit();
    })()`)
    await until(`location.pathname === '/admin'`, 'administrator login and redirect')
    await until(`document.body.innerText.toLowerCase().includes('admin portal')`, 'administrator dashboard')
    await visit('/admin/landlord-verifications', 'Landlord Identity Review')
    await until(`!!document.querySelector('nav[aria-label="Admin navigation"]')`, 'administrator moderation navigation')

    await cdp.command('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true })
    await visit('/login', 'System Login')
    assert.ok(await run(`document.querySelector('a.skip-link[href="#main"]') !== null`), 'Mobile login needs a skip link')
    assert.ok(await run(`document.documentElement.scrollWidth <= window.innerWidth + 1`), 'Mobile login must not overflow horizontally')
    console.info('Browser smoke passed: English/Malay/Chinese, seeded admin login, review route, narrow viewport.')
  } finally {
    cdp?.close()
    browser.kill('SIGTERM')
    await pause(150)
    await rm(profile, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error instanceof Error ? error.stack : error); process.exitCode = 1 })
