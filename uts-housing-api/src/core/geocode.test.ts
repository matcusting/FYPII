import { describe, expect, it, vi } from 'vitest'
import { geocodeAddress } from './geocode.js'

const endpoint = 'https://example.test/search'

describe('private address lookup', () => {
  it('sends a Malaysian address to the configured service and accepts a valid point', async () => {
    const request = vi.fn(async (_url: URL) => new Response(JSON.stringify([{ lat: '2.322', lon: '111.839', addresstype: 'house' }]), { status: 200 })) as unknown as typeof fetch
    const point = await geocodeAddress('12 Jalan Distance Test, 96000 Sibu', endpoint, request)
    expect(point).toEqual({ latitude: 2.322, longitude: 111.839 })
    const url = (request as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as URL
    expect(url.searchParams.get('countrycodes')).toBe('my')
    expect(url.searchParams.get('q')).toContain('12 Jalan Distance Test')
  })

  it('does not claim a distance from a city-only or out-of-country match', async () => {
    const city = vi.fn(async () => new Response(JSON.stringify([{ lat: '2.3', lon: '111.8', addresstype: 'city' }]), { status: 200 })) as unknown as typeof fetch
    const abroad = vi.fn(async () => new Response(JSON.stringify([{ lat: '51.5', lon: '-0.1', addresstype: 'house' }]), { status: 200 })) as unknown as typeof fetch
    expect(await geocodeAddress('Invalid city-only example, Sibu', endpoint, city)).toBeNull()
    expect(await geocodeAddress('Invalid abroad example, Sibu', endpoint, abroad)).toBeNull()
  })

  it('leaves the listing usable when lookup fails', async () => {
    const request = vi.fn(async () => { throw new Error('lookup unavailable') }) as unknown as typeof fetch
    expect(await geocodeAddress('Unavailable lookup address, Sibu', endpoint, request)).toBeNull()
    expect(await geocodeAddress('12 Jalan Distance Test, 96000 Sibu', '', request)).toBeNull()
  })
})
