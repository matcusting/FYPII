import type { ChangeEvent } from 'react'
import { useI18n } from '../lib/i18n'

interface Props {
  accept: string
  selected: File | null
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
}

/** Place inside the field's label so the native file dialog remains accessible. */
export function LocalizedFileInput({ accept, selected, onChange }: Props) {
  const { t } = useI18n()
  return <span className="mt-2 flex min-h-11 cursor-pointer flex-wrap items-center gap-3 rounded-lg border border-gray-300 bg-white px-3 py-2 font-normal focus-within:ring-2 focus-within:ring-[#203569]">
    <input type="file" accept={accept} onChange={onChange} className="sr-only" />
    <span aria-hidden="true" className="rounded-md bg-[#203569] px-3 py-1.5 text-xs font-semibold text-white">{t('Choose file')}</span>
    <span className="min-w-0 flex-1 truncate text-sm text-gray-600">{selected?.name || t('No file selected')}</span>
  </span>
}
