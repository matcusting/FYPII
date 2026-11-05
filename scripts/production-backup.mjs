#!/usr/bin/env node
// Production backup and isolated restore rehearsal. Never restores over the live database.
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { appendFile, copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const api = join(repo, 'uts-housing-api')
const magic = Buffer.from('UTSHPB1')
const headerLength = magic.length + 16 + 12
const TMPFS_MAGIC = 0x01021994
const archiveName = /^uts-housing-\d{8}T\d{6}Z-[0-9a-f]{8}\.uthbak$/
let passphrase = ''

function databaseConnection() {
  let url
  try { url = new URL(process.env.DATABASE_URL || '') }
  catch { throw new Error('Set DATABASE_URL to a PostgreSQL connection URL.') }
  const database = decodeURIComponent(url.pathname.slice(1))
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !database || !url.username) {
    throw new Error('Set DATABASE_URL to a PostgreSQL connection URL with a database and user.')
  }
  const sslmode = url.searchParams.get('sslmode')
  if (sslmode && !['disable', 'prefer', 'require', 'verify-ca', 'verify-full'].includes(sslmode)) throw new Error('DATABASE_URL has an unsupported sslmode for backup.')
  const env = { ...process.env,
    PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: database,
    ...(sslmode ? { PGSSLMODE: sslmode } : {}),
  }
  delete env.BACKUP_PASSPHRASE
  delete env.BACKUP_PASSPHRASE_FILE
  return { url, database, env }
}

function argument(name) {
  const flag = process.argv.slice(3).find(item => item.startsWith(`${name}=`))
  if (!flag || !flag.slice(name.length + 1)) throw new Error(`Provide ${name}=PATH.`)
  return resolve(flag.slice(name.length + 1))
}

async function requirePassphrase() {
  if (process.env.BACKUP_PASSPHRASE) throw new Error('Do not place BACKUP_PASSPHRASE in the container environment; use BACKUP_PASSPHRASE_FILE.')
  const file = process.env.BACKUP_PASSPHRASE_FILE || ''
  if (!isAbsolute(file)) throw new Error('Set BACKUP_PASSPHRASE_FILE to an absolute secret-file path.')
  const detail = await lstat(file).catch(() => null)
  if (!detail?.isFile() || detail.isSymbolicLink()) throw new Error('The backup passphrase secret file is unavailable or unsafe.')
  passphrase = (await readFile(file, 'utf8')).replace(/\r?\n$/, '')
  if (passphrase.length < 16 || passphrase.length > 1024) throw new Error('The backup passphrase must be between 16 and 1024 characters.')
}

async function workDirectory() {
  const path = process.env.BACKUP_WORK_DIR || ''
  if (!isAbsolute(path)) throw new Error('Set BACKUP_WORK_DIR to an absolute tmpfs directory.')
  const detail = await lstat(path).catch(() => null)
  if (!detail?.isDirectory() || detail.isSymbolicLink() || (await statfs(path)).type !== TMPFS_MAGIC) {
    throw new Error('BACKUP_WORK_DIR must be a mounted tmpfs; unencrypted staging on persistent storage is refused.')
  }
  return path
}

