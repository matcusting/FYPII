import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { createGateway } from './render-gateway.mjs'

const site = await mkdtemp(join(tmpdir(), 'housing-render-gateway-'))
await mkdir(join(site, 'assets'))
await writeFile(join(site, 'index.html'), '<!doctype html><title>Housing</title>')
await writeFile(join(site, 'assets', 'app.js'), 'console.log("housing")')
const upstream = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  response.writeHead(200, {
    'Content-Type': 'application/json',
    'Set-Cookie': 'housing_session=abc; HttpOnly; SameSite=Lax; Secure',
  })
  response.end(JSON.stringify({
    path: request.url, method: request.method, body: Buffer.concat(chunks).toString(),
    origin: request.headers.origin, authorization: request.headers.authorization || null,
  }))
})
await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
const gateway = createGateway({ site, upstreamPort: upstream.address().port })
await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${gateway.address().port}`
after(async () => {
  await new Promise(resolve => gateway.close(resolve))
  await new Promise(resolve => upstream.close(resolve))
  await rm(site, { recursive: true, force: true })
})

test('serves the SPA and immutable assets from the same origin as the API', async () => {
  const page = await fetch(`${base}/listings/some-listing`)
  assert.equal(page.status, 200)
  assert.match(await page.text(), /Housing/)
  assert.equal(page.headers.get('cache-control'), 'no-store')
  assert.equal(page.headers.get('strict-transport-security'), 'max-age=31536000')
  assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/)

  const asset = await fetch(`${base}/assets/app.js`)
  assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  assert.equal(asset.headers.get('content-type'), 'text/javascript; charset=utf-8')
  assert.equal((await fetch(`${base}/assets/missing.js`)).status, 404)
})

test('proxies credential and upload requests without changing the browser origin', async () => {
  const response = await fetch(`${base}/api/v1/auth/login?check=1`, {
    method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{"hello":"world"}',
  })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('set-cookie'), /SameSite=Lax/)
  assert.deepEqual(await response.json(), {
    path: '/api/v1/auth/login?check=1', method: 'POST', body: '{"hello":"world"}', origin: base, authorization: null,
  })
  assert.equal((await fetch(`${base}/health/ready`)).status, 200)
})

test('rejects write methods on static paths and paths outside the site root', async () => {
  assert.equal((await fetch(`${base}/`, { method: 'POST' })).status, 405)
  assert.equal((await fetch(`${base}/%2f..%2fetc/passwd`)).status, 404)
  assert.equal((await fetch(`${base}/%2f..%2fetc/passwd.js`)).status, 404)
})

test('requires a strong preview password before opening a protected gateway', () => {
  assert.throws(() => createGateway({ site, previewRequired: true }), /PREVIEW_ACCESS_PASSWORD/)
  assert.throws(() => createGateway({ site, previewRequired: true, previewPassword: 'short' }), /at least 16 characters/)
})

test('protects preview pages and API, while leaving the exact readiness probe available', async () => {
  const password = 'preview-test-password-12345'
  const preview = createGateway({ site, upstreamPort: upstream.address().port, previewRequired: true, previewPassword: password })
  await new Promise(resolve => preview.listen(0, '127.0.0.1', resolve))
  const previewBase = `http://127.0.0.1:${preview.address().port}`
  const authorization = `Basic ${Buffer.from(`preview:${password}`).toString('base64')}`
  try {
    const unauthenticatedPage = await fetch(`${previewBase}/`)
    assert.equal(unauthenticatedPage.status, 401)
    assert.match(unauthenticatedPage.headers.get('www-authenticate'), /Basic realm="UTS Housing preview"/)
    assert.equal(unauthenticatedPage.headers.get('cache-control'), 'no-store')
    assert.equal((await fetch(`${previewBase}/api/v1/auth/me`)).status, 401)
    assert.equal((await fetch(`${previewBase}/health/live`)).status, 401)
    assert.equal((await fetch(`${previewBase}/`, {
      headers: { authorization: `Basic ${Buffer.from('preview:wrong-password').toString('base64')}` },
    })).status, 401)

    const page = await fetch(`${previewBase}/`, { headers: { authorization } })
    assert.equal(page.status, 200)
    assert.equal(page.headers.get('cache-control'), 'private, no-store')
    const asset = await fetch(`${previewBase}/assets/app.js`, { headers: { authorization } })
    assert.equal(asset.status, 200)
    assert.equal(asset.headers.get('cache-control'), 'private, no-store')
    const api = await fetch(`${previewBase}/api/v1/auth/me`, { headers: { authorization } })
    assert.equal(api.status, 200)
    assert.equal(api.headers.get('cache-control'), 'private, no-store')
    assert.equal((await api.json()).authorization, null)
    assert.equal((await fetch(`${previewBase}/health/ready`)).status, 200)
  } finally {
    await new Promise(resolve => preview.close(resolve))
  }
})
