#!/usr/bin/env node
// Local-only encrypted backup and isolated restore rehearsal. Never restores over the live site.
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { appendFile, copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const api = join(repo, 'uts-housing-api')
const magic = Buffer.from('UTSHBK1')
const headerLength = magic.length + 16 + 12
const passphrase = process.env.UTS_BACKUP_PASSPHRASE || ''

function localDatabase() {
  if (process.env.NODE_ENV === 'production') throw new Error('This tool is for a stopped local site only.')
  const url = new URL(process.env.DATABASE_URL || 'http://invalid')
  const database = decodeURIComponent(url.pathname.slice(1))
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || Number(url.port || 5432) !== 5432 || url.username !== 'housing' || !/^[a-z][a-z0-9_]{0,50}$/.test(database)) {
    throw new Error('Use the local Docker PostgreSQL database on localhost:5432 with user housing.')
  }
  return { url, database }
}

function argument(name) {
  const flag = process.argv.slice(3).find(item => item.startsWith(`${name}=`))
  if (!flag || !flag.slice(name.length + 1)) throw new Error(`Provide ${name}=PATH.`)
  return resolve(flag.slice(name.length + 1))
}

function requirePassphrase() {
  if (passphrase.length < 16) throw new Error('Set UTS_BACKUP_PASSPHRASE to a private passphrase of at least 16 characters.')
}

async function command(executable, args, { cwd = repo, env = process.env, inputFile, outputFile, capture = false } = {}) {
  const childEnv = { ...env }
  delete childEnv.UTS_BACKUP_PASSPHRASE
  const child = spawn(executable, args, { cwd, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = ''
  child.stderr.on('data', () => {}) // Never print database or file details from subprocesses.
  const exit = new Promise((resolveExit, reject) => {
    child.on('error', () => reject(new Error(`${basename(executable)} could not start.`)))
    child.on('close', code => code === 0 ? resolveExit() : reject(new Error(`${basename(executable)} exited with code ${code}.`)))
  })
  const streams = []
  if (inputFile) streams.push(pipeline(createReadStream(inputFile), child.stdin))
  else child.stdin.end()
  if (outputFile) streams.push(pipeline(child.stdout, createWriteStream(outputFile, { mode: 0o600 })))
  else if (capture) child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 2_000_000) child.kill() })
  else child.stdout.resume()
  await Promise.all([...streams, exit])
  return stdout
}

async function copyTree(source, target) {
  let info
  try { info = await lstat(source) } catch (error) { if (error.code === 'ENOENT') return; throw error }
  if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw new Error('Backup source contains a link or special file.')
  if (info.isFile()) { await mkdir(dirname(target), { recursive: true, mode: 0o700 }); await copyFile(source, target); return }
  await mkdir(target, { recursive: true, mode: 0o700 })
  for (const entry of await readdir(source)) await copyTree(join(source, entry), join(target, entry))
}

async function fileList(root, sub = '') {
  const result = []
  for (const entry of await readdir(join(root, sub), { withFileTypes: true })) {
    const name = join(sub, entry.name)
    if (entry.isDirectory()) result.push(...await fileList(root, name))
    else if (entry.isFile()) result.push(name.split(sep).join('/'))
    else throw new Error('Backup contains an unexpected directory entry.')
  }
  return result.sort()
}

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function makeManifest(stage) {
  const files = {}
  for (const name of await fileList(stage)) {
    const path = join(stage, name)
    files[name] = { bytes: (await stat(path)).size, sha256: await sha256(path) }
  }
  await writeFile(join(stage, 'manifest.json'), JSON.stringify({ version: 1, createdAt: new Date().toISOString(), files }, null, 2), { mode: 0o600 })
}

async function checkManifest(stage) {
  const manifest = JSON.parse(await readFile(join(stage, 'manifest.json'), 'utf8'))
  if (manifest.version !== 1 || !manifest.files || typeof manifest.files !== 'object') throw new Error('Backup manifest is invalid.')
  const found = (await fileList(stage)).filter(name => name !== 'manifest.json')
  if (JSON.stringify(found) !== JSON.stringify(Object.keys(manifest.files).sort()) || !found.includes('database.dump')) throw new Error('Backup files do not match the manifest.')
  for (const name of found) {
    const file = manifest.files[name]
    if (file.bytes !== (await stat(join(stage, name))).size || file.sha256 !== await sha256(join(stage, name))) throw new Error('Backup file checksum failed.')
  }
  return found.length
}

