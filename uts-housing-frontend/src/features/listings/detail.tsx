import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, messageOf } from '../../lib/api'
import { hasRole, useAuth } from '../../lib/auth'
import { money } from '../../lib/types'
import { FavoriteButton, Field, inputClass, Notice, primaryButton, QueryState, secondaryButton } from './components'
import { formatDate, getList, labelOf, propertyTypes, roomTypes, type ListingDetails, type Review } from './model'

function Reviews({ listingId }: { listingId: string }) {
  const { user } = useAuth()
  const client = useQueryClient()
  const reviews = useQuery({ queryKey: ['listing-reviews', listingId], queryFn: () => getList<Review>(`/listings/${encodeURIComponent(listingId)}/reviews`) })
  const mutation = useMutation({ mutationFn: (payload: { rating: number; body: string; experienceDescription: string }) => api(`/listings/${encodeURIComponent(listingId)}/reviews`, { method: 'POST', body: JSON.stringify(payload) }), onSuccess: async () => { await client.invalidateQueries({ queryKey: ['listing-reviews', listingId] }) } })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    mutation.mutate({ rating: Number(data.get('rating')), body: String(data.get('body') || '').trim(), experienceDescription: String(data.get('experienceDescription') || '').trim() }, { onSuccess: () => form.reset() })
  }
  return <section className="space-y-5" aria-labelledby="reviews-heading">
    <div><h2 id="reviews-heading" className="text-2xl font-semibold">租住评价</h2><p className="mt-1 text-sm text-slate-600">仅显示已审核的评价。发表评价需通过学生及租住经历验证。</p></div>
    {reviews.isPending ? <p role="status" className="text-slate-500">正在读取评价…</p> : reviews.isError ? <Notice tone="error">{messageOf(reviews.error)}</Notice> : reviews.data?.items.length ? <div className="space-y-3">{reviews.data.items.map(review => <article key={review.id} className="rounded-xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-2"><strong>{review.author?.name || review.authorName || '已认证租客'}</strong><span className="text-sm text-slate-500">{formatDate(review.createdAt)}</span></div><p aria-label={`评分 ${review.rating} / 5`} className="mt-1 text-amber-700">{'★'.repeat(Math.max(0, Math.min(5, Number(review.rating) || 0)))}{'☆'.repeat(5 - Math.max(0, Math.min(5, Number(review.rating) || 0)))}</p><p className="mt-2 whitespace-pre-wrap text-slate-700">{review.body}</p></article>)}</div> : <Notice>目前还没有已审核的评价。</Notice>}
    {!user ? <p className="text-sm text-slate-600"><Link to={`/login?next=${encodeURIComponent(`/listings/${listingId}`)}`} className="font-semibold text-indigo-700 underline">登录</Link>后可申请发表评价。</p> : !hasRole(user, 'STUDENT') || !user.studentVerified ? <Notice>只有已认证并具有真实租住经历的学生可以提交评价。</Notice> : <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
      <h3 className="text-lg font-semibold">提交租住评价</h3><Field label="评分" required><select className={inputClass} name="rating" required defaultValue=""><option value="" disabled>请选择评分</option>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value} / 5</option>)}</select></Field>
      <Field label="评价内容" required><textarea className={inputClass} name="body" minLength={20} maxLength={2000} rows={4} required placeholder="客观描述你的实际租住体验" /></Field>
      <Field label="租住经历说明" required hint="请简述租住时间与经历，后台会核查资格。不要在公开文字中写出证件号码或私人联系方式。"><textarea className={inputClass} name="experienceDescription" minLength={10} maxLength={500} rows={3} required /></Field>
      {mutation.isError && <Notice tone="error">{messageOf(mutation.error)}</Notice>}{mutation.isSuccess && <Notice tone="success">评价已提交，将在审核通过后公开。</Notice>}
      <button className={primaryButton} disabled={mutation.isPending}>{mutation.isPending ? '提交中…' : '提交审核'}</button>
    </form>}
  </section>
}

