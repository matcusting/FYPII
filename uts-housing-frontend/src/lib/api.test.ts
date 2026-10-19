// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'

afterEach(() => vi.unstubAllGlobals())

describe('API transport', () => {
  it('sends cookie credentials and unwraps the documented data envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: 'listing-1' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(api<{ id: string }>('/listings/listing-1')).resolves.toEqual({ id: 'listing-1' })
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/listings/listing-1', expect.objectContaining({ credentials: 'include' }))
  })

  it('preserves the server error status and message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: '没有权限' } }), { status: 403, headers: { 'Content-Type': 'application/json' } })))
    await expect(api('/profile')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN', message: '没有权限' } satisfies Partial<ApiError>)
  })

  it('accepts an empty successful logout response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
    await expect(api('/auth/logout', { method: 'POST' })).resolves.toBeUndefined()
  })

  it('surfaces a missing API rather than treating Vite HTML as data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>fallback</html>', { status: 200, headers: { 'Content-Type': 'text/html' } })))
    await expect(api('/listings')).rejects.toThrow(/JSON/)
  })
})
