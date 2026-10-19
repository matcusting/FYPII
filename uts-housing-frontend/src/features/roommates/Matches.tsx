import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api, itemsOf, messageOf } from '../../lib/api'
import { matchOf, type Match } from './model'
import { buttonClass, inputClass, Notice, RoommateShell, secondaryButtonClass, StudentGate } from './ui'

function scoreLabel(score?: number) {
  return score === undefined ? '匹配资料不足' : `${score}% 匹配`
}

function MatchDetails({ match }: { match: Match }) {
  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-xl font-semibold">{match.displayName}</h2>{match.university && <p className="text-sm text-slate-600">{match.university}</p>}</div>
      <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-900">{scoreLabel(match.score)}</span>
    </div>
    {match.bio && <p className="whitespace-pre-wrap text-sm text-slate-700">{match.bio}</p>}
    <dl className="grid gap-2 text-sm sm:grid-cols-2">
      {match.preferredLocation && <div><dt className="font-semibold">意向区域</dt><dd>{match.preferredLocation}</dd></div>}
      {(match.budgetMin !== undefined || match.budgetMax !== undefined) && <div><dt className="font-semibold">月预算</dt><dd>{match.budgetMin ?? '—'}–{match.budgetMax ?? '—'} MYR</dd></div>}
      {match.moveInDate && <div><dt className="font-semibold">计划入住</dt><dd>{match.moveInDate.slice(0, 10)}</dd></div>}
    </dl>
    {match.factors.length > 0 && <div><h3 className="text-sm font-semibold">匹配依据</h3><ul className="mt-2 flex flex-wrap gap-2">{match.factors.map((factor, index) => <li key={`${factor}-${index}`} className="rounded-lg bg-emerald-50 px-3 py-1 text-sm text-emerald-900">{factor}</li>)}</ul></div>}
    {match.explanation && <p className="text-sm text-slate-600">{match.explanation}</p>}
    {match.score === undefined && <p className="text-sm text-slate-600">共同填写的维度不足，服务器未提供百分比。你可以补充资料和偏好。</p>}
    <p className="text-xs text-slate-500">兼容度是生活习惯的参考，不能保证实际合租体验。联系资料需要双方同意后才应公开。</p>
  </div>
}

function CandidateActions({ match }: { match: Match }) {
  const queryClient = useQueryClient()
  const [sent, setSent] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportReason, setReportReason] = useState('')
  const [reportSent, setReportSent] = useState(false)
  const request = useMutation({
    mutationFn: () => api<unknown>('/roommates/requests', { method: 'POST', body: JSON.stringify({ recipientId: match.id }) }),
    onSuccess: () => { setSent(true); void queryClient.invalidateQueries({ queryKey: ['roommates', 'matches'] }) },
  })
  const block = useMutation({
    mutationFn: () => api<unknown>('/roommates/blocks', { method: 'POST', body: JSON.stringify({ blockedUserId: match.id }) }),
    onSuccess: () => { setBlocked(true); void queryClient.invalidateQueries({ queryKey: ['roommates', 'matches'] }) },
  })
  const report = useMutation({
    mutationFn: () => api<unknown>('/reports', { method: 'POST', body: JSON.stringify({ targetType: 'USER', targetId: match.id, reason: reportReason.trim() }) }),
    onSuccess: () => { setReportSent(true); setReportOpen(false); setReportReason('') },
  })
  const submitReport = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (reportReason.trim().length >= 10) report.mutate()
  }
  if (blocked) return <Notice tone="success">已屏蔽此用户，后续匹配应由服务器排除。</Notice>
  return <div className="space-y-3 border-t border-slate-200 pt-4">
    <div className="flex flex-wrap gap-2">
      <button type="button" className={buttonClass} onClick={() => request.mutate()} disabled={request.isPending || sent || !!match.requestStatus}>{request.isPending ? '正在发送…' : sent ? '请求已发送' : match.requestStatus ? `请求状态：${match.requestStatus}` : '发送连接请求'}</button>
      <button type="button" className={secondaryButtonClass} onClick={() => setReportOpen(open => !open)} aria-expanded={reportOpen} aria-controls={`report-${match.id}`}>举报</button>
      <button type="button" className={secondaryButtonClass} onClick={() => { if (window.confirm(`确定屏蔽 ${match.displayName}？`)) block.mutate() }} disabled={block.isPending}>屏蔽</button>
    </div>
    {request.isError && <Notice tone="error">连接请求未发送：{messageOf(request.error)}</Notice>}
    {block.isError && <Notice tone="error">屏蔽失败：{messageOf(block.error)}</Notice>}
    {reportSent && <Notice tone="success">举报已提交，等待审核。</Notice>}
    {reportOpen && <form id={`report-${match.id}`} onSubmit={submitReport} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <label className="block text-sm font-medium" htmlFor={`report-reason-${match.id}`}>举报原因</label>
      <textarea id={`report-reason-${match.id}`} className={inputClass} rows={3} minLength={10} maxLength={1000} required value={reportReason} onChange={event => setReportReason(event.currentTarget.value)} placeholder="请具体描述骚扰、泄露个人信息、虚假内容或其他问题。" />
      <p className="mt-1 text-xs text-slate-600">至少 10 个字符。请勿在举报中填写其他人的敏感信息。</p>
      <button type="submit" className={`${buttonClass} mt-3`} disabled={report.isPending}>{report.isPending ? '正在提交…' : '提交举报'}</button>
      {report.isError && <div className="mt-3"><Notice tone="error">举报未提交：{messageOf(report.error)}</Notice></div>}
    </form>}
  </div>
}

