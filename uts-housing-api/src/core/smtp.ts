import nodemailer from 'nodemailer'

/** One SMTP configuration for the worker and the operator's local delivery check. */
export function configuredSmtpTransport() {
  const host = process.env.SMTP_HOST?.trim()
  if (!host) {
    if (process.env.SMTP_USER || process.env.SMTP_PASSWORD) throw new Error('Set SMTP_HOST when SMTP credentials are present.')
    return null
  }
  const port = Number(process.env.SMTP_PORT || 587)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP_PORT must be between 1 and 65535.')
  const user = process.env.SMTP_USER?.trim()
  const password = process.env.SMTP_PASSWORD
  if (Boolean(user) !== Boolean(password)) throw new Error('Set both SMTP_USER and SMTP_PASSWORD, or neither for a local relay.')
  const local = ['localhost', '127.0.0.1', '::1'].includes(host.toLowerCase())
  return nodemailer.createTransport({
    host, port, secure: port === 465, requireTLS: !local && port !== 465,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
    tls: { minVersion: 'TLSv1.2' },
    ...(user && password ? { auth: { user, pass: password } } : {}),
  })
}
