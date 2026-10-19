import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, messageOf, query } from '../../lib/api'
import type { Listing } from '../../lib/types'
import { money } from '../../lib/types'
import { ListingCard, Notice, primaryButton, QueryState, secondaryButton } from './components'
import { formatDate, getList, statusNames, type ListingDetails } from './model'

export function FavoritesPage() {
  const favorites = useQuery({ queryKey: ['favorites'], queryFn: () => getList<Listing | { listing: Listing }>('/favorites') })
  const records = (favorites.data?.items || []).map(item => 'listing' in item ? item.listing : item).filter(item => !!item?.id)
  return <div className="mx-auto max-w-6xl space-y-6 px-4 py-10 sm:px-6 lg:px-8"><div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-bold text-slate-900">我的收藏</h1><p className="mt-2 text-slate-600">保存感兴趣的房源，方便再次查看。</p></div><Link className={secondaryButton} to="/listings">浏览房源</Link></div><QueryState loading={favorites.isPending} error={favorites.error} retry={() => { void favorites.refetch() }} empty={!records.length}><div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{records.map(item => <ListingCard key={item.id} listing={item} />)}</div></QueryState></div>
}

export function MyListingsPage() {
  const client = useQueryClient()
  const [page, setPage] = useState(1)
  const [actionError, setActionError] = useState<string | null>(null)
  const list = useQuery({ queryKey: ['my-listings', page], queryFn: () => getList<ListingDetails>(`/listings${query({ mine: true, page, limit: 20 })}`) })
  const action = useMutation({ mutationFn: ({ id, type }: { id: string; type: 'submit' | 'availability' | 'archive' | 'pause' | 'resume' | 'rented' }) => {
    const path = `/listings/${encodeURIComponent(id)}`
    if (type === 'archive') return api(path, { method: 'DELETE' })
    if (type === 'pause' || type === 'resume' || type === 'rented') {
      const status = type === 'pause' ? 'PAUSED' : type === 'resume' ? 'PUBLISHED' : 'RENTED'
      return api(path, { method: 'PATCH', body: JSON.stringify({ status }) })
    }
    return api(`${path}/${type}`, { method: 'POST' })
  }, onSuccess: async () => { setActionError(null); await Promise.all([client.invalidateQueries({ queryKey: ['my-listings'] }), client.invalidateQueries({ queryKey: ['listings'] })]) }, onError: error => { setActionError(messageOf(error)) } })
  const items = list.data?.items || []
  const hasNext = list.data?.pages ? page < list.data.pages : items.length >= 20
  return <div className="mx-auto max-w-6xl space-y-6 px-4 py-10 sm:px-6 lg:px-8"><div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-bold text-slate-900">我的房源</h1><p className="mt-2 text-slate-600">创建草稿、提交审核并及时确认房源是否仍可出租。</p></div><Link to="/listings/new" className={primaryButton}>新增房源</Link></div>
    {actionError && <Notice tone="error">{actionError}</Notice>}{action.isSuccess && <Notice tone="success">操作已保存。</Notice>}
    <QueryState loading={list.isPending} error={list.error} retry={() => { void list.refetch() }} empty={!items.length && page === 1}><div className="space-y-4">{items.map(item => <article key={item.id} className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-[120px_minmax(0,1fr)]"><div>{item.photos?.[0]?.url ? <img src={item.photos[0].url} alt={item.photos[0].alt || `${item.title} 照片`} className="h-28 w-full rounded-xl object-cover" /> : <div className="flex h-28 items-center justify-center rounded-xl bg-slate-100 text-xs text-slate-500">暂无照片</div>}</div><div className="space-y-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-900">{item.title}</h2><p className="text-sm text-slate-600">{item.approximateArea || '区域未提供'} · {money(item.rent, item.currency)} / 月</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{statusNames[item.status || ''] || item.status || '状态未知'}</span></div><p className="text-xs text-slate-500">上次确认可租：{formatDate(item.lastConfirmedAt)}</p>{item.availabilityStale && <Notice tone="error">此房源的可租状态已过期，请重新确认。</Notice>}{item.rejectionReason && <Notice tone="error">审核意见：{item.rejectionReason}</Notice>}<div className="flex flex-wrap gap-2"><Link className={secondaryButton} to={`/listings/${encodeURIComponent(item.id)}/edit`}>编辑</Link>{item.status === 'PUBLISHED' && <Link className={secondaryButton} to={`/listings/${encodeURIComponent(item.id)}`}>查看公开页面</Link>}{['DRAFT', 'REJECTED', 'RENTED'].includes(item.status || '') && <button type="button" className={primaryButton} disabled={action.isPending || !item.photos?.length} title={!item.photos?.length ? '提交审核前至少上传一张照片' : undefined} onClick={() => action.mutate({ id: item.id, type: 'submit' })}>提交审核</button>}{['PUBLISHED', 'PAUSED'].includes(item.status || '') && <button type="button" className={secondaryButton} disabled={action.isPending} onClick={() => action.mutate({ id: item.id, type: 'availability' })}>确认仍可出租</button>}{item.status === 'PUBLISHED' && <><button type="button" className={secondaryButton} disabled={action.isPending} onClick={() => action.mutate({ id: item.id, type: 'pause' })}>暂停展示</button><button type="button" className={secondaryButton} disabled={action.isPending} onClick={() => { if (window.confirm('确定已出租此房源吗？标记后将不再公开展示。')) action.mutate({ id: item.id, type: 'rented' }) }}>标记已出租</button></>}{item.status === 'PAUSED' && <button type="button" className={secondaryButton} disabled={action.isPending} onClick={() => action.mutate({ id: item.id, type: 'resume' })}>恢复展示</button>}{item.status !== 'ARCHIVED' && <button type="button" className="rounded-xl border border-rose-300 px-4 py-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-500 disabled:opacity-50" disabled={action.isPending} onClick={() => { if (window.confirm('确定要归档此房源吗？归档后将不再公开展示。')) action.mutate({ id: item.id, type: 'archive' }) }}>归档</button>}</div></div></article>)}{!items.length && page > 1 && <Notice>这一页没有房源，请返回上一页。</Notice>}</div><nav aria-label="我的房源分页" className="mt-5 flex items-center justify-center gap-3"><button className={secondaryButton} type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button><span className="text-sm text-slate-600">第 {page} 页</span><button className={secondaryButton} type="button" disabled={!hasNext} onClick={() => setPage(page + 1)}>下一页</button></nav></QueryState>
  </div>
}
