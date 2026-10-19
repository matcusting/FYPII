import { useSearchParams } from 'react-router-dom'
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
      form.querySelector<HTMLInputElement>('[name="maxRent"]')?.setCustomValidity('最高月租不能低于最低月租。')
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

  return <div className="mx-auto max-w-7xl space-y-7 px-4 py-10 sm:px-6 lg:px-8">
    <header className="space-y-2"><p className="text-sm font-semibold uppercase tracking-wider text-indigo-700">学生租房</p><h1 className="text-3xl font-bold text-slate-900">寻找合适的房源</h1><p className="text-slate-600">浏览已审核的房源。可租状态由房东提供，请在联系时再次确认。</p></header>
    <div className="grid items-start gap-7 lg:grid-cols-[290px_minmax(0,1fr)]">
      <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="mb-4 text-lg font-semibold">筛选条件</h2>
        <form key={params.toString()} className="space-y-4" onSubmit={event => { event.preventDefault(); submit(event.currentTarget) }}>
          <Field label="关键词"><input className={inputClass} type="search" name="q" defaultValue={params.get('q') || ''} placeholder="房源标题或描述" /></Field>
          <Field label="区域"><input className={inputClass} name="area" defaultValue={params.get('area') || ''} placeholder="例如：Sibu Jaya" /></Field>
          <Field label="大学"><input className={inputClass} name="university" defaultValue={params.get('university') || ''} placeholder="输入大学名称" /></Field>
          <Field label="校区"><select className={inputClass} name="campusId" defaultValue={params.get('campusId') || ''}><option value="">所有校区</option>{(campuses.data?.items || []).map(campus => <option value={campus.id} key={campus.id}>{campus.name}</option>)}</select></Field>
          {campuses.isError && <p className="text-xs text-amber-800" role="status">暂时无法读取校区列表，其他筛选仍可使用。</p>}
          <div className="grid grid-cols-2 gap-3"><Field label="最低月租 (RM)"><input className={inputClass} type="number" name="minRent" min="0" step="1" defaultValue={params.get('minRent') || ''} /></Field><Field label="最高月租 (RM)"><input className={inputClass} type="number" name="maxRent" min="0" step="1" defaultValue={params.get('maxRent') || ''} onInput={event => event.currentTarget.setCustomValidity('')} /></Field></div>
          <Field label="最高押金 (RM)"><input className={inputClass} type="number" name="maxDeposit" min="0" step="1" defaultValue={params.get('maxDeposit') || ''} /></Field>
          <Field label="最迟可入住日期"><input className={inputClass} type="date" name="availableBy" defaultValue={params.get('availableBy') || ''} /></Field>
          <Field label="校区距离上限 (公里)" hint="约略直线距离，不代表驾驶距离。"><input className={inputClass} type="number" name="maxDistanceKm" min="0" step="0.1" defaultValue={params.get('maxDistanceKm') || ''} /></Field>
          <Field label="房屋类型"><select className={inputClass} name="propertyType" defaultValue={params.get('propertyType') || ''}><option value="">全部</option>{propertyTypes.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></Field>
          <Field label="房间类型"><select className={inputClass} name="roomType" defaultValue={params.get('roomType') || ''}><option value="">全部</option>{roomTypes.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></Field>
          <Field label="设施" hint="用逗号分隔多个设施关键词。"><input className={inputClass} name="amenities" defaultValue={params.get('amenities') || ''} placeholder="wifi,parking" /></Field>
          <Field label="家具"><select className={inputClass} name="furnished" defaultValue={params.get('furnished') || ''}><option value="">不限</option><option value="true">配备家具</option><option value="false">未配备家具</option></select></Field>
          <Field label="排序"><select className={inputClass} name="sort" defaultValue={params.get('sort') || 'newest'}><option value="newest">最新发布</option><option value="rent_asc">月租从低到高</option><option value="rent_desc">月租从高到低</option><option value="distance">离校区最近</option></select></Field>
          <div className="flex gap-2"><button type="submit" className={primaryButton}>应用筛选</button><button type="button" className={secondaryButton} onClick={() => setParams({})}>清除</button></div>
        </form>
      </aside>
      <section aria-label="房源搜索结果" className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-2"><h2 className="text-xl font-semibold text-slate-900">搜索结果</h2><p className="text-sm text-slate-600" role="status">{listings.data?.total != null ? `找到 ${listings.data.total} 个房源` : `第 ${page} 页`}</p></div>
        <QueryState loading={listings.isPending} error={listings.error} retry={() => { void listings.refetch() }} empty={!records.length && page === 1}>
          {records.length ? <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{records.map(listing => <ListingCard key={listing.id} listing={listing} />)}</div> : <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-600">这一页没有房源，请返回上一页。</p>}
          {(page > 1 || canNext) && <nav aria-label="搜索结果分页" className="flex items-center justify-center gap-4 pt-3"><button type="button" className={secondaryButton} disabled={page <= 1} onClick={() => changePage(page - 1)}>上一页</button><span className="text-sm text-slate-600">第 {page} 页{totalPages ? `，共 ${totalPages} 页` : ''}</span><button type="button" className={secondaryButton} disabled={!canNext} onClick={() => changePage(page + 1)}>下一页</button></nav>}
        </QueryState>
      </section>
    </div>
  </div>
}