function Inquiry({ listingId, ownerId }: { listingId: string; ownerId?: string }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const mutation = useMutation({ mutationFn: (message: string) => api(`/listings/${encodeURIComponent(listingId)}/inquiries`, { method: 'POST', body: JSON.stringify({ message }) }) })
  if (user?.id === ownerId) return null
  return <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5" aria-labelledby="inquiry-heading"><h2 id="inquiry-heading" className="text-xl font-semibold">联系房东</h2><p className="text-sm text-slate-600">使用站内询问联系房东。付款与租约事宜请自行核实。</p>
    {!user ? <button className={primaryButton} type="button" onClick={() => navigate(`/login?next=${encodeURIComponent(`/listings/${listingId}`)}`)}>登录后询问</button> : !hasRole(user, 'STUDENT') ? <Notice>学生账户可以向房东发送询问。</Notice> : <form className="space-y-3" onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const message = String(new FormData(form).get('message') || '').trim(); mutation.mutate(message, { onSuccess: () => form.reset() }) }}><Field label="询问内容" required><textarea className={inputClass} name="message" rows={4} minLength={10} maxLength={2000} required placeholder="您好，我想了解入住日期、家具及看房安排…" /></Field>{mutation.isError && <Notice tone="error">{messageOf(mutation.error)}</Notice>}{mutation.isSuccess && <Notice tone="success">询问已发送。你可以在请求中心查看回复。</Notice>}<button className={primaryButton} disabled={mutation.isPending}>{mutation.isPending ? '发送中…' : '发送询问'}</button></form>}
  </section>
}

function ReportListing({ listingId }: { listingId: string }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const mutation = useMutation({ mutationFn: (payload: { category: string; reason: string }) => api('/reports', { method: 'POST', body: JSON.stringify({ targetType: 'LISTING', targetId: listingId, ...payload }) }) })
  if (!user) return null
  return <div className="space-y-3"><button type="button" className="text-sm font-medium text-rose-700 underline focus:outline-none focus:ring-2 focus:ring-indigo-500" aria-expanded={open} onClick={() => setOpen(!open)}>举报此房源</button>{open && <form className="space-y-3 rounded-xl border border-slate-200 bg-white p-4" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); mutation.mutate({ category: String(data.get('category')), reason: String(data.get('reason') || '').trim() }) }}><Field label="举报原因"><select className={inputClass} name="category"><option value="FRAUD">疑似虚假房源</option><option value="INACCURATE">信息不实</option><option value="HARASSMENT">骚扰</option><option value="OTHER">其他</option></select></Field><Field label="具体说明" required><textarea className={inputClass} name="reason" required minLength={10} maxLength={1000} rows={3} /></Field>{mutation.isError && <Notice tone="error">{messageOf(mutation.error)}</Notice>}{mutation.isSuccess && <Notice tone="success">举报已提交，管理员会审查。</Notice>}<button className={secondaryButton} disabled={mutation.isPending}>提交举报</button></form>}</div>
}

