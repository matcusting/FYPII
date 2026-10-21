import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api, itemsOf, messageOf } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { matchOf, profileOf, profilePayload, type Match, type RoommateProfile } from './model'
import { buttonClass, inputClass, Notice, originalCardClass, RoommateShell, secondaryButtonClass, StudentGate } from './ui'

const studyOptions = [['EVENING', 'Night Owl (Late)'], ['MORNING', 'Early Bird (Morning)']] as const
const cleanlinessOptions = [['HIGH', 'Strict (Daily)'], ['MODERATE', 'Moderate (Weekly)'], ['RELAXED', 'Relaxed']] as const
const smokingOptions = [['NEVER', 'Non-Smoker'], ['NO_PREFERENCE', 'Smoker Ok']] as const

function ChoiceGroup({ label, value, options, onChange }: {
  label: string
  value: string
  options: ReadonlyArray<readonly [string, string]>
  onChange: (value: string) => void
}) {
  return <fieldset>
    <legend className="mb-3 text-[15px] font-bold text-[#374151]">{label}</legend>
    <div className="flex flex-wrap gap-3">
      {options.map(([optionValue, text]) => <button key={optionValue} type="button" aria-pressed={value === optionValue} onClick={() => onChange(optionValue)}
        className={value === optionValue
          ? 'rounded-full border-2 border-[#86efac] bg-[#e2f5e9] px-5 py-2 text-[14px] font-bold leading-5 text-[#168a48] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15803d]'
          : 'rounded-full border border-gray-200 bg-white px-5 py-2 text-[14px] font-medium leading-5 text-gray-600 transition-colors hover:border-gray-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#203569]'}>
        {text}
      </button>)}
    </div>
  </fieldset>
}

function QuickProfileEditor({ initial, onSaved }: { initial: RoommateProfile; onSaved: () => void }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [study, setStudy] = useState(initial.lifestyle.studySchedule || 'EVENING')
  const [cleanliness, setCleanliness] = useState(initial.lifestyle.cleanliness || 'MODERATE')
  const [smoking, setSmoking] = useState(initial.lifestyle.smoking || 'NEVER')
  const [error, setError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (profile: RoommateProfile) => api<unknown>('/roommates/profile', { method: 'PATCH', body: JSON.stringify(profilePayload(profile)) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['roommates'] })
      onSaved()
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const displayName = initial.displayName.trim() || user?.name?.trim() || ''
    if (!displayName) { setError('Please add your display name in My Lifestyle Profile before finding matches.'); return }
    save.mutate({
      ...initial,
      displayName,
      discoverable: true,
      lifestyle: { ...initial.lifestyle, studySchedule: study, cleanliness, smoking },
    })
  }

  return <form onSubmit={submit}>
    <h2 className="mb-8 border-b border-gray-100 pb-4 text-[1.1rem] font-bold text-[#1f2937]">Select your daily habits</h2>
    <div className="space-y-[29px]">
      <ChoiceGroup label="Study Schedule" value={study} options={studyOptions} onChange={setStudy} />
      <ChoiceGroup label="Cleanliness Standard" value={cleanliness} options={cleanlinessOptions} onChange={setCleanliness} />
      <ChoiceGroup label="Smoking Preference" value={smoking} options={smokingOptions} onChange={setSmoking} />
    </div>
    <div className="mt-9 flex flex-wrap items-center gap-4">
      <button className={buttonClass} type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save Profile & Find Matches'}</button>
      <Link to="/roommates/profile" className="text-sm font-bold text-[#203569] underline-offset-4 hover:underline">More profile & privacy options</Link>
    </div>
    {error && <div className="mt-5"><Notice tone="error">{error}</Notice></div>}
    {save.isError && <div className="mt-5"><Notice tone="error">Could not save your profile: {messageOf(save.error)}</Notice></div>}
  </form>
}

