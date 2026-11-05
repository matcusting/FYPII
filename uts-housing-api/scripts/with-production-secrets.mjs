import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

function secret(path, label) {
  if (!path) throw new Error(`${label} secret file is required.`)
  const value = readFileSync(path, 'utf8').replace(/\r?\n$/, '')
  if (!value || /[\r\n\0]/.test(value)) throw new Error(`${label} secret file is empty or invalid.`)
  return value
}

if (process.env.NODE_ENV !== 'production') throw new Error('This entry point is for production containers only.')
const [command, ...args] = process.argv.slice(2)
if (!command) throw new Error('Supply the container command.')

const database = new URL(`postgresql://${process.env.DB_HOST || 'db'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'housing'}`)
database.username = process.env.DB_USER || 'housing'
database.password = secret(process.env.DB_PASSWORD_FILE, 'Database password')
database.searchParams.set('schema', 'public')

const env = { ...process.env, DATABASE_URL: database.toString() }
if (env.SESSION_SECRET_FILE) env.SESSION_SECRET = secret(env.SESSION_SECRET_FILE, 'Session')
if (env.MFA_ENCRYPTION_KEY_FILE) env.MFA_ENCRYPTION_KEY = secret(env.MFA_ENCRYPTION_KEY_FILE, 'MFA encryption')
if (env.SMTP_PASSWORD_FILE) env.SMTP_PASSWORD = secret(env.SMTP_PASSWORD_FILE, 'SMTP password')
if (env.TWILIO_AUTH_TOKEN_FILE) env.TWILIO_AUTH_TOKEN = secret(env.TWILIO_AUTH_TOKEN_FILE, 'SMS provider token')
for (const name of ['DB_PASSWORD_FILE', 'SESSION_SECRET_FILE', 'MFA_ENCRYPTION_KEY_FILE', 'SMTP_PASSWORD_FILE', 'TWILIO_AUTH_TOKEN_FILE']) delete env[name]

const child = spawn(command, args, { env, stdio: 'inherit' })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('error', error => {
  console.error(`Container command could not start: ${error.code || error.name}`)
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 128 + (signal === 'SIGINT' ? 2 : 15) : 1)
})
