import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, messageOf } from '../../lib/api'
import { hasRole, useAuth } from '../../lib/auth'
import { Field, inputClass, Notice, primaryButton, QueryState, secondaryButton } from './components'
import { getList, propertyTypes, roomTypes, statusNames, type Amenity, type Campus, type ListingDetails } from './model'

interface SignedUpload {
  uploadUrl: string
  objectKey: string
  headers?: Record<string, string>
}

async function uploadPhotos(files: File[]): Promise<string[]> {
  const keys: string[] = []
  for (const file of files) {
    const signed = await api<SignedUpload>('/uploads/sign', { method: 'POST', body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size }) })
    if (!signed.uploadUrl || !signed.objectKey) throw new Error('服务器未返回有效的照片上传地址。')
    const response = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type, ...signed.headers }, body: file })
    if (!response.ok) throw new Error(`照片 ${file.name} 上传失败，请重试。`)
    keys.push(signed.objectKey)
  }
  return keys
}

function ListingEditor({ initial, campuses, amenities }: { initial?: ListingDetails; campuses: Campus[]; amenities: Amenity[] }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [files, setFiles] = useState<File[]>([])
  const [removedPhotoIds, setRemovedPhotoIds] = useState<string[]>([])
  const [selectedAmenityIds, setSelectedAmenityIds] = useState<string[]>(initial?.amenityIds || [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState('')
  const photoCount = (initial?.photos || []).filter(photo => !photo.id || !removedPhotoIds.includes(photo.id)).length + files.length
  const maySubmit = hasRole(user, 'LANDLORD', 'ADMIN') || (!!user?.studentVerified && hasRole(user, 'STUDENT'))

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const action = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
    const submitForReview = action?.value === 'review'
    if (submitForReview && !maySubmit) { setError('完成学生认证后才能提交房源审核。'); return }
    if (submitForReview && photoCount < 1) { setError('提交审核前至少上传一张房源照片。'); return }
    const form = new FormData(event.currentTarget)
    const rent = Number(form.get('rent'))
    const deposit = Number(form.get('deposit'))
    if (!Number.isFinite(rent) || rent <= 0 || !Number.isFinite(deposit) || deposit < 0) { setError('请输入有效的月租和押金金额。'); return }
    const payload: Record<string, unknown> = {
      title: String(form.get('title') || '').trim(),
      description: String(form.get('description') || '').trim(),
      campusId: String(form.get('campusId') || ''),
      propertyType: String(form.get('propertyType') || ''),
      roomType: String(form.get('roomType') || ''),
      rent: rent.toFixed(2),
      currency: 'MYR',
      deposit: deposit.toFixed(2),
      availableFrom: String(form.get('availableFrom') || ''),
      approximateArea: String(form.get('approximateArea') || '').trim(),
      houseRules: String(form.get('houseRules') || '').trim(),
      contactMethod: String(form.get('contactMethod') || 'IN_APP'),
      furnished: form.get('furnished') === 'true',
      amenityIds: selectedAmenityIds,
    }
    setSaving(true)
    setError(null)
    try {
      let uploadedKeys: string[] = []
      if (files.length) { setUploadProgress(`正在上传 ${files.length} 张照片…`); uploadedKeys = await uploadPhotos(files) }
      if (initial) {
        if (uploadedKeys.length) payload.newPhotoKeys = uploadedKeys
        if (removedPhotoIds.length) payload.removePhotoIds = removedPhotoIds
      } else if (uploadedKeys.length) payload.photoKeys = uploadedKeys
      setUploadProgress('正在保存房源…')
      const saved = initial
        ? await api<ListingDetails>(`/listings/${encodeURIComponent(initial.id)}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await api<ListingDetails>('/listings', { method: 'POST', body: JSON.stringify(payload) })
      const id = saved?.id || initial?.id
      if (!id) throw new Error('房源已保存，但服务器未返回房源编号。请在我的房源中查看。')
      if (submitForReview) { setUploadProgress('正在提交审核…'); await api(`/listings/${encodeURIComponent(id)}/submit`, { method: 'POST' }) }
      navigate('/my-listings', { state: { listingSaved: true } })
    } catch (failure) { setError(messageOf(failure)) }
    finally { setSaving(false); setUploadProgress('') }
  }

  return <form className="space-y-7" onSubmit={event => { void submit(event) }}>
    <section className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><div><h2 className="text-xl font-semibold">基本资料</h2><p className="mt-1 text-sm text-slate-600">请填写真实信息，准确的价格与入住日期有助于学生筛选。</p></div>
      <Field label="房源标题" required><input className={inputClass} name="title" required minLength={8} maxLength={120} defaultValue={initial?.title || ''} placeholder="例如：靠近校区的单人房" /></Field>
      <Field label="房源描述" required><textarea className={inputClass} name="description" required minLength={30} maxLength={5000} rows={6} defaultValue={initial?.description || ''} placeholder="描述空间、家具、交通及费用包含内容" /></Field>
      <div className="grid gap-5 sm:grid-cols-2"><Field label="房屋类型" required><select className={inputClass} name="propertyType" required defaultValue={initial?.propertyType || ''}><option value="" disabled>请选择</option>{propertyTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="房间类型" required><select className={inputClass} name="roomType" required defaultValue={initial?.roomType || ''}><option value="" disabled>请选择</option>{roomTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field></div>
      <div className="grid gap-5 sm:grid-cols-2"><Field label="月租 (RM)" required><input className={inputClass} name="rent" type="number" min="1" max="9999999" step="0.01" required defaultValue={initial?.rent || ''} /></Field><Field label="押金 (RM)" required><input className={inputClass} name="deposit" type="number" min="0" max="9999999" step="0.01" required defaultValue={initial?.deposit ?? 0} /></Field></div>
      <div className="grid gap-5 sm:grid-cols-2"><Field label="可入住日期" required><input className={inputClass} name="availableFrom" type="date" required defaultValue={initial?.availableFrom?.slice(0, 10) || ''} /></Field><Field label="家具配置"><select className={inputClass} name="furnished" defaultValue={String(initial?.furnished ?? false)}><option value="false">未配备家具</option><option value="true">配备家具</option></select></Field></div>
    </section>
    <section className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><div><h2 className="text-xl font-semibold">位置与设施</h2><p className="mt-1 text-sm text-slate-600">公开页面只显示大致区域，不会展示精确住址。</p></div><Field label="校区" required><select className={inputClass} name="campusId" required defaultValue={initial?.campusId || ''}><option value="" disabled>请选择校区</option>{campuses.map(campus => <option key={campus.id} value={campus.id}>{campus.name}{campus.university ? ` · ${campus.university}` : ''}</option>)}</select></Field><Field label="大致区域" required><input className={inputClass} name="approximateArea" required minLength={3} maxLength={120} defaultValue={initial?.approximateArea || ''} placeholder="例如：Sibu Jaya 一带" /></Field><div><p className="mb-3 text-sm font-medium text-slate-700">设施</p>{amenities.length ? <div className="grid gap-2 sm:grid-cols-2">{amenities.map(amenity => <label key={amenity.id} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 text-sm text-slate-700"><input type="checkbox" className="accent-indigo-700" checked={selectedAmenityIds.includes(amenity.id)} onChange={() => setSelectedAmenityIds(value => value.includes(amenity.id) ? value.filter(id => id !== amenity.id) : [...value, amenity.id])} />{amenity.name}</label>)}</div> : <p className="text-sm text-slate-500">暂无可选设施。可先保存其他资料。</p>}</div><Field label="入住规则"><textarea className={inputClass} name="houseRules" rows={3} maxLength={2000} defaultValue={initial?.houseRules || ''} placeholder="例如：禁烟、访客时段" /></Field><Field label="联系方式"><select className={inputClass} name="contactMethod" defaultValue="IN_APP"><option value="IN_APP">站内询问</option></select></Field></section>
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><div><h2 className="text-xl font-semibold">照片</h2><p className="mt-1 text-sm text-slate-600">提交审核至少需要 1 张照片，最多 8 张。支持 JPEG、PNG 或 WebP，每张不超过 5 MB。</p></div>{initial?.photos?.length ? <div className="grid gap-3 sm:grid-cols-3">{initial.photos.map((photo, index) => <label key={photo.id || index} className="overflow-hidden rounded-xl border border-slate-200"><img src={photo.url} alt={photo.alt || `现有照片 ${index + 1}`} className="h-28 w-full object-cover" /><span className="flex items-center gap-2 p-2 text-xs"><input type="checkbox" disabled={!photo.id} checked={!!photo.id && removedPhotoIds.includes(photo.id)} onChange={() => { if (photo.id) setRemovedPhotoIds(value => value.includes(photo.id!) ? value.filter(id => id !== photo.id) : [...value, photo.id!]) }} />移除此照片</span></label>)}</div> : null}<Field label="上传新照片"><input type="file" className={inputClass} accept="image/jpeg,image/png,image/webp" multiple onChange={event => { const selected = Array.from(event.currentTarget.files || []); const existing = (initial?.photos?.length || 0) - removedPhotoIds.length; if (selected.length + existing > 8) { setError('最多可保留 8 张照片。'); event.currentTarget.value = ''; setFiles([]); return } if (selected.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)) { setError('请选择 5 MB 以内的 JPEG、PNG 或 WebP 照片。'); event.currentTarget.value = ''; setFiles([]); return } setError(null); setFiles(selected) }} /></Field>{files.length > 0 && <p className="text-sm text-slate-600">准备上传：{files.map(file => file.name).join('、')}</p>}</section>
    {initial?.status === 'PUBLISHED' && <Notice>编辑已发布的房源可能需要重新审核。请在保存后检查房源状态。</Notice>}{!maySubmit && <Notice>未认证学生可以保存草稿；完成学生认证后才能提交审核。</Notice>}{error && <Notice tone="error">{error}</Notice>}{saving && <p role="status" className="text-sm text-indigo-700">{uploadProgress}</p>}
    <div className="flex flex-wrap gap-3"><button className={secondaryButton} type="submit" value="draft" disabled={saving}>{saving ? '保存中…' : initial ? '保存修改' : '保存草稿'}</button><button className={primaryButton} type="submit" value="review" disabled={saving || !maySubmit || initial?.status === 'PENDING_REVIEW' || initial?.status === 'PUBLISHED'}>{saving ? '提交中…' : '保存并提交审核'}</button><Link className={secondaryButton} to="/my-listings">取消</Link></div>
  </form>
}

export function ListingFormPage() {
  const { id } = useParams()
  const listing = useQuery({ queryKey: ['listing-edit', id], queryFn: () => api<ListingDetails>(`/listings/${encodeURIComponent(id!)}`), enabled: !!id })
  const campuses = useQuery({ queryKey: ['campuses'], queryFn: () => getList<Campus>('/campuses') })
  const amenities = useQuery({ queryKey: ['amenities'], queryFn: () => getList<Amenity>('/amenities'), retry: false })
  const { user } = useAuth()
  if (!hasRole(user, 'STUDENT', 'LANDLORD', 'ADMIN')) return <div className="mx-auto max-w-4xl px-4 py-12"><Notice tone="error">当前账户没有发布房源的权限。</Notice></div>
  return <div className="mx-auto max-w-4xl space-y-6 px-4 py-10 sm:px-6 lg:px-8"><div><Link to="/my-listings" className="text-sm font-semibold text-indigo-700 hover:underline">← 返回我的房源</Link><h1 className="mt-3 text-3xl font-bold text-slate-900">{id ? '编辑房源' : '新增房源'}</h1>{id && listing.data?.status && <p className="mt-2 text-sm text-slate-600">当前状态：{statusNames[listing.data.status] || listing.data.status}</p>}</div>
    {amenities.isError && <Notice>设施选项暂时不可用。仍可填写其他资料。</Notice>}
    <QueryState loading={(!!id && listing.isPending) || campuses.isPending} error={listing.error || campuses.error} retry={() => { if (listing.isError) void listing.refetch(); if (campuses.isError) void campuses.refetch() }} empty={!!id && !listing.data}><ListingEditor key={`${id || 'new'}-${listing.data?.updatedAt || ''}`} initial={listing.data} campuses={campuses.data?.items || []} amenities={amenities.data?.items || []} /></QueryState>
  </div>
}