function MatchDetails({ match }: { match: Match }) {
  const initials = match.displayName.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase() || 'ST'
  return <>
    {match.score !== undefined && <span className="absolute -top-3.5 right-4 rounded-full border-[3px] border-white bg-[#fbbf24] px-4 py-1.5 text-[13px] font-bold text-[#78350f] shadow-sm">{match.score}% Match</span>}
    <div className="mb-5 flex items-center gap-4">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#eff6ff] text-xl font-bold text-[#2563eb]">{initials}</div>
      <div><h3 className="text-[1.1rem] font-bold text-gray-900">{match.displayName}</h3>{match.university && <p className="mt-0.5 text-[13px] text-gray-500">{match.university}</p>}</div>
    </div>
    <div className="mb-6 border-t border-gray-100 pt-5">
      <h4 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-gray-400">Shared Habits</h4>
      {match.factors.length > 0 ? <ul className="flex flex-wrap gap-2">{match.factors.map((factor, index) => <li key={factor + index} className="rounded bg-[#e2f5e9] px-2.5 py-1 text-[12px] font-bold text-[#168a48]">{factor}</li>)}</ul>
        : <p className="text-sm text-gray-500">Add more lifestyle answers to see shared habits.</p>}
    </div>
    {match.bio && <p className="mb-4 whitespace-pre-wrap text-sm text-gray-600">{match.bio}</p>}
    {(match.preferredLocation || match.budgetMin !== undefined || match.budgetMax !== undefined || match.moveInDate) && <dl className="mb-5 grid gap-2 text-sm text-gray-600 sm:grid-cols-2">
      {match.preferredLocation && <div><dt className="font-bold text-[#374151]">Preferred area</dt><dd>{match.preferredLocation}</dd></div>}
      {(match.budgetMin !== undefined || match.budgetMax !== undefined) && <div><dt className="font-bold text-[#374151]">Monthly budget</dt><dd>{match.budgetMin ?? '—'}–{match.budgetMax ?? '—'} MYR</dd></div>}
      {match.moveInDate && <div><dt className="font-bold text-[#374151]">Move-in date</dt><dd>{match.moveInDate.slice(0, 10)}</dd></div>}
    </dl>}
    {match.explanation && <p className="mb-4 text-sm text-gray-600">{match.explanation}</p>}
    {match.score === undefined && <p className="mb-4 text-sm text-gray-500">There is not enough shared profile information to show a match percentage.</p>}
  </>
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
  function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (reportReason.trim().length >= 10) report.mutate()
  }
  if (blocked) return <Notice tone="success">This student is blocked and should no longer appear in your matches.</Notice>
  return <div className="space-y-3">
    <button type="button" className={'w-full ' + secondaryButtonClass} onClick={() => request.mutate()} disabled={request.isPending || sent || !!match.requestStatus}>
      {request.isPending ? 'Sending…' : sent ? '✓ Request Sent' : match.requestStatus ? `Request: ${match.requestStatus}` : 'Connect'}
    </button>
    <div className="flex flex-wrap items-center gap-4 text-sm font-semibold text-gray-500">
      <button type="button" onClick={() => setReportOpen(open => !open)} aria-expanded={reportOpen} aria-controls={'report-' + match.id} className="hover:text-[#203569]">Report</button>
      <button type="button" onClick={() => { if (window.confirm('Block ' + match.displayName + '?')) block.mutate() }} disabled={block.isPending} className="hover:text-red-700">Block</button>
    </div>
    {request.isError && <Notice tone="error">Connection request was not sent: {messageOf(request.error)}</Notice>}
    {block.isError && <Notice tone="error">Could not block this student: {messageOf(block.error)}</Notice>}
    {reportSent && <Notice tone="success">Your report has been sent for review.</Notice>}
    {reportOpen && <form id={'report-' + match.id} onSubmit={submitReport} className="rounded-lg border border-gray-200 bg-[#f8f9fa] p-4">
      <label className="block text-sm font-bold" htmlFor={'report-reason-' + match.id}>Reason for report</label>
      <textarea id={'report-reason-' + match.id} className={inputClass} rows={3} minLength={10} maxLength={1000} required value={reportReason} onChange={event => setReportReason(event.currentTarget.value)} />
      <p className="mt-1 text-xs text-gray-500">At least 10 characters. Please do not include another person's sensitive information.</p>
      <button type="submit" className={buttonClass + ' mt-3'} disabled={report.isPending}>{report.isPending ? 'Sending…' : 'Submit report'}</button>
      {report.isError && <div className="mt-3"><Notice tone="error">Report not sent: {messageOf(report.error)}</Notice></div>}
    </form>}
  </div>
}

