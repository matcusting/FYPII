import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, itemsOf, messageOf } from '../../lib/api'
import { money, type Listing } from '../../lib/types'
import { primaryButtonClass, secondaryButtonClass } from './ui'

export function HomePage() {
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
    <div>
      <section className="bg-gradient-to-br from-blue-950 via-blue-900 to-indigo-800 px-4 py-16 text-white sm:px-6 sm:py-24">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-blue-200">Student Housing & Roommate Finder</p>
            <h1 className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl">找房更清楚，寻找合适室友更安心。</h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-blue-100">浏览已发布房源、比较租金与位置，并在完成学生认证后探索室友匹配。</p>
            <form onSubmit={search} role="search" className="mt-9 flex flex-col gap-3 rounded-2xl bg-white p-3 shadow-xl sm:flex-row">
              <label htmlFor="home-keyword" className="sr-only">搜索房源关键词、地区或学校</label>
              <input id="home-keyword" value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="输入地区、学校或房源关键词" className="min-h-12 flex-1 rounded-xl border border-slate-300 px-4 text-slate-900 placeholder:text-slate-500 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-200" />
              <button type="submit" className={primaryButtonClass}>搜索房源</button>
            </form>
            <p className="mt-3 text-sm text-blue-100">房源可用情况由发布者提供，请在联系时再次确认。</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6" aria-labelledby="featured-heading">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="featured-heading" className="text-2xl font-bold text-slate-950">最新房源</h2>
            <p className="mt-2 text-slate-600">仅显示平台已公开发布的房源。</p>
          </div>
          <Link to="/listings" className={secondaryButtonClass}>查看全部房源</Link>
        </div>
        {loading ? <p role="status" className="mt-8 text-slate-600">正在加载房源…</p> : null}
        {error ? <div role="alert" className="mt-8 rounded-xl border border-red-200 bg-red-50 p-5 text-red-800"><p>暂时无法加载房源：{error}</p><button type="button" onClick={() => { setLoading(true); setError(null); setRetry(value => value + 1) }} className="mt-3 font-semibold underline underline-offset-4">重新加载</button></div> : null}
        {!loading && !error && listings.length === 0 ? <p className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-6 text-slate-600">目前没有已发布的房源，请稍后再查看。</p> : null}
        {!loading && !error && listings.length > 0 ? (
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map(listing => (
              <article key={listing.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                {listing.photos?.[0]?.url ? <img src={listing.photos[0].url} alt={listing.photos[0].alt || listing.title} loading="lazy" className="h-48 w-full object-cover" /> : <div aria-hidden="true" className="h-48 bg-gradient-to-br from-blue-100 to-indigo-100" />}
                <div className="p-5">
                  <h3 className="line-clamp-2 text-lg font-semibold text-slate-950">{listing.title}</h3>
                  <p className="mt-2 text-sm text-slate-600">{listing.approximateArea || listing.campusName || '地区待提供'}</p>
                  <p className="mt-3 font-bold text-blue-900">{money(listing.rent, listing.currency)} <span className="text-sm font-normal text-slate-600">/ 月</span></p>
                  <Link to={`/listings/${encodeURIComponent(listing.id)}`} className="mt-4 inline-block font-semibold text-blue-800 underline-offset-4 hover:underline">查看详情 <span aria-hidden="true">→</span></Link>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section className="border-t border-slate-200 bg-slate-50 px-4 py-14 sm:px-6">
        <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-2">
          <div>
            <h2 className="text-2xl font-bold text-slate-950">准备好找室友了吗？</h2>
            <p className="mt-3 leading-7 text-slate-600">填写生活习惯与偏好后，可在同意展示资料并完成学生认证的前提下寻找候选室友。匹配分数仅用于比较偏好。</p>
            <Link to="/roommates" className="mt-5 inline-block font-semibold text-blue-800 underline-offset-4 hover:underline">探索室友匹配 →</Link>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-950">有房源想发布？</h2>
            <p className="mt-3 leading-7 text-slate-600">房东及符合条件的学生可创建草稿，提交审核后公开展示。请先确认房源信息与转租资格。</p>
            <Link to="/my-listings" className="mt-5 inline-block font-semibold text-blue-800 underline-offset-4 hover:underline">管理我的房源 →</Link>
          </div>
        </div>
      </section>
    </div>
  )
}
