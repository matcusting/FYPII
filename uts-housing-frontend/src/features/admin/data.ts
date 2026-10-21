export type DataRecord = Record<string, unknown>

export function asRecord(value: unknown): DataRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as DataRecord
    : null
}

export function textValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

export function firstText(record: DataRecord | null, ...keys: string[]): string {
  for (const key of keys) {
    const value = textValue(record?.[key])
    if (value) return value
  }
  return ''
}

export function nestedText(record: DataRecord | null, field: string, ...keys: string[]): string {
  return firstText(asRecord(record?.[field]), ...keys)
}

export function dateText(value: unknown): string {
  const source = textValue(value)
  if (!source) return '—'
  const parsed = new Date(source)
  return Number.isNaN(parsed.valueOf())
    ? source
    : new Intl.DateTimeFormat('en-MY', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur',
    }).format(parsed)
}