export function ListingDetailPage() {
  const { id = '' } = useParams()
  const [photoIndex, setPhotoIndex] = useState(0)
  const listing = useQuery({ queryKey: ['listing', id], queryFn: () => api<ListingDetails>(`/listings/${encodeURIComponent(id)}`), enabled: !!id })
  const record = listing.data
  const photos = record?.photos || []
  const activePhoto = photos[Math.min(photoIndex, photos.length - 1)]
  return <div className="mx-auto max-w-6xl space-y-7 px-4 py-10 sm:px-6 lg:px-8"><Link to="/listings" className="text-sm font-semibold text-indigo-700 hover:underline">← 返回房源搜索</Link><QueryState loading={listing.isPending} error={listing.error} retry={() => { void listing.refetch() }} empty={!record}>
    {record && <><header className="flex flex-wrap items-start justify-between gap-4"><div className="space-y-2"><p className="text-sm font-semibold uppercase tracking-wide text-indigo-700">{labelOf(propertyTypes, record.propertyType)} · {labelOf(roomTypes, record.roomType)}</p><h1 className="text-3xl font-bold text-slate-900">{record.title}</h1><p className="text-slate-600">{record.approximateArea || '区域未提供'}{record.campusName ? ` · ${record.campusName}` : ''}</p></div><FavoriteButton listingId={id} /></header>
      {record.status && record.status !== 'PUBLISHED' && <Notice>此房源目前未公开，只有有权限的用户可以预览。</Notice>}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]"><div className="min-w-0 space-y-8">
        <section aria-label="房源照片" className="space-y-3">{activePhoto?.url ? <img src={activePhoto.url} alt={activePhoto.alt || `${record.title} 照片 ${photoIndex + 1}`} className="aspect-video w-full rounded-2xl bg-slate-100 object-cover" /> : <div className="flex aspect-video items-center justify-center rounded-2xl bg-slate-100 text-slate-500">暂无照片</div>}{photos.length > 1 && <div className="flex gap-2 overflow-x-auto pb-2">{photos.map((photo, index) => <button key={photo.id || index} type="button" className={`shrink-0 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 ${index === photoIndex ? 'ring-2 ring-indigo-600' : ''}`} aria-label={`查看照片 ${index + 1}`} aria-pressed={index === photoIndex} onClick={() => setPhotoIndex(index)}><img src={photo.url} alt="" className="h-16 w-24 rounded-lg object-cover" /></button>)}</div>}</section>
        <section className="space-y-4"><h2 className="text-2xl font-semibold">房源信息</h2><p className="whitespace-pre-wrap leading-7 text-slate-700">{record.description || '房东尚未填写描述。'}</p><dl className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-2"><div><dt className="text-sm text-slate-500">月租</dt><dd className="font-semibold">{money(record.rent, record.currency)}</dd></div><div><dt className="text-sm text-slate-500">押金</dt><dd className="font-semibold">{money(record.deposit, record.currency)}</dd></div><div><dt className="text-sm text-slate-500">可入住日期</dt><dd className="font-semibold">{formatDate(record.availableFrom)}</dd></div><div><dt className="text-sm text-slate-500">家具</dt><dd className="font-semibold">{record.furnished == null ? '未提供' : record.furnished ? '配备家具' : '未配备家具'}</dd></div><div><dt className="text-sm text-slate-500">房东上次确认可租时间</dt><dd className="font-semibold">{formatDate(record.lastConfirmedAt)}</dd></div><div><dt className="text-sm text-slate-500">距离校区</dt><dd className="font-semibold">{typeof record.distanceKm === 'number' ? `约 ${record.distanceKm.toFixed(1)} 公里（直线距离）` : '未提供'}</dd></div></dl>{record.amenities?.length ? <div><h3 className="mb-2 font-semibold">设施</h3><ul className="flex flex-wrap gap-2">{record.amenities.map(amenity => <li key={amenity} className="rounded-full bg-indigo-50 px-3 py-1 text-sm text-indigo-800">{amenity}</li>)}</ul></div> : null}{record.houseRules && <div><h3 className="mb-2 font-semibold">入住规则</h3><p className="whitespace-pre-wrap text-slate-700">{record.houseRules}</p></div>}</section>
        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5"><h2 className="text-xl font-semibold">大致位置</h2><p className="mt-2 text-slate-700">{record.approximateArea || '房东尚未提供区域信息。'}</p><p className="mt-2 text-sm text-slate-500">为保护住户隐私，公开页面只显示大致区域。具体地点请在双方同意后确认。</p></section>
        <Reviews listingId={id} /><ReportListing listingId={id} />
      </div><aside className="space-y-5 lg:sticky lg:top-6 lg:self-start"><div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-3xl font-bold text-indigo-800">{money(record.rent, record.currency)}<span className="text-sm font-normal text-slate-500"> / 月</span></p><p className="mt-2 text-sm text-slate-600">房东：{record.owner?.name || '房东'}</p>{record.reviewCount != null && <p className="mt-2 text-sm text-slate-600">{record.reviewCount} 条已审核评价{record.rating != null ? ` · ${Number(record.rating).toFixed(1)} / 5` : ''}</p>}<p className="mt-3 text-xs text-slate-500">可租状态由房东提供，可能发生变化。</p></div><Inquiry listingId={id} ownerId={record.ownerId || record.owner?.id} /></aside></div>
    </>}
  </QueryState></div>
}
