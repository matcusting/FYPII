import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { query } from '../../lib/api'
import type { Listing } from '../../lib/types'
import { Field, inputClass, ListingCard, primaryButton, QueryState, secondaryButton } from './components'
import { getList, propertyTypes, roomTypes, type Campus } from './model'

const filterNames = ['q', 'area', 'university', 'campusId', 'minRent', 'maxRent', 'maxDeposit', 'availableBy', 'maxDistanceKm', 'propertyType', 'roomType', 'amenities', 'furnished', 'sort'] as const

export function ListingsPage() {
  const [params, setParams] = useSearchParams()
  const page = Math.max(1, Number(params.get('page')) || 1)
  const limit = 12
  const searchQuery = query(Object.fromEntries([...filterNames.map(name => [name, params.get(name) || undefined]), ['page', page], ['limit', limit]]))
  const listings = useQuery({ queryKey: ['listings', searchQuery], queryFn: () => getList<Listing>(`/listings${searchQuery}`) })
  const campuses = useQuery({ queryKey: ['campuses'], queryFn: () => getList<Campus>('/campuses'), retry: false })
  const records = listings.data?.items || []
  const totalPages = listings.data?.pages || (listings.data?.total ? Math.ceil(listings.data.total / limit) : undefined)
  const canNext = totalPages ? page < totalPages : records.length >= limit

  function submit(form: HTMLFormElement) {
    const data = new FormData(form)
    const next = new URLSearchParams()
    for (const name of filterNames) {
      const value = String(data.get(name) || '').trim()
      if (value) next.set(name, value)
    }
    const minRent = Number(next.get('minRent'))
    const maxRent = Number(next.get('maxRent'))
    if (next.has('minRent') && next.has('maxRent') && minRent > maxRent) {
      form.querySelector<HTMLInputElement>('[name="maxRent"]')?.setCustomValidity('Maximum rent cannot be lower than minimum rent.')
      form.reportValidity()
      return
    }
    next.set('page', '1')
    setParams(next)
  }
  function changePage(nextPage: number) {
    const next = new URLSearchParams(params)
    next.set('page', String(nextPage))
    setParams(next)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return <div className="mx-auto w-full max-w-[1000px] px-4 pb-16 pt-2 font-sans sm:px-0">
    <Link to="/dashboard" className="mb-4 inline-flex items-center gap-1 text-sm font-bold text-gray-500 transition hover:text-gray-800">← Back to Dashboard</Link>
    <div className="flex min-h-[600px] flex-col overflow-hidden rounded-xl border border-gray-100 bg-white shadow-[0_2px_10px_rgba(0,0,0,0.04)] md:flex-row">
      <aside className="flex flex-col border-b border-gray-100 bg-[#fcfcfd] p-6 md:w-[300px] md:shrink-0 md:border-b-0 md:border-r md:p-8">
        <h1 className="mb-8 text-xl font-bold text-[#1f2937]">Filters</h1>
        <form key={params.toString()} className="flex flex-1 flex-col gap-6" onSubmit={event => { event.preventDefault(); submit(event.currentTarget) }}>
          <div><label htmlFor="rent-slider" className="mb-4 block text-[11px] font-bold uppercase tracking-wider text-[#475569]">Max Rent (RM)</label><input id="rent-slider" aria-label="Max Rent slider" className="w-full cursor-pointer accent-[#e11d48]" type="range" min="0" max="2000" step="50" defaultValue={params.get('maxRent') || '2000'} onInput={event => { const form = event.currentTarget.form; const value = event.currentTarget.value; const number = form?.querySelector<HTMLInputElement>('[name="maxRent"]'); const output = form?.querySelector<HTMLOutputElement>('#rent-output'); if (number) number.value = value; if (output) output.value = `RM ${value}` }} /><output id="rent-output" className="mt-1 block text-right text-sm text-[#475569]">{params.get('maxRent') ? `RM ${params.get('maxRent')}` : 'Any rent'}</output><input className="sr-only" aria-label="Maximum rent amount (RM)" type="number" name="maxRent" min="0" step="1" defaultValue={params.get('maxRent') || ''} onInput={event => { event.currentTarget.setCustomValidity(''); const form = event.currentTarget.form; const slider = form?.querySelector<HTMLInputElement>('#rent-slider'); const output = form?.querySelector<HTMLOutputElement>('#rent-output'); if (slider) slider.value = event.currentTarget.value; if (output) output.value = event.currentTarget.value ? `RM ${event.currentTarget.value}` : 'Any rent' }} /></div>
          <Field label="Distance to UTS"><select className={inputClass} name="maxDistanceKm" defaultValue={params.get('maxDistanceKm') || ''}><option value="">Any Distance</option><option value="5">Less than 5 km</option><option value="2">Less than 2 km</option></select></Field>
          <Field label="Campus"><select aria-label="Campus" className={inputClass} name="campusId" defaultValue={params.get('campusId') || ''}><option value="">All Campuses</option>{(campuses.data?.items || []).map(campus => <option value={campus.id} key={campus.id}>{campus.name}</option>)}</select></Field>
          {campuses.isError && <p className="text-xs text-amber-800" role="status">Campus filters are temporarily unavailable.</p>}
          <details className="border-t border-gray-200 pt-5 text-sm text-gray-600"><summary className="cursor-pointer font-bold text-[#203569]">More Filters</summary><div className="mt-5 space-y-4">
            <Field label="Keyword"><input className={inputClass} type="search" name="q" defaultValue={params.get('q') || ''} placeholder="Title or description" /></Field>
            <Field label="Area"><input className={inputClass} name="area" defaultValue={params.get('area') || ''} placeholder="e.g. Sibu Jaya" /></Field>
            <Field label="University"><input className={inputClass} name="university" defaultValue={params.get('university') || ''} /></Field>
            <Field label="Min Rent (RM)"><input className={inputClass} type="number" name="minRent" min="0" step="1" defaultValue={params.get('minRent') || ''} /></Field>
            <Field label="Max Deposit (RM)"><input className={inputClass} type="number" name="maxDeposit" min="0" step="1" defaultValue={params.get('maxDeposit') || ''} /></Field>
            <Field label="Available By"><input className={inputClass} type="date" name="availableBy" defaultValue={params.get('availableBy') || ''} /></Field>
            <Field label="Property Type"><select className={inputClass} name="propertyType" defaultValue={params.get('propertyType') || ''}><option value="">All Types</option>{propertyTypes.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></Field>
            <Field label="Room Type"><select className={inputClass} name="roomType" defaultValue={params.get('roomType') || ''}><option value="">All Types</option>{roomTypes.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></Field>
            <Field label="Facilities" hint="Separate facilities with commas."><input className={inputClass} name="amenities" defaultValue={params.get('amenities') || ''} placeholder="wifi,parking" /></Field>
            <Field label="Furnished"><select className={inputClass} name="furnished" defaultValue={params.get('furnished') || ''}><option value="">Any</option><option value="true">Yes</option><option value="false">No</option></select></Field>
            <Field label="Sort By"><select className={inputClass} name="sort" defaultValue={params.get('sort') || 'newest'}><option value="newest">Newest</option><option value="rent_asc">Rent: Low to High</option><option value="rent_desc">Rent: High to Low</option><option value="distance">Closest to Campus</option></select></Field>
          </div></details>
          <div className="mt-auto space-y-2 border-t border-gray-100 pt-5"><button type="submit" aria-label="Apply filters" className={`${primaryButton} w-full`}>Apply Filters</button><button type="button" className="w-full py-1 text-xs font-semibold text-gray-500 hover:text-[#203569]" onClick={() => setParams({})}>Reset Filters</button></div>
        </form>
      </aside>
      <section aria-label="Housing search results" className="min-w-0 flex-1 bg-white p-6 md:p-8"><h2 className="mb-6 text-xl font-bold text-[#203569]" role="status">{listings.isPending ? 'Loading...' : `${listings.data?.total ?? records.length} Verified Listings`}</h2>
        <QueryState loading={listings.isPending} error={listings.error} retry={() => { void listings.refetch() }} empty={!records.length && page === 1}>
          {records.length ? <div className="space-y-4 pb-6">{records.map(listing => <ListingCard key={listing.id} listing={listing} />)}</div> : <p className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-600">This page has no properties. Return to the previous page.</p>}
          {(page > 1 || canNext) && <nav aria-label="Search results pagination" className="flex items-center justify-center gap-4 pt-3"><button type="button" className={secondaryButton} disabled={page <= 1} onClick={() => changePage(page - 1)}>Previous</button><span className="text-sm text-gray-600">Page {page}{totalPages ? ` of ${totalPages}` : ''}</span><button type="button" className={secondaryButton} disabled={!canNext} onClick={() => changePage(page + 1)}>Next</button></nav>}
        </QueryState>
      </section>
    </div>
  </div>
}
