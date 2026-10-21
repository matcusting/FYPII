import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, itemsOf, messageOf } from '../../lib/api'
import { AdminShell, Notice, QueryState } from './shared'
import { asRecord, dateText, firstText, nestedText, type DataRecord } from './data'

type ModerationKind = 'verifications' | 'listings' | 'reviews' | 'reports' | 'accounts'

const configuration: Record<ModerationKind, {
  title: string
  description: string
  singular: string
  approve: string
  reject: string
  approveLabel: string
  rejectLabel: string
  extraAction?: { value: string; label: string }
  statuses: Array<{ value: string; label: string }>
}> = {
  verifications: {
    title: '学生认证', description: '核实学生身份后批准或拒绝申请，并记录处理原因。', singular: '认证申请',
    approve: 'APPROVED', reject: 'REJECTED', approveLabel: '批准认证', rejectLabel: '拒绝认证',
    statuses: [{ value: 'PENDING', label: '待审核' }, { value: 'APPROVED', label: '已批准' }, { value: 'REJECTED', label: '已拒绝' }],
  },
  listings: {
    title: '房源审核', description: '检查待发布房源的内容、位置与资料，决定是否公开展示。', singular: '房源',
    approve: 'PUBLISHED', reject: 'REJECTED', approveLabel: '批准发布', rejectLabel: '拒绝发布',
    extraAction: { value: 'PAUSED', label: '暂停房源' },
    statuses: [{ value: 'PENDING_REVIEW', label: '待审核' }, { value: 'PUBLISHED', label: '已发布' }, { value: 'REJECTED', label: '已拒绝' }, { value: 'PAUSED', label: '已暂停' }],
  },
  reviews: {
    title: '评价审核', description: '检查评价内容与证据，处理违反规则或涉及隐私的内容。', singular: '评价',
    approve: 'APPROVED', reject: 'REJECTED', approveLabel: '批准评价', rejectLabel: '拒绝评价',
    statuses: [{ value: 'PENDING', label: '待审核' }, { value: 'APPROVED', label: '已批准' }, { value: 'REJECTED', label: '已拒绝' }],
  },
  reports: {
    title: '举报处理', description: '核查举报内容并记录处理结果；需要限制账号时应由服务端执行授权操作。', singular: '举报',
    approve: 'RESOLVED', reject: 'DISMISSED', approveLabel: '标记已处理', rejectLabel: '驳回举报',
    statuses: [{ value: 'OPEN', label: '未处理' }, { value: 'RESOLVED', label: '已处理' }, { value: 'DISMISSED', label: '已驳回' }],
  },
  accounts: {
    title: '账号管理', description: '查看账号状态，并在需要时暂停或恢复账号。所有变更应由服务器记录审计信息。', singular: '账号',
    approve: 'ACTIVE', reject: 'SUSPENDED', approveLabel: '恢复账号', rejectLabel: '暂停账号',
    statuses: [{ value: 'ACTIVE', label: '正常' }, { value: 'SUSPENDED', label: '已暂停' }],
  },
}

const statusLabels: Record<string, string> = {
  PENDING: '待审核', PENDING_REVIEW: '待审核', SUBMITTED: '已提交', OPEN: '未处理',
  APPROVED: '已批准', VERIFIED: '已认证', PUBLISHED: '已发布',
  REJECTED: '已拒绝', RESOLVED: '已处理', DISMISSED: '已驳回',
  PAUSED: '已暂停', ARCHIVED: '已归档',
  ACTIVE: '正常', SUSPENDED: '已暂停',
}

function rowsOf(value: unknown, kind: ModerationKind): DataRecord[] {
  const direct = itemsOf<unknown>(value)
  const named = asRecord(value)?.[kind]
  const source = direct.length ? direct : Array.isArray(named) ? named : direct
  return source.map(asRecord).filter((row): row is DataRecord => row !== null)
}

function pageCount(value: unknown): number | null {
  const record = asRecord(value)
  const pagination = asRecord(record?.pagination)
  const number = Number(record?.pages ?? record?.totalPages ?? pagination?.pages ?? pagination?.totalPages)
  return Number.isInteger(number) && number > 0 ? number : null
}

function rowTitle(row: DataRecord, kind: ModerationKind): string {
  if (kind === 'accounts') return firstText(row, 'name', 'displayName', 'email') || '未提供账号名称'
  if (kind === 'verifications') return nestedText(row, 'student', 'name', 'email') || nestedText(row, 'user', 'name', 'email') || firstText(row, 'studentName', 'name', 'email') || '未提供申请人'
  if (kind === 'listings') return firstText(row, 'title') || '未提供房源标题'
  if (kind === 'reviews') return firstText(row, 'title', 'content', 'comment', 'body') || '未提供评价内容'
  return firstText(row, 'reason', 'description', 'category') || '未提供举报说明'
}

