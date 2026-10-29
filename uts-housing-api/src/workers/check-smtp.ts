import { configuredSmtpTransport } from '../core/smtp.js'

async function main() {
  const recipient = process.argv.find(argument => argument.startsWith('--to='))?.slice(5)
  if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new Error('Usage: npm run email:check -- --to=your-address@example.com')
  const transport = configuredSmtpTransport()
  const from = process.env.EMAIL_FROM || ''
  if (!transport) throw new Error('SMTP_HOST is not configured. The local outbox does not send to a real mailbox.')
  if (!from || from.includes('example.local')) throw new Error('Set EMAIL_FROM to an address accepted by your SMTP provider.')
  try {
    await transport.verify()
    await transport.sendMail({ from, to: recipient, subject: 'UTS Housing SMTP delivery check', text: 'This is a test of the configured UTS Housing email service. No verification code or personal document is included.' })
    process.stdout.write('SMTP accepted the test message. Check the recipient inbox and spam folder to confirm actual delivery.\n')
  } finally { transport.close() }
}

main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'SMTP check failed.'}\n`); process.exitCode = 1 })