function inside(parent, child) {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

async function backupTarget() {
  const requested = process.env.BACKUP_TARGET_DIR || ''
  if (!isAbsolute(requested)) throw new Error('Set BACKUP_TARGET_DIR to an absolute, operator-mounted backup destination.')
  const rootDetail = await lstat(requested).catch(() => null)
  if (!rootDetail?.isDirectory() || rootDetail.isSymbolicLink()) throw new Error('The backup destination directory is unavailable or unsafe.')
  const target = await realpath(requested).catch(() => null)
  if (!target || inside(repo, target) || (process.env.MEDIA_PRIVATE_DIR && inside(resolve(process.env.MEDIA_PRIVATE_DIR), target))) {
    throw new Error('Backup destination must exist outside the application and private-media directories.')
  }
  const marker = join(target, '.uts-housing-offsite-ready')
  const detail = await lstat(marker).catch(() => null)
  if (!detail?.isFile() || detail.isSymbolicLink() || (await readFile(marker, 'utf8')).trim() !== 'UTS_HOUSING_OFFSITE_BACKUPS_V1') {
    throw new Error('The offsite backup mount marker is missing. Do not fall back to an unmounted local directory.')
  }
  return target
}

async function command(executable, args, { cwd = repo, env = process.env, inputFile, outputFile, capture = false } = {}) {
  const childEnv = { ...env }
  delete childEnv.BACKUP_PASSPHRASE
  delete childEnv.BACKUP_PASSPHRASE_FILE
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
  const url = process.env.API_HEALTH_URL || ''
  if (!/^https?:\/\//.test(url)) throw new Error('Set API_HEALTH_URL so backup can check the write service is stopped.')
  let answered = false
  try {
    await fetch(url, { signal: AbortSignal.timeout(1500) })
    answered = true
  } catch { /* Unreachable after API is stopped. The maintenance wrapper also stops email-worker. */ }
  if (answered) throw new Error('The API still answers requests. Stop API and email-worker writes before backing up.')
}

async function encryptDirectory(stage, destination) {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', scryptSync(passphrase, salt, 32), iv)
  const partial = `${destination}.partial`
  await writeFile(partial, Buffer.concat([magic, salt, iv]), { flag: 'wx', mode: 0o600 })
  try {
    const archiveEnv = { ...process.env }
    delete archiveEnv.BACKUP_PASSPHRASE
    delete archiveEnv.BACKUP_PASSPHRASE_FILE
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
  if (!header.subarray(0, magic.length).equals(magic)) throw new Error('This is not a production UTS Housing backup.')
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
  if (process.argv.slice(3).join(' ') !== '--confirm-writes-stopped') throw new Error('Create requires --confirm-writes-stopped after stopping API and email-worker writes.')
  const target = await backupTarget()
  const work = await workDirectory()
  const mediaRoot = process.env.MEDIA_PRIVATE_DIR || ''
  if (!isAbsolute(mediaRoot)) throw new Error('Set MEDIA_PRIVATE_DIR to the absolute private-media volume path.')
  const sourceDetail = await lstat(mediaRoot).catch(() => null)
  const media = await realpath(mediaRoot).catch(() => null)
  const detail = media && await lstat(media)
  if (!sourceDetail?.isDirectory() || sourceDetail.isSymbolicLink() || !media || !detail?.isDirectory() || detail.isSymbolicLink() || inside(media, target)) throw new Error('The private-media volume is missing or unsafe.')
  const { env } = databaseConnection()
  await requireStoppedApi()
  const name = `uts-housing-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-${randomBytes(4).toString('hex')}.uthbak`
  const destination = join(target, name)
  const stage = await mkdtemp(join(work, 'uts-housing-backup-'))
  try {
    await command('pg_dump', ['-Fc', '--no-owner', '--no-privileges', '--file', join(stage, 'database.dump')], { env })
    await copyTree(media, join(stage, 'media', 'private'))
    await makeManifest(stage)
    await encryptDirectory(stage, destination)
    const check = await mkdtemp(join(work, 'uts-housing-check-'))
    try { await unpack(destination, check) }
    catch (error) {
      await rename(destination, `${destination}.unverified`).catch(() => {})
      throw error
    }
    finally { await rm(check, { recursive: true, force: true }) }
    process.stdout.write(`Authenticated encrypted production backup created: ${destination}\n`)
  } finally { await rm(stage, { recursive: true, force: true }) }
}

async function rehearse(extracted) {
  const { url, env } = databaseConnection()
  const database = `housing_restore_${randomBytes(5).toString('hex')}`
  await command('createdb', ['--template=template0', database], { env: { ...env, PGDATABASE: 'postgres' } })
  try {
    await command('pg_restore', ['--exit-on-error', '--no-owner', '--no-privileges', '--dbname', database, join(extracted, 'database.dump')], { env })
    url.pathname = `/${database}`
    const reportText = await command(process.execPath, ['--import', 'tsx', 'scripts/private-media-audit.mjs'], {
      cwd: api, capture: true,
      env: { ...env, DATABASE_URL: url.toString(), MEDIA_PRIVATE_DIR: join(extracted, 'media', 'private'), UPLOAD_DIR: join(extracted, 'media', 'private') },
    })
    const report = JSON.parse(reportText)
    if (report.problems?.length) throw new Error(`Restored media audit found ${report.problems.length} inconsistencies.`)
    process.stdout.write(`Isolated restore rehearsal passed: ${report.checkedUploads} uploads and ${report.checkedReferences} references checked.\n`)
  } finally { await command('dropdb', ['--force', database], { env: { ...env, PGDATABASE: 'postgres' } }) }
}

async function verify() {
  if (process.argv.length !== 4) throw new Error('Use verify|rehearse --file=/backups/uts-housing-...uthbak.')
  const file = argument('--file')
  const target = await backupTarget()
  const work = await workDirectory()
  if (!inside(target, file) || !archiveName.test(basename(file))) throw new Error('Select a named backup archive inside BACKUP_TARGET_DIR.')
  const detail = await lstat(file).catch(() => null)
  if (!detail?.isFile() || detail.isSymbolicLink()) throw new Error('The requested backup file is unavailable or unsafe.')
  const stage = await mkdtemp(join(work, 'uts-housing-verify-'))
  try {
    const { extracted, count } = await unpack(file, stage)
    process.stdout.write(`Encrypted backup authenticated; ${count} file checksums passed.\n`)
    if (process.argv[2] === 'rehearse') await rehearse(extracted)
  } finally { await rm(stage, { recursive: true, force: true }) }
}

async function main() {
  if (!['create', 'verify', 'rehearse'].includes(process.argv[2])) throw new Error('Use create --confirm-writes-stopped, verify --file=PATH, or rehearse --file=PATH.')
  await requirePassphrase()
  if (process.argv[2] === 'create') await create()
  else await verify()
}

main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'Backup operation failed.'}\n`); process.exitCode = 1 })