async function requireStoppedApi() {
  const port = Number(process.env.PORT || 3001)
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health/live`, { signal: AbortSignal.timeout(700) })
    if (response.ok) throw new Error('Stop the API, frontend and email worker before creating a consistent backup; leave PostgreSQL running.')
  } catch (error) {
    if (error.message?.startsWith('Stop the API')) throw error
  }
}

async function encryptDirectory(stage, destination) {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', scryptSync(passphrase, salt, 32), iv)
  const partial = `${destination}.partial`
  await writeFile(partial, Buffer.concat([magic, salt, iv]), { flag: 'wx', mode: 0o600 })
  try {
    const archiveEnv = { ...process.env }
    delete archiveEnv.UTS_BACKUP_PASSPHRASE
    const archive = spawn('tar', ['-cf', '-', '-C', stage, '.'], { cwd: repo, env: archiveEnv, stdio: ['ignore', 'pipe', 'pipe'] })
    archive.stderr.resume()
    const exit = new Promise((resolveExit, reject) => {
      archive.on('error', () => reject(new Error('tar could not start.')))
      archive.on('close', code => code === 0 ? resolveExit() : reject(new Error('tar failed.')))
    })
    await Promise.all([pipeline(archive.stdout, cipher, createWriteStream(partial, { flags: 'a' })), exit])
    await appendFile(partial, cipher.getAuthTag())
    await rename(partial, destination)
  } catch (error) { await rm(partial, { force: true }); throw error }
}

async function decryptArchive(file, stage) {
  const source = await open(file, 'r')
  let size, header, tag
  try {
    size = (await source.stat()).size
    if (size < headerLength + 17) throw new Error('Backup file is incomplete.')
    header = Buffer.alloc(headerLength)
    tag = Buffer.alloc(16)
    await source.read(header, 0, headerLength, 0)
    await source.read(tag, 0, 16, size - 16)
  } finally { await source.close() }
  if (!header.subarray(0, magic.length).equals(magic)) throw new Error('This is not a UTS Housing backup.')
  const salt = header.subarray(magic.length, magic.length + 16)
  const iv = header.subarray(magic.length + 16)
  const decipher = createDecipheriv('aes-256-gcm', scryptSync(passphrase, salt, 32), iv)
  decipher.setAuthTag(tag)
  const tarPath = join(stage, 'backup.tar')
  try { await pipeline(createReadStream(file, { start: headerLength, end: size - 17 }), decipher, createWriteStream(tarPath, { mode: 0o600 })) }
  catch { throw new Error('Backup decryption failed. Check the passphrase and file integrity.') }
  return tarPath
}

async function unpack(file, stage) {
  const tarPath = await decryptArchive(file, stage)
  const members = (await command('tar', ['-tf', tarPath], { capture: true })).split(/\r?\n/).filter(Boolean)
  if (members.some(name => name.startsWith('/') || name.split('/').includes('..') || !name.startsWith('./'))) throw new Error('Backup archive contains an unsafe path.')
  const extracted = join(stage, 'extracted')
  await mkdir(extracted, { mode: 0o700 })
  await command('tar', ['-xf', tarPath, '-C', extracted])
  const count = await checkManifest(extracted)
  return { extracted, count }
}

async function create() {
  const destination = argument('--output')
  const { database } = localDatabase()
  const parent = dirname(destination)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  const relativeToRepo = relative(repo, await realpath(parent))
  if (!relativeToRepo.startsWith('..') && !isAbsolute(relativeToRepo)) throw new Error('Store backups outside the project folder and Git.')
  try { await lstat(destination); throw new Error('Backup destination already exists; choose a new filename.') }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  await requireStoppedApi()
  const stage = await mkdtemp(join(tmpdir(), 'uts-housing-backup-'))
  try {
    await command('docker', ['compose', 'exec', '-T', 'postgres', 'pg_dump', '-U', 'housing', '-Fc', database], { outputFile: join(stage, 'database.dump') })
    await copyTree(join(api, '.env'), join(stage, 'config', '.env'))
    await copyTree(resolve(api, process.env.MEDIA_PRIVATE_DIR || './data/private'), join(stage, 'media', 'private'))
    await copyTree(resolve(api, process.env.UPLOAD_DIR || './data/uploads'), join(stage, 'media', 'uploads'))
    await makeManifest(stage)
    await encryptDirectory(stage, destination)
    process.stdout.write(`Encrypted local backup created: ${destination}\n`)
  } finally { await rm(stage, { recursive: true, force: true }) }
}

async function rehearse(extracted) {
  const { url } = localDatabase()
  const database = `housing_restore_${randomBytes(5).toString('hex')}`
  await command('docker', ['compose', 'exec', '-T', 'postgres', 'createdb', '-U', 'housing', database])
  try {
    await command('docker', ['compose', 'exec', '-T', 'postgres', 'pg_restore', '-U', 'housing', '--exit-on-error', '--no-owner', '--no-privileges', '-d', database], { inputFile: join(extracted, 'database.dump') })
    url.pathname = `/${database}`
    const reportText = await command(process.execPath, ['--import', 'tsx', 'scripts/private-media-audit.mjs'], {
      cwd: api, capture: true,
      env: { ...process.env, DATABASE_URL: url.toString(), MEDIA_PRIVATE_DIR: join(extracted, 'media', 'private'), UPLOAD_DIR: join(extracted, 'media', 'uploads') },
    })
    const report = JSON.parse(reportText)
    if (report.problems?.length) throw new Error(`Restored media audit found ${report.problems.length} inconsistencies.`)
    process.stdout.write(`Isolated restore rehearsal passed: ${report.checkedUploads} uploads and ${report.checkedReferences} references checked.\n`)
  } finally { await command('docker', ['compose', 'exec', '-T', 'postgres', 'dropdb', '--force', '-U', 'housing', database]) }
}

async function verify() {
  const file = argument('--file')
  const stage = await mkdtemp(join(tmpdir(), 'uts-housing-verify-'))
  try {
    const { extracted, count } = await unpack(file, stage)
    process.stdout.write(`Encrypted backup authenticated; ${count} file checksums passed.\n`)
    if (process.argv[2] === 'rehearse') await rehearse(extracted)
  } finally { await rm(stage, { recursive: true, force: true }) }
}

async function main() {
  if (!['create', 'verify', 'rehearse'].includes(process.argv[2])) throw new Error('Use create --output=PATH, verify --file=PATH, or rehearse --file=PATH.')
  requirePassphrase()
  if (process.argv[2] === 'create') await create()
  else await verify()
}

main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'Backup operation failed.'}\n`); process.exitCode = 1 })
