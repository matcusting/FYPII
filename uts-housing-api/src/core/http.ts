import type { RequestHandler, Response } from 'express'

export function ok<T>(res: Response, data: T, status = 200): Response {
  return res.status(status).json({ data })
}

export function fail(res: Response, status: number, message: string, code = 'REQUEST_FAILED'): Response {
  return res.status(status).json({ error: { code, message } })
}

export function asyncRoute(fn: RequestHandler): RequestHandler {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
}
