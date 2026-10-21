import { useEffect, useId, useRef, useState } from 'react'

export function isIsoDate(value: string): boolean {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!parts) return false
  const year = Number(parts[1])
  const month = Number(parts[2])
  const day = Number(parts[3])
  if (year < 1 || month < 1 || month > 12) return false
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day >= 1 && day <= daysInMonth[month - 1]
}

function utcDate(year: number, month: number, day: number) {
  const date = new Date(0)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCFullYear(year, month, day)
  return date
}

function selectedMonth(value: string) {
  if (isIsoDate(value)) return utcDate(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, 1)
  const today = new Date()
  return utcDate(today.getFullYear(), today.getMonth(), 1)
}

function isoDate(year: number, month: number, day: number) {
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

interface EnglishDateInputProps {
  id?: string
  name?: string
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  className?: string
  required?: boolean
}

export function EnglishDateInput({ id, name, value, defaultValue = '', onValueChange, className = '', required = false }: EnglishDateInputProps) {
  const generatedId = useId()
  const inputId = id || `date-${generatedId}`
  const calendarId = `${inputId}-calendar`
  const errorId = `${inputId}-error`
  const wrapper = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState(defaultValue)
  const [open, setOpen] = useState(false)
  const [touched, setTouched] = useState(false)
  const current = value === undefined ? draft : value
  const [month, setMonth] = useState(() => selectedMonth(current))
  const invalid = touched && current !== '' && !isIsoDate(current)
  const year = month.getUTCFullYear()
  const monthIndex = month.getUTCMonth()
  const dayCount = utcDate(year, monthIndex + 1, 0).getUTCDate()
  const leadingDays = month.getUTCDay()

  function update(next: string) {
    if (value === undefined) setDraft(next)
    onValueChange?.(next)
  }

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return <div ref={wrapper} className="relative min-w-0">
    <div className="relative">
      <input
      id={inputId}
      name={name}
      type="text"
      inputMode="text"
      autoComplete="off"
      maxLength={10}
      placeholder="YYYY-MM-DD"
      aria-required={required || undefined}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? errorId : undefined}
      className={`${className} pr-11`}
      value={current}
      onChange={event => update(event.currentTarget.value)}
      onBlur={() => setTouched(true)}
      />
      <button type="button" aria-label="Choose date" aria-expanded={open} aria-controls={open ? calendarId : undefined} onClick={() => {
        if (!open) setMonth(selectedMonth(current))
        setOpen(previous => !previous)
      }} className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-[#203569] hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-[#203569]">
        <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18" /></svg>
      </button>
    </div>
    {invalid && <p id={errorId} role="alert" className="mt-1 text-xs font-normal text-red-700">Enter a valid date as YYYY-MM-DD.</p>}
    {open && <div id={calendarId} role="group" aria-label="English date picker" className="absolute left-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-gray-200 bg-white p-4 text-sm font-normal text-[#1f2937] shadow-xl">
      <div className="flex items-center justify-between gap-2">
        <button type="button" aria-label="Previous month" onClick={() => setMonth(utcDate(year, monthIndex - 1, 1))} className="flex size-9 items-center justify-center rounded-lg hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-[#203569]">‹</button>
        <span className="font-bold">{new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(month)}</span>
        <button type="button" aria-label="Next month" onClick={() => setMonth(utcDate(year, monthIndex + 1, 1))} className="flex size-9 items-center justify-center rounded-lg hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-[#203569]">›</button>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs font-bold text-gray-500">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <span key={day} className="py-1">{day}</span>)}</div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {Array.from({ length: leadingDays }, (_, index) => <span key={`empty-${index}`} />)}
        {Array.from({ length: dayCount }, (_, index) => {
          const day = index + 1
          const dateValue = isoDate(year, monthIndex, day)
          const date = utcDate(year, monthIndex, day)
          return <button key={day} type="button" aria-label={new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date)} aria-pressed={current === dateValue} onClick={() => { update(dateValue); setTouched(true); setOpen(false) }} className={current === dateValue ? 'flex size-9 items-center justify-center rounded-lg bg-[#203569] font-bold text-white' : 'flex size-9 items-center justify-center rounded-lg hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-[#203569]'}>{day}</button>
        })}
      </div>
      <div className="mt-3 flex justify-between border-t border-gray-100 pt-3">
        <button type="button" onClick={() => { update(''); setTouched(false); setOpen(false) }} className="font-semibold text-gray-600 hover:text-[#203569]">Clear</button>
        <button type="button" onClick={() => { const today = new Date(); update(isoDate(today.getFullYear(), today.getMonth(), today.getDate())); setTouched(true); setOpen(false) }} className="font-semibold text-[#203569] hover:underline">Today</button>
      </div>
    </div>}
  </div>
}
