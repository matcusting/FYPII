const baseUrl = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...(csrfToken && init.method && init.method !== 'GET' ? { 'X-CSRF-Token': csrfToken } : {}),
      ...init.headers,
    },
  })
  if (response.status === 204 && response.ok) return undefined as T
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    throw new ApiError('The server did not return the expected JSON response. Check that the API service is running.', response.status)
  }
  const payload = await response.json()
  if (!response.ok) {
    throw new ApiError(payload?.error?.message || 'The request failed. Please try again later.', response.status, payload?.error?.code)
  }
  return payload.data as T
}

export function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error && error.name === 'TypeError') return 'Could not connect to the server. Check your network or the API service.'
  return error instanceof Error ? error.message : 'An unknown error occurred.'
}

export function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  })
  return search.size ? `?${search}` : ''
}

export function itemsOf<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    for (const field of ['items', 'results', 'listings', 'matches', 'requests', 'reviews']) {
      if (Array.isArray(object[field])) return object[field] as T[]
    }
  }
  return []
}
