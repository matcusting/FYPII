import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, itemsOf, messageOf } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { money, type Listing } from '../../lib/types'
import { primaryButtonClass, secondaryButtonClass } from './ui'

export function HomePage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [keyword, setKeyword] = useState('')
  const [listings, setListings] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    api<unknown>('/listings?sort=newest&limit=3', { signal: controller.signal })
      .then(result => {
        setListings(itemsOf<Listing>(result))
        setError(null)
      })
      .catch(failure => {
        if (!controller.signal.aborted) setError(messageOf(failure))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [retry])

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const params = new URLSearchParams()
    if (keyword.trim()) params.set('q', keyword.trim())
    navigate(`/listings${params.size ? `?${params}` : ''}`)
  }

  return (
    <div className="mx-auto max-w-[1000px] px-4 py-8 sm:py-10">
      <section className="rounded-xl border border-slate-200 bg-white px-6 py-9 shadow-sm sm:px-10 sm:py-12">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-[#203569]">{t('UTS Housing & Roommate Finder')}</p>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{t('Find a place to live and a roommate who fits.')}</h1>
          <p className="mt-4 max-w-2xl leading-7 text-slate-600">{t('Browse published listings, compare rent and location, and explore roommate matches after student verification.')}</p>
          <form onSubmit={search} role="search" className="mt-7 flex flex-col gap-3 sm:flex-row">
            <label htmlFor="home-keyword" className="sr-only">{t('Search by listing, area or university')}</label>
            <input id="home-keyword" value={keyword} onChange={event => setKeyword(event.target.value)} placeholder={t('Enter an area, university or keyword')} className="min-h-11 flex-1 rounded-lg border border-slate-300 bg-white px-4 text-slate-900 placeholder:text-slate-500 focus:border-[#203569] focus:outline-none focus:ring-2 focus:ring-blue-100" />
            <button type="submit" className={primaryButtonClass}>{t('Search Listings')}</button>
          </form>
          <p className="mt-3 text-sm text-slate-500">{t('Availability is provided by the listing owner. Confirm it before making plans.')}</p>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" aria-labelledby="featured-heading">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="featured-heading" className="text-2xl font-bold text-slate-900">{t('Latest Listings')}</h2>
            <p className="mt-2 text-slate-600">{t('Only publicly published listings appear here.')}</p>
          </div>
          <Link to="/listings" className={secondaryButtonClass}>{t('View All Listings')}</Link>
        </div>
        {loading ? <p role="status" className="mt-8 text-slate-600">{t('Loading listings…')}</p> : null}
        {error ? <div role="alert" className="mt-8 rounded-xl border border-red-200 bg-red-50 p-5 text-red-800"><p>{t('Listings could not be loaded:')} {t(error)}</p><button type="button" onClick={() => { setLoading(true); setError(null); setRetry(value => value + 1) }} className="mt-3 font-semibold underline underline-offset-4">{t('Try Again')}</button></div> : null}
        {!loading && !error && listings.length === 0 ? <p className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-6 text-slate-600">{t('No listings are published yet. Please check back later.')}</p> : null}
        {!loading && !error && listings.length > 0 ? (
          <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map(listing => (
              <article key={listing.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                {listing.photos?.[0]?.url ? <img src={listing.photos[0].url} alt={listing.photos[0].alt || listing.title} loading="lazy" className="h-48 w-full object-cover" /> : <div aria-hidden="true" className="h-48 bg-[#f2f5fc]" />}
                <div className="p-5">
                  <h3 className="line-clamp-2 text-lg font-semibold text-slate-950">{listing.title}</h3>
                  <p className="mt-2 text-sm text-slate-600">{listing.approximateArea || listing.campusName || t('Area not provided')}</p>
                  <p className="mt-3 font-bold text-[#203569]">{money(listing.rent, listing.currency)} <span className="text-sm font-normal text-slate-600">{t('/ month')}</span></p>
                  <Link to={`/listings/${encodeURIComponent(listing.id)}`} className="mt-4 inline-block font-semibold text-[#203569] underline-offset-4 hover:underline">{t('View Details')}{' '}<span aria-hidden="true">→</span></Link>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-blue-100 bg-[#f2f5fc] p-6 sm:p-8">
          <h2 className="text-xl font-bold text-[#203569]">{t('Looking for a roommate?')}</h2>
          <p className="mt-3 leading-7 text-slate-600">{t('Add your habits and preferences, opt in to discovery and complete student verification to find potential roommates. Match scores compare preferences only.')}</p>
          <Link to="/roommates" className="mt-5 inline-block font-semibold text-[#203569] underline-offset-4 hover:underline">{t('Explore Roommate Matches →')}</Link>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-[#f0fbf3] p-6 sm:p-8">
          <h2 className="text-xl font-bold text-[#138044]">{t('Have a property to list?')}</h2>
          <p className="mt-3 leading-7 text-slate-600">{t('Landlords and eligible students can create drafts and submit them for review before publication. Confirm the property details and your right to sublet first.')}</p>
          <Link to="/my-listings" className="mt-5 inline-block font-semibold text-[#138044] underline-offset-4 hover:underline">{t('Manage My Listings →')}</Link>
        </div>
      </section>
    </div>
  )
}