function rowDetail(row: DataRecord, kind: ModerationKind): string {
  if (kind === 'accounts') return firstText(row, 'email') || (Array.isArray(row.roles) ? row.roles.filter((role): role is string => typeof role === 'string').join('、') : '')
  if (kind === 'verifications') return firstText(row, 'university', 'verificationMethod', 'emailDomain') || nestedText(row, 'student', 'email') || nestedText(row, 'user', 'email')
  if (kind === 'listings') return nestedText(row, 'owner', 'name', 'email') || firstText(row, 'approximateArea', 'campusName', 'ownerName')
  if (kind === 'reviews') return nestedText(row, 'listing', 'title') || nestedText(row, 'author', 'name') || firstText(row, 'listingId')
  return nestedText(row, 'reporter', 'name', 'email') || firstText(row, 'targetType', 'targetId')
}

function auditInfo(row: DataRecord) {
  const moderator = nestedText(row, 'moderatedBy', 'name', 'email') || nestedText(row, 'reviewedBy', 'name', 'email') || firstText(row, 'moderatorName', 'reviewerName')
  const when = row.moderatedAt ?? row.reviewedAt ?? row.resolvedAt
  const reason = firstText(row, 'moderationReason', 'decisionReason', 'resolutionNote', 'adminReason')
  if (!moderator && !when && !reason) return null
  return [moderator && `处理人：${moderator}`, when && `处理时间：${dateText(when)}`, reason && `记录：${reason}`].filter(Boolean).join(' · ')
}

function safeDocumentUrl(value: unknown): string | null {
  const source = typeof value === 'string' ? value.trim() : ''
  if (!source) return null
  try {
    const url = new URL(source, window.location.origin)
    return url.protocol === 'https:' || url.origin === window.location.origin ? url.href : null
  } catch {
    return null
  }
}

