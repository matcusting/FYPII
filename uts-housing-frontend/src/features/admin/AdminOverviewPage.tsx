import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, messageOf } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { AdminShell, QueryState } from './shared'
import { asRecord, type DataRecord } from './data'

const metrics = [
  { label: 'Student verifications pending', path: '/admin/verifications', keys: ['pendingVerifications', 'pendingStudentVerifications', 'verificationsPending', 'studentVerifications'] },
  { label: 'Landlord identities pending', path: '/admin/landlord-verifications', keys: ['pendingLandlordVerifications', 'landlordVerificationsPending'] },
  { label: 'Property authorizations pending', path: '/admin/property-authorizations', keys: ['pendingPropertyAuthorizations', 'propertyAuthorizationsPending'] },
  { label: 'Landlord accounts', path: '/admin/accounts', keys: ['landlordAccounts', 'landlords', 'landlordCount'] },
  { label: 'Listings pending review', path: '/admin/listings', keys: ['pendingListings', 'listingsPending'] },
  { label: 'Reviews pending moderation', path: '/admin/reviews', keys: ['pendingReviews', 'reviewsPending'] },
  { label: 'Open reports', path: '/admin/reports', keys: ['openReports', 'pendingReports', 'reportsOpen'] },
] as const

function metricValue(data: DataRecord | null, keys: readonly string[], locale: string): string {
  const numberLocale = locale === 'ms' ? 'ms-MY' : locale === 'zh-CN' ? 'zh-CN' : 'en-MY'
  const sections = [data, asRecord(data?.counts), asRecord(data?.metrics), asRecord(data?.pending)]
  for (const section of sections) {
    for (const key of keys) {
      const value = section?.[key]
      if (typeof value === 'number' && Number.isFinite(value)) return new Intl.NumberFormat(numberLocale).format(value)
      if (typeof value === 'string' && /^\d+$/.test(value)) return new Intl.NumberFormat(numberLocale).format(Number(value))
    }
  }
  return '—'
}

export function AdminOverviewPage() {
  const { t, locale } = useI18n()
  const overview = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => api<unknown>('/admin/overview') })
  const data = asRecord(overview.data)

  return (
    <AdminShell title="Admin Overview" description="Review pending work and open the appropriate moderation queue. All counts come from the admin API.">
      <QueryState loading={overview.isPending} error={overview.error ? messageOf(overview.error) : null} empty={!data} emptyText="The admin API has not returned overview data." onRetry={() => { void overview.refetch() }} />
      {data && !overview.error && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {metrics.map(metric => (
            <Link key={metric.label} to={metric.path} className="card block p-5 no-underline transition hover:border-[#a8bde8] hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#203569]">
              <span className="block text-sm font-medium text-slate-600">{t(metric.label)}</span>
              <strong className="mt-3 block text-3xl text-[#203569]">{metricValue(data, metric.keys, locale)}</strong>
              <span className="mt-4 block text-sm font-semibold text-[#203569]">{t('View details →')}</span>
            </Link>
          ))}
        </div>
      )}
    </AdminShell>
  )
}
