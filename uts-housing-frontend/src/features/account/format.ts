import { currentLocale, translate } from '../../lib/i18n'

export const inputClass = 'mt-1.5 block w-full rounded-lg border border-gray-300 bg-white p-2.5 text-gray-800 outline-none transition-colors focus:border-[#203569] disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-500'

export function formatDate(value: string | undefined | null) {
  if (!value) return '—'
  const date = new Date(value)
  const locale = currentLocale() === 'zh-CN' ? 'zh-CN' : currentLocale() === 'ms' ? 'ms-MY' : 'en-MY'
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date)
}

export function labelForStatus(status: string | undefined | null) {
  const labels: Record<string, string> = {
    UNVERIFIED: 'Not verified', PENDING: 'Pending', PENDING_REVIEW: 'Pending review', APPROVED: 'Approved', ACCEPTED: 'Accepted',
    REJECTED: 'Rejected', DECLINED: 'Declined', CLOSED: 'Closed', PUBLISHED: 'Published',
    DRAFT: 'Draft', PAUSED: 'Paused', RENTED: 'Rented', ARCHIVED: 'Archived',
  }
  return translate(status ? (labels[status.toUpperCase()] || status) : 'Status unknown')
}