function MatchesContent() {
  const matches = useQuery({
    queryKey: ['roommates', 'matches'],
    queryFn: async () => itemsOf<unknown>(await api<unknown>('/roommates/matches')).map(matchOf).filter((match): match is Match => match !== null),
  })
  return <RoommateShell title="寻找室友" description="服务器根据双方是否认证、是否开启发现、预算、入住时间和生活习惯筛选匹配。">
    <div className="mb-6 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">只会显示已认证且同意被发现的候选人。匹配分数和理由来自服务器；资料不足时不显示百分比。<Link to="/roommates/profile" className="ml-1 font-semibold underline underline-offset-2">编辑我的偏好</Link></div>
    {matches.isPending ? <p role="status">正在获取匹配结果…</p> : matches.isError ? <div className="space-y-4"><Notice tone="error">无法获取匹配结果：{messageOf(matches.error)}</Notice><button className={secondaryButtonClass} type="button" onClick={() => void matches.refetch()}>重试</button></div> : matches.data.length === 0 ? <div className="rounded-xl border border-slate-200 bg-white p-8 text-center"><h2 className="text-lg font-semibold">暂无符合条件的室友</h2><p className="mt-2 text-sm text-slate-600">可以完善生活习惯、预算和入住时间；也可能暂时没有同意参与匹配的学生。</p><Link to="/roommates/profile" className={`${buttonClass} mt-5`}>完善我的资料</Link></div> : <div className="grid gap-5 lg:grid-cols-2">{matches.data.map(match => <article key={match.id} className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><MatchDetails match={match} /><div><Link to={`/roommates/${encodeURIComponent(match.id)}`} className="text-sm font-semibold text-emerald-800 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-emerald-700">查看公开资料</Link></div><CandidateActions match={match} /></article>)}</div>}
  </RoommateShell>
}

function DetailContent() {
  const { id } = useParams<{ id: string }>()
  const detail = useQuery({ queryKey: ['roommates', 'detail', id], queryFn: async () => matchOf(await api<unknown>(`/roommates/${encodeURIComponent(id!)}`)), enabled: !!id })
  return <RoommateShell title="室友公开资料" description="这里只展示该学生同意公开的资料。联系信息应在双方同意后提供。">
    <Link to="/roommates" className="mb-5 inline-block text-sm font-semibold text-emerald-800 underline underline-offset-2">← 返回匹配列表</Link>
    {!id ? <Notice tone="error">无效的室友资料链接。</Notice> : detail.isPending ? <p role="status">正在读取公开资料…</p> : detail.isError ? <div className="space-y-4"><Notice tone="error">无法读取公开资料：{messageOf(detail.error)}</Notice><button className={secondaryButtonClass} type="button" onClick={() => void detail.refetch()}>重试</button></div> : !detail.data ? <Notice tone="error">找不到这位室友的公开资料。</Notice> : <article className="max-w-3xl space-y-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><MatchDetails match={detail.data} /><CandidateActions match={detail.data} /></article>}
  </RoommateShell>
}

export function RoommatesPage() {
  return <StudentGate verified><MatchesContent /></StudentGate>
}

export function RoommateDetailPage() {
  return <StudentGate verified><DetailContent /></StudentGate>
}
