import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, statfs, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const project = resolve(import.meta.dirname, '..')
const tmpfs = '/dev/shm'
const ready = await statfs(tmpfs).then(info => info.type === 0x01021994).catch(() => false)

test('production backup authenticates encrypted DB and private media, and rejects tampering', { skip: !ready }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'uts-prod-backup-test-'))
  const work = await mkdtemp(join(tmpfs, 'uts-prod-backup-work-'))
  const media = join(root, 'private')
  const target = join(root, 'offsite-mount')
  const bin = join(root, 'bin')
  const secret = join(root, 'secret')
  try {
    await mkdir(join(media, 'verifications'), { recursive: true })
    await mkdir(target)
    await mkdir(bin)
    await writeFile(join(media, 'verifications', 'synthetic.txt'), 'PRIVATE_SYNTHETIC_EVIDENCE')
    await writeFile(join(target, '.uts-housing-offsite-ready'), 'UTS_HOUSING_OFFSITE_BACKUPS_V1\n')
    await writeFile(secret, `test-only-${randomBytes(32).toString('hex')}\n`)
    const fakePgDump = join(bin, 'pg_dump')
    await writeFile(fakePgDump, '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do\n  if [ "$1" = "--file" ]; then shift; printf "synthetic-database-dump" > "$1"; exit 0; fi\n  shift\ndone\nexit 1\n', { mode: 0o700 })
    const env = { ...process.env, NODE_ENV: 'production', DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:5432/synthetic',
      MEDIA_PRIVATE_DIR: media, BACKUP_TARGET_DIR: target, BACKUP_WORK_DIR: work, BACKUP_PASSPHRASE_FILE: secret,
      API_HEALTH_URL: 'http://127.0.0.1:9/health/live', PATH: `${bin}:${process.env.PATH}` }
    const create = spawnSync(process.execPath, ['scripts/production-backup.mjs', 'create', '--confirm-writes-stopped'], { cwd: project, env, encoding: 'utf8' })
    assert.equal(create.status, 0, create.stderr)
    const archives = (await readdir(target)).filter(name => name.endsWith('.uthbak'))
    assert.equal(archives.length, 1)
    const archive = join(target, archives[0])
    assert.equal((await readFile(archive)).includes(Buffer.from('PRIVATE_SYNTHETIC_EVIDENCE')), false)
    const verify = spawnSync(process.execPath, ['scripts/production-backup.mjs', 'verify', `--file=${archive}`], { cwd: project, env, encoding: 'utf8' })
    assert.equal(verify.status, 0, verify.stderr)
    assert.match(verify.stdout, /checksums passed/)
    const tampered = await readFile(archive)
    tampered[Math.floor(tampered.length / 2)] ^= 0x01
    await writeFile(archive, tampered)
    const rejected = spawnSync(process.execPath, ['scripts/production-backup.mjs', 'verify', `--file=${archive}`], { cwd: project, env, encoding: 'utf8' })
    assert.notEqual(rejected.status, 0)
    assert.match(rejected.stderr, /Backup decryption failed/)
  } finally {
    await rm(work, { recursive: true, force: true })
    await rm(root, { recursive: true, force: true })
  }
})
