/** Address lookup stays on the server; precise coordinates are never sent to listing clients. */
export interface Coordinates { latitude: number; longitude: number }

let nextRequestAt = 0
let queue: Promise<unknown> = Promise.resolve()
const cache = new Map<string, Coordinates>()

export function geocoderEndpoint(): string {
  return process.env.GEOCODER_URL || (process.env.NODE_ENV === 'development' ? 'https://nominatim.openstreetmap.org/search' : '')
}

export async function geocodeAddress(address: string, endpoint = geocoderEndpoint(), request: typeof fetch = fetch): Promise<Coordinates | null> {
  if (!endpoint) return null
  const key = address.trim().replace(/\s+/g, ' ').toLowerCase()
  if (!key) return null
  const cached = cache.get(key)
  if (cached) return cached
  const work = queue.then(async () => {
    const wait = nextRequestAt - Date.now()
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
    nextRequestAt = Date.now() + 1100 // Public Nominatim permits at most one request per second.
    const url = new URL(endpoint)
    if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(url.hostname))) return null
    url.searchParams.set('q', `${address}, Malaysia`)
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('addressdetails', '1')
    url.searchParams.set('countrycodes', 'my')
    // A provider can rank a broad area above an exact building. Inspect a
    // small result set instead of treating its first result as the only one.
    url.searchParams.set('limit', '5')
    const response = await request(url, {
      headers: { 'User-Agent': 'UTSHousingFYP/1.0 (https://github.com/matcusting/FYPII)', 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return null
    const rows = await response.json() as Array<{ lat?: string; lon?: string; addresstype?: string }>
    const candidate = Array.isArray(rows) ? rows.find(row => {
      const latitude = Number(row?.lat)
      const longitude = Number(row?.lon)
      return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= 0.8 && latitude <= 7.5 && longitude >= 99.5 && longitude <= 119.5 &&
        !['country', 'state', 'county', 'city', 'town', 'village', 'suburb', 'neighbourhood', 'postcode'].includes(row?.addresstype || '')
    }) : undefined
    if (!candidate) return null
    const latitude = Number(candidate.lat)
    const longitude = Number(candidate.lon)
    const coordinates = { latitude, longitude }
    if (cache.size > 1000) cache.clear()
    cache.set(key, coordinates)
    return coordinates
  })
  queue = work.catch(() => null)
  try { return await work } catch { return null }
}
