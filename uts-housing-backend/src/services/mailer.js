import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { config } from '../config.js';

let transport = null;
if (config.smtpUrl) {
  // A malformed SMTP_URL (e.g. only the key pasted) must not stop the server from starting.
  if (/^smtps?:\/\//i.test(config.smtpUrl)) {
    try {
      transport = nodemailer.createTransport(config.smtpUrl);
    } catch (err) {
      console.error('[mail] SMTP_URL could not be used, falling back to the mail log:', err.message);
    }
  } else {
    console.error('[mail] SMTP_URL must start with smtp:// or smtps:// — e-mails go to the mail log instead.');
  }
}

/**
 * Send an e-mail. Without SMTP configured (local development) the message is
 * printed and appended to logs/mail.log so verification/reset links can be used.
 * Failures are logged, never thrown, so they don't block the main transaction.
 */
export async function sendMail({ to, subject, text }) {
  if (config.isTest) return;
  try {
    if (transport) {
      await transport.sendMail({ from: config.emailFrom, to, subject, text });
      return;
    }
    const entry = `\n=== ${new Date().toISOString()} ===\nTo: ${to}\nSubject: ${subject}\n\n${text}\n`;
    console.log(`[mail] ${subject} -> ${to}\n${text}`);
    fs.mkdirSync('logs', { recursive: true });
    fs.appendFileSync(path.join('logs', 'mail.log'), entry);
  } catch (err) {
    console.error('[mail] failed to send', err.message);
  }
}