function MatchesContent() {
  const [showMatches, setShowMatches] = useState(false)
  const profile = useQuery({ queryKey: ['roommates', 'profile'], queryFn: () => api<unknown>('/roommates/profile').then(profileOf) })
  const matches = useQuery({
    queryKey: ['roommates', 'matches'],
    queryFn: async () => itemsOf<unknown>(await api<unknown>('/roommates/matches')).map(matchOf).filter((match): match is Match => match !== null),
    enabled: showMatches,
  })
  return <RoommateShell>
    <section className={originalCardClass}>
      <div className="bg-[#15803d] px-8 py-4 text-white"><h1 className="text-[1.1rem] font-bold tracking-wide">Lifestyle Profile Builder</h1></div>
      <div className="p-8">
        {profile.isPending ? <p role="status">Loading your lifestyle profile…</p>
          : profile.isError ? <div className="space-y-4"><Notice tone="error">Could not load your lifestyle profile: {messageOf(profile.error)}</Notice><button type="button" className={secondaryButtonClass} onClick={() => void profile.refetch()}>Retry</button></div>
            : <QuickProfileEditor initial={profile.data} onSaved={() => setShowMatches(true)} />}
      </div>
    </section>
    {showMatches && <section className={originalCardClass + ' p-8'}>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[1.3rem] font-bold text-[#1f2937]">Top Compatible Roommates</h2>
        <Link to="/roommates/profile" className="text-sm font-bold text-[#203569] underline-offset-4 hover:underline">Edit my profile</Link>
      </div>
      {matches.isPending ? <p role="status">Finding compatible roommates…</p>
        : matches.isError ? <div className="space-y-4"><Notice tone="error">Could not load matches: {messageOf(matches.error)}</Notice><button type="button" className={secondaryButtonClass} onClick={() => void matches.refetch()}>Retry</button></div>
          : matches.data.length === 0 ? <div className="rounded-xl border border-gray-200 p-8 text-center"><h3 className="text-lg font-bold">No matches yet</h3><p className="mt-2 text-sm text-gray-600">Try adding more lifestyle details or check again later.</p></div>
            : <div className="grid gap-8 md:grid-cols-2">{matches.data.map(match => <article key={match.id} className="relative rounded-xl border border-gray-200 bg-white p-6 transition-colors hover:border-[#203569]">
              <MatchDetails match={match} />
              <Link to={'/roommates/' + encodeURIComponent(match.id)} className="mb-5 inline-block text-sm font-bold text-[#203569] underline-offset-4 hover:underline">View public profile</Link>
              <CandidateActions match={match} />
            </article>)}</div>}
      <p className="mt-6 text-xs text-gray-500">Match scores are a guide, not a guarantee of a good living arrangement. Contact details should only be shared with mutual consent.</p>
    </section>}
  </RoommateShell>
}

function DetailContent() {
  const { id } = useParams<{ id: string }>()
  const detail = useQuery({ queryKey: ['roommates', 'detail', id], queryFn: async () => matchOf(await api<unknown>('/roommates/' + encodeURIComponent(id!))), enabled: !!id })
  return <RoommateShell title="Roommate Profile" description="Only information this student agreed to share appears here.">
    <Link to="/roommates" className="mb-5 inline-block text-sm font-bold text-[#203569] underline-offset-4 hover:underline">← Back to matches</Link>
    {!id ? <Notice tone="error">Invalid roommate profile link.</Notice>
      : detail.isPending ? <p role="status">Loading public profile…</p>
        : detail.isError ? <div className="space-y-4"><Notice tone="error">Could not load this profile: {messageOf(detail.error)}</Notice><button type="button" className={secondaryButtonClass} onClick={() => void detail.refetch()}>Retry</button></div>
          : !detail.data ? <Notice tone="error">This roommate profile could not be found.</Notice>
            : <article className="relative max-w-3xl rounded-xl border border-gray-200 bg-white p-6"><MatchDetails match={detail.data} /><CandidateActions match={detail.data} /></article>}
  </RoommateShell>
}

export function RoommatesPage() {
  return <StudentGate verified><MatchesContent /></StudentGate>
}

export function RoommateDetailPage() {
  return <StudentGate verified><DetailContent /></StudentGate>
}
