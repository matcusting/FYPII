import { app } from './app.js'

const port = Number(process.env.PORT || 3001)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.')
if (process.env.NODE_ENV === 'production' && (!process.env.DATABASE_URL || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error('DATABASE_URL and a strong SESSION_SECRET are required in production.')
}
app.listen(port, () => { console.info(`UTS Housing API listening on port ${port}`) })