function ModerationDetails({ kind, row }: { kind: ModerationKind; row: DataRecord }) {
  const details: Array<{ label: string; value: string }> = []
  if (kind === 'accounts') {
    details.push(
      { label: '名称', value: firstText(row, 'name', 'displayName') },
      { label: '邮箱', value: firstText(row, 'email') },
      { label: '角色', value: Array.isArray(row.roles) ? row.roles.filter((role): role is string => typeof role === 'string').join('、') : firstText(row, 'role') },
      { label: '邮箱验证', value: typeof row.emailVerified === 'boolean' ? row.emailVerified ? '已验证' : '未验证' : '' },
    )
  } else if (kind === 'verifications') {
    details.push(
      { label: '申请人', value: nestedText(row, 'student', 'name', 'email') || nestedText(row, 'user', 'name', 'email') || firstText(row, 'name', 'email') },
      { label: '邮箱', value: nestedText(row, 'student', 'email') || nestedText(row, 'user', 'email') || firstText(row, 'email') },
      { label: '大学', value: firstText(row, 'university', 'universityName') },
      { label: '认证方式', value: firstText(row, 'verificationMethod', 'method') },
    )
  } else if (kind === 'listings') {
    details.push(
      { label: '标题', value: firstText(row, 'title') },
      { label: '描述', value: firstText(row, 'description') },
      { label: '月租', value: firstText(row, 'rent', 'monthlyRent') },
      { label: '区域', value: firstText(row, 'approximateArea', 'area', 'campusName') },
      { label: '发布人', value: nestedText(row, 'owner', 'name', 'email') },
    )
  } else if (kind === 'reviews') {
    details.push(
      { label: '评价内容', value: firstText(row, 'content', 'comment', 'body') },
      { label: '评分', value: firstText(row, 'rating') },
      { label: '房源', value: nestedText(row, 'listing', 'title') || firstText(row, 'listingId') },
      { label: '评价人', value: nestedText(row, 'author', 'name', 'email') || nestedText(row, 'user', 'name', 'email') },
    )
  } else {
    details.push(
      { label: '举报原因', value: firstText(row, 'reason', 'category') },
      { label: '说明', value: firstText(row, 'description', 'details') },
      { label: '被举报对象', value: [firstText(row, 'targetType'), firstText(row, 'targetId')].filter(Boolean).join(' · ') },
      { label: '举报人', value: nestedText(row, 'reporter', 'name', 'email') },
    )
  }

  const photoSources = kind === 'listings' && Array.isArray(row.photos) ? row.photos : []
  const photos = photoSources.map(item => safeDocumentUrl(typeof item === 'string' ? item : asRecord(item)?.url)).filter((url): url is string => Boolean(url))
  const proofUrl = kind === 'verifications' ? safeDocumentUrl(row.documentUrl ?? row.proofUrl ?? asRecord(row.document)?.url) : null
  const evidenceUrl = kind === 'reports' ? safeDocumentUrl(row.evidenceUrl) : null

  return (
    <div className="mb-5 rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="font-semibold text-slate-900">审核详情</h3>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        {details.filter(item => item.value).map(item => <div key={item.label} className="min-w-0"><dt className="font-semibold text-slate-700">{item.label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-slate-900">{item.value}</dd></div>)}
      </dl>
      {photos.length > 0 && <div className="mt-4"><p className="text-sm font-semibold text-slate-700">房源照片</p><div className="mt-2 flex flex-wrap gap-2">{photos.map((url, index) => <a key={`${url}-${index}`} href={url} target="_blank" rel="noopener noreferrer" className="block rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#203569]"><img src={url} alt={`房源照片 ${index + 1}`} className="h-24 w-32 rounded-lg border border-slate-200 object-cover" /></a>)}</div></div>}
      {proofUrl && <p className="mt-4 text-sm"><a href={proofUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#203569] underline">查看认证材料（仅限审核用途）</a></p>}
      {evidenceUrl && <p className="mt-4 text-sm"><a href={evidenceUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#203569] underline">查看举报证据</a></p>}
    </div>
  )
}

export function AdminModerationPage({ kind }: { kind: ModerationKind }) {
  const config = configuration[kind]
  const queryClient = useQueryClient()
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [decision, setDecision] = useState(config.approve)
  const [reason, setReason] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [validation, setValidation] = useState<string | null>(null)

  const search = new URLSearchParams({ page: String(page) })
  if (status) search.set('status', status)
  const list = useQuery({
    queryKey: ['admin', kind, page, status],
    queryFn: () => api<unknown>(`/admin/${kind}?${search}`),
  })
  const rows = rowsOf(list.data, kind)
  const pages = pageCount(list.data)
  const detail = useQuery({
    queryKey: ['admin', kind, 'detail', selectedId],
    queryFn: () => api<unknown>(`/admin/${kind}/${encodeURIComponent(selectedId || '')}`),
    enabled: Boolean(selectedId) && kind !== 'accounts',
  })

  const mutation = useMutation({
    mutationFn: ({ id, nextStatus, explanation }: { id: string; nextStatus: string; explanation: string }) =>
      api<unknown>(`/admin/${kind}/${encodeURIComponent(id)}`, {
        method: 'PATCH', body: JSON.stringify({ status: nextStatus, reason: explanation }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', kind] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] }),
      ])
      setNotice(`${config.singular}处理结果已保存。`)
      setSelectedId(null)
      setReason('')
      setValidation(null)
    },
  })

  function openForm(id: string, currentStatus: string) {
    if (selectedId === id) { setSelectedId(null); return }
    setSelectedId(id)
    setDecision(kind === 'accounts' && currentStatus === 'ACTIVE' ? config.reject : kind === 'listings' && currentStatus === 'PUBLISHED' ? 'PAUSED' : config.approve)
    setReason('')
    setValidation(null)
    setNotice(null)
    mutation.reset()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const explanation = reason.trim()
    if ((decision === config.reject || decision === config.extraAction?.value || kind === 'reports') && explanation.length < 3) {
      setValidation('请填写至少 3 个字的处理原因。')
      return
    }
    if (!selectedId) return
    setValidation(null)
    mutation.mutate({ id: selectedId, nextStatus: decision, explanation })
  }

  return (
    <AdminShell title={config.title} description={config.description}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="field min-w-48">
          <label htmlFor={`admin-status-${kind}`}>按状态筛选</label>
          <select id={`admin-status-${kind}`} value={status} onChange={event => { setStatus(event.target.value); setPage(1); setSelectedId(null) }}>
            <option value="">全部状态</option>
            {config.statuses.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>
        <button type="button" className="button button-secondary" onClick={() => { void list.refetch() }} disabled={list.isFetching}>刷新队列</button>
      </div>
      <div className="mb-4"><Notice success={notice} error={validation || (mutation.error ? messageOf(mutation.error) : null)} /></div>
      <QueryState loading={list.isPending} error={list.error ? messageOf(list.error) : null} empty={rows.length === 0} emptyText={`没有符合当前筛选条件的${config.singular}。`} onRetry={() => { void list.refetch() }} />
      {!list.isPending && !list.error && rows.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <caption className="sr-only">{config.title}队列</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-700">
              <tr><th scope="col" className="px-4 py-3">内容</th><th scope="col" className="px-4 py-3">状态</th><th scope="col" className="px-4 py-3">提交时间</th><th scope="col" className="px-4 py-3">审核记录</th><th scope="col" className="px-4 py-3">操作</th></tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const id = firstText(row, 'id')
                const currentStatus = firstText(row, 'status')
                const audit = auditInfo(row)
                return (
                  <FragmentRow key={id || index}>
                    <tr className="border-b border-slate-100 align-top">
                      <td className="max-w-xs px-4 py-4">
                        <strong className="block break-words text-slate-900">{rowTitle(row, kind)}</strong>
                        {rowDetail(row, kind) && <span className="mt-1 block break-words text-slate-600">{rowDetail(row, kind)}</span>}
                        {id && <span className="mt-1 block text-xs text-slate-500">编号：{id}</span>}
                      </td>
                      <td className="px-4 py-4"><span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-800">{statusLabels[currentStatus] || currentStatus || '未提供状态'}</span></td>
                      <td className="whitespace-nowrap px-4 py-4 text-slate-700">{dateText(row.submittedAt ?? row.createdAt)}</td>
                      <td className="max-w-xs px-4 py-4 text-slate-600">{audit || '尚无处理记录'}</td>
                      <td className="px-4 py-4">
                        <button type="button" className="button button-secondary button-small" disabled={!id || mutation.isPending} aria-expanded={selectedId === id} onClick={() => openForm(id, currentStatus)}>{selectedId === id ? '收起' : '处理'}</button>
                      </td>
                    </tr>
                    {id && selectedId === id && (
                      <tr className="border-b border-slate-200 bg-[#f2f5fc]"><td colSpan={5} className="px-4 py-5">
                        {kind === 'accounts' ? <ModerationDetails kind={kind} row={row} /> : <>
                          <QueryState loading={detail.isPending} error={detail.error ? messageOf(detail.error) : null} empty={!asRecord(detail.data)} emptyText="服务器未提供此条记录的详情。" onRetry={() => { void detail.refetch() }} />
                          {asRecord(detail.data) && !detail.error && <ModerationDetails kind={kind} row={asRecord(detail.data)!} />}
                        </>}
                        <form onSubmit={submit} className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] md:items-end">
                          <div className="field">
                            <label htmlFor={`decision-${kind}-${id}`}>处理结果</label>
                            <select id={`decision-${kind}-${id}`} value={decision} onChange={event => { setDecision(event.target.value); setValidation(null) }}>
                              <option value={config.approve}>{config.approveLabel}</option>
                              <option value={config.reject}>{config.rejectLabel}</option>
                              {config.extraAction && <option value={config.extraAction.value}>{config.extraAction.label}</option>}
                            </select>
                          </div>
                          <div className="field">
                            <label htmlFor={`reason-${kind}-${id}`}>处理原因{decision === config.reject || decision === config.extraAction?.value || kind === 'reports' ? '（必填）' : '（可选）'}</label>
                            <textarea id={`reason-${kind}-${id}`} rows={2} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} required={decision === config.reject || decision === config.extraAction?.value || kind === 'reports'} placeholder="记录审核依据，拒绝或暂停时说明原因" />
                          </div>
                          <button type="submit" className="button" disabled={mutation.isPending}>{mutation.isPending ? '保存中…' : '保存结果'}</button>
                        </form>
                      </td></tr>
                    )}
                  </FragmentRow>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {pages !== null && pages > 1 && !list.error && (
        <nav aria-label="审核队列分页" className="mt-5 flex items-center justify-end gap-3">
          <button type="button" className="button button-secondary button-small" disabled={page <= 1 || list.isFetching} onClick={() => { setPage(value => value - 1); setSelectedId(null) }}>上一页</button>
          <span className="text-sm text-slate-700">第 {page} / {pages} 页</span>
          <button type="button" className="button button-secondary button-small" disabled={page >= pages || list.isFetching} onClick={() => { setPage(value => value + 1); setSelectedId(null) }}>下一页</button>
        </nav>
      )}
      <p className="mt-4 text-xs text-slate-500">审核结果与审计记录以服务器保存的数据为准。</p>
    </AdminShell>
  )
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
