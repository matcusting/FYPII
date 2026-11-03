/** Calendar-year arithmetic in UTC. February 29 clamps to February 28 when
 * the destination year has no leap day. Date-only values remain at midnight. */
export function addUtcCalendarYears(value: Date, years: number): Date {
  const year = value.getUTCFullYear() + years
  const month = value.getUTCMonth()
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const day = Math.min(value.getUTCDate(), lastDay)
  return new Date(Date.UTC(year, month, day, value.getUTCHours(), value.getUTCMinutes(), value.getUTCSeconds(), value.getUTCMilliseconds()))
}

export function parseUtcDateOnly(input: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return null
  const date = new Date(`${input}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === input ? date : null
}

export function utcDayAfter(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() + 1))
}
