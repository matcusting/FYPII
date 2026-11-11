import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer, request as proxyRequest } from 'node:http'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultSite = resolve(fileURLToPath(new URL('../site', import.meta.url)))
const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function inside(parent, child) {
  const subpath = relative(parent, child)
  return subpath === '' || (subpath !== '..' && !subpath.startsWith(`..${sep}`) && !isAbsolute(subpath))
}

function secureHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('X-Frame-Options', 'DENY')
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.setHeader('Strict-Transport-Security', 'max-age=31536000')
  response.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'")
}

function send(response, code, message) {
  response.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(message)
}

function proxy(incoming, response, upstreamPort, previewProtected) {
  const headers = { ...incoming.headers, host: `127.0.0.1:${upstreamPort}`, 'x-forwarded-proto': 'https' }
  delete headers.connection
  delete headers['proxy-connection']
  if (previewProtected) {
    // The preview password belongs to the gateway, not to the application API.
    delete headers.authorization
    delete headers['proxy-authorization']
  }
  const upstream = proxyRequest({
    hostname: '127.0.0.1', port: upstreamPort, method: incoming.method,
    path: incoming.url, headers,
  }, reply => {
    const replyHeaders = { ...reply.headers }
    delete replyHeaders.connection
    if (previewProtected) replyHeaders['cache-control'] = 'private, no-store'
    secureHeaders(response)
    response.writeHead(reply.statusCode || 502, replyHeaders)
    reply.pipe(response)
  })
  upstream.on('error', () => { if (!response.headersSent) send(response, 502, 'Application service unavailable.'); else response.destroy() })
  incoming.on('aborted', () => upstream.destroy())
  incoming.pipe(upstream)
}

function authorizedForPreview(header, expectedHash) {
  if (typeof header !== 'string' || header.length > 2048 || !/^Basic [A-Za-z0-9+/]+={0,2}$/.test(header)) return false
  const supplied = Buffer.from(header.slice(6), 'base64').toString('utf8')
  const suppliedHash = createHash('sha256').update(supplied).digest()
  return timingSafeEqual(suppliedHash, expectedHash)
}

export function createGateway({
  site = defaultSite,
  upstreamPort = 3001,
  previewRequired = process.env.PREVIEW_REQUIRED === '1',
  previewPassword = process.env.PREVIEW_ACCESS_PASSWORD || '',
} = {}) {
  const previewProtected = previewRequired || Boolean(previewPassword)
  if (previewProtected && previewPassword.length < 16) {
    throw new Error('Set PREVIEW_ACCESS_PASSWORD to at least 16 characters before starting the preview site.')
  }
  const expectedHash = previewProtected ? createHash('sha256').update(`preview:${previewPassword}`).digest() : null
  const siteRoot = resolve(site)
  return createServer(async (incoming, response) => {
    secureHeaders(response)
    let pathname
    try { pathname = decodeURIComponent(new URL(incoming.url || '/', 'http://localhost').pathname) }
    catch { return send(response, 400, 'Invalid URL.') }
    const healthProbe = pathname === '/health/ready' && (incoming.method === 'GET' || incoming.method === 'HEAD')
    if (previewProtected && !healthProbe && !authorizedForPreview(incoming.headers.authorization, expectedHash)) {
      response.setHeader('WWW-Authenticate', 'Basic realm="UTS Housing preview", charset="UTF-8"')
      return send(response, 401, 'Preview access required.')
    }
    if (pathname.startsWith('/api/') || pathname.startsWith('/health/')) return proxy(incoming, response, upstreamPort, previewProtected)
    if (incoming.method !== 'GET' && incoming.method !== 'HEAD') return send(response, 405, 'Method not allowed.')
    const requested = resolve(siteRoot, `.${pathname}`)
    if (!inside(siteRoot, requested)) return send(response, 404, 'Not found.')
    let path = requested
    let detail = await stat(path).catch(() => null)
    if (!detail?.isFile()) {
      // SPA routes have no extension. A missing asset must stay a 404.
      if (extname(pathname)) return send(response, 404, 'Not found.')
      path = resolve(siteRoot, 'index.html')
      detail = await stat(path).catch(() => null)
    }
    if (!detail?.isFile()) return send(response, 404, 'Not found.')
    response.writeHead(200, {
      'Content-Type': types[extname(path).toLowerCase()] || 'application/octet-stream',
      'Content-Length': detail.size,
      'Cache-Control': previewProtected ? 'private, no-store' : pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store',
    })
    if (incoming.method === 'HEAD') return response.end()
    createReadStream(path).on('error', () => response.destroy()).pipe(response)
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 10000)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.')
  createGateway({ site: process.env.SITE_DIR || defaultSite }).listen(port, '0.0.0.0', () => {
    console.info(`UTS Housing gateway listening on port ${port}`)
  })
}
