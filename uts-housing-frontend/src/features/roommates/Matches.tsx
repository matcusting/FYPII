import { useState, type FormEvent } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api, itemsOf, messageOf } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { lifestyleFields, matchOf, profileOf, profilePayload, type Match, type RoommateProfile } from './model'
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
  const selectedLifestyle = { ...initial.lifestyle, studySchedule: study, cleanliness, smoking }
  const answeredCount = lifestyleFields.filter(({ key }) => selectedLifestyle[key]).length
  const quickChoices = [
    { label: 'Study schedule', value: studyOptions.find(([option]) => option === study)?.[1] || 'Not selected' },
    { label: 'Cleanliness', value: cleanlinessOptions.find(([option]) => option === cleanliness)?.[1] || 'Not selected' },
    { label: 'Smoking preference', value: smokingOptions.find(([option]) => option === smoking)?.[1] || 'Not selected' },
  ]
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

  return <form onSubmit={submit} className="grid gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.9fr)] lg:gap-10">
    <div>
      <div className="mb-8 border-b border-gray-100 pb-5">
        <span className="text-xs font-bold uppercase tracking-[0.16em] text-[#15803d]">Your daily routine</span>
        <h2 className="mt-2 text-xl font-bold text-[#1f2937]">Select your daily habits</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-gray-600">Start with three habits that often shape how comfortable a shared home feels. You can add more details later.</p>
      </div>
      <div className="space-y-8">
        <ChoiceGroup label="Study Schedule" value={study} options={studyOptions} onChange={setStudy} />
        <ChoiceGroup label="Cleanliness Standard" value={cleanliness} options={cleanlinessOptions} onChange={setCleanliness} />
        <ChoiceGroup label="Smoking Preference" value={smoking} options={smokingOptions} onChange={setSmoking} />
      </div>
      <div className="mt-9 flex flex-wrap items-center gap-4">
        <button className={buttonClass} type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save Profile & Find Matches'}</button>
        <Link to="/roommates/profile" className="text-sm font-bold text-[#203569] underline-offset-4 hover:underline">More profile & privacy options</Link>
      </div>
      <p className="mt-4 max-w-xl text-xs leading-5 text-gray-600">Saving turns on roommate discovery. Other verified students can see only the profile details you have chosen to share.</p>
      {error && <div className="mt-5"><Notice tone="error">{error}</Notice></div>}
      {save.isError && <div className="mt-5"><Notice tone="error">Could not save your profile: {messageOf(save.error)}</Notice></div>}
    </div>
    <aside aria-label="Profile snapshot" className="self-start rounded-xl border border-[#d7eddd] bg-[#f6fbf7] p-5 sm:p-6">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#15803d]">Your profile snapshot</p>
      <div className="mt-4 flex items-end justify-between gap-3">
        <h3 className="text-lg font-bold text-[#1f2937]">Lifestyle details</h3>
        <span className="text-sm font-bold text-[#15803d]">{answeredCount} / {lifestyleFields.length}</span>
      </div>
      <div role="progressbar" aria-label="Lifestyle details selected" aria-valuenow={answeredCount} aria-valuemin={0} aria-valuemax={lifestyleFields.length} className="mt-3 h-2.5 overflow-hidden rounded-full bg-[#dceee1]">
        <div className="h-full rounded-full bg-[#15803d] transition-[width]" style={{ width: `${answeredCount / lifestyleFields.length * 100}%` }} />
      </div>
      <p className="mt-3 text-xs leading-5 text-gray-600">Progress includes these quick choices and answers in your full profile. Save to refresh your matches.</p>
      <dl className="mt-6 space-y-3 border-t border-[#d7eddd] pt-5">
        {quickChoices.map(choice => <div key={choice.label} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
          <dt className="text-gray-600">{choice.label}</dt><dd className="font-semibold text-[#1f2937]">{choice.value}</dd>
        </div>)}
      </dl>
      <div className="mt-6 rounded-lg border border-[#d7eddd] bg-white p-4">
        <h4 className="text-sm font-bold text-[#1f2937]">Want a better introduction?</h4>
        <p className="mt-1 text-xs leading-5 text-gray-600">{answeredCount === lifestyleFields.length
          ? 'Your lifestyle answers are complete. Fine-tune roommate preferences, dealbreakers and privacy settings.'
          : 'Fill in your remaining habits, then fine-tune roommate preferences and privacy settings.'}</p>
        <Link to="/roommates/profile" className="mt-3 inline-block text-sm font-bold text-[#203569] underline-offset-4 hover:underline">Complete my profile →</Link>
      </div>
    </aside>
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
  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportReason, setReportReason] = useState('')
  const [reportError, setReportError] = useState('')
  const [reportSent, setReportSent] = useState(false)
  const request = useMutation({
    mutationFn: () => api<unknown>('/roommates/requests', { method: 'POST', body: JSON.stringify({ recipientId: match.id }) }),
    onSuccess: () => { setSent(true); void queryClient.invalidateQueries({ queryKey: ['roommates', 'matches'] }) },
  })
  const block = useMutation({
    mutationFn: () => api<unknown>('/roommates/blocks', { method: 'POST', body: JSON.stringify({ blockedUserId: match.id }) }),
    onSuccess: () => { setBlocked(true); setBlockConfirmOpen(false); void queryClient.invalidateQueries({ queryKey: ['roommates', 'matches'] }) },
  })
  const report = useMutation({
    mutationFn: () => api<unknown>('/reports', { method: 'POST', body: JSON.stringify({ targetType: 'USER', targetId: match.id, reason: reportReason.trim() }) }),
    onSuccess: () => { setReportSent(true); setReportOpen(false); setReportReason('') },
  })
  function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const length = reportReason.trim().length
    if (length < 10 || length > 1000) { setReportError('Describe the issue in 10 to 1,000 characters.'); return }
    setReportError('')
    report.mutate()
  }
  if (blocked) return <Notice tone="success">This student is blocked and should no longer appear in your matches.</Notice>
  return <div className="space-y-3">
    <button type="button" className={'w-full ' + secondaryButtonClass} onClick={() => request.mutate()} disabled={request.isPending || sent || !!match.requestStatus}>
      {request.isPending ? 'Sending…' : sent ? '✓ Request Sent' : match.requestStatus ? `Request: ${match.requestStatus}` : 'Connect'}
    </button>
    <div className="flex flex-wrap items-center gap-4 text-sm font-semibold text-gray-500">
      <button type="button" onClick={() => setReportOpen(open => !open)} aria-expanded={reportOpen} aria-controls={'report-' + match.id} className="hover:text-[#203569]">Report</button>
      <button type="button" onClick={() => setBlockConfirmOpen(open => !open)} aria-expanded={blockConfirmOpen} aria-controls={'block-confirm-' + match.id} disabled={block.isPending} className="hover:text-red-700">Block</button>
    </div>
    {blockConfirmOpen && <div id={'block-confirm-' + match.id} role="group" aria-labelledby={'block-confirm-label-' + match.id} className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm">
      <p id={'block-confirm-label-' + match.id} className="font-semibold text-red-900">Block {match.displayName}?</p>
      <p className="mt-1 text-red-800">This student will no longer appear in your matches.</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" className={secondaryButtonClass} onClick={() => setBlockConfirmOpen(false)} disabled={block.isPending}>Cancel</button>
        <button type="button" className="rounded-lg bg-red-700 px-4 py-2 font-semibold text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:opacity-50" onClick={() => block.mutate()} disabled={block.isPending}>{block.isPending ? 'Blocking…' : 'Confirm Block'}</button>
      </div>
    </div>}
    {request.isError && <Notice tone="error">Connection request was not sent: {messageOf(request.error)}</Notice>}
    {block.isError && <Notice tone="error">Could not block this student: {messageOf(block.error)}</Notice>}
    {reportSent && <Notice tone="success">Your report has been sent for review.</Notice>}
    {reportOpen && <form id={'report-' + match.id} onSubmit={submitReport} noValidate className="rounded-lg border border-gray-200 bg-[#f8f9fa] p-4">
      <label className="block text-sm font-bold" htmlFor={'report-reason-' + match.id}>Reason for report</label>
      <textarea id={'report-reason-' + match.id} className={inputClass} rows={3} minLength={10} maxLength={1000} required value={reportReason} onChange={event => setReportReason(event.currentTarget.value)} />
      <p className="mt-1 text-xs text-gray-500">At least 10 characters. Please do not include another person's sensitive information.</p>
      <button type="submit" className={buttonClass + ' mt-3'} disabled={report.isPending}>{report.isPending ? 'Sending…' : 'Submit report'}</button>
      {reportError && <div className="mt-3"><Notice tone="error">{reportError}</Notice></div>}
      {report.isError && <div className="mt-3"><Notice tone="error">Report not sent: {messageOf(report.error)}</Notice></div>}
    </form>}
  </div>
}

function MatchesContent() {
  const [showMatches, setShowMatches] = useState(false)
  const profile = useQuery({ queryKey: ['roommates', 'profile'], queryFn: () => api<unknown>('/roommates/profile').then(profileOf) })
  const matchesVisible = showMatches || profile.data?.discoverable === true
  const matches = useInfiniteQuery({
    queryKey: ['roommates', 'matches'],
    queryFn: ({ pageParam }) => api<{ items: unknown[]; page?: number; pages?: number }>(`/roommates/matches?page=${pageParam}&limit=20`),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => last.pages && pages.length < last.pages ? pages.length + 1 : undefined,
    enabled: matchesVisible,
  })
  const visibleMatches = matches.data?.pages.flatMap(page => itemsOf<unknown>(page).map(matchOf).filter((match): match is Match => match !== null)) || []
  return <RoommateShell>
    <section className={originalCardClass}>
      <div className="bg-[#15803d] px-8 py-5 text-white">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-green-100">Find your people</p>
        <h1 className="mt-1 text-xl font-bold tracking-wide">Lifestyle Profile Builder</h1>
        <p className="mt-2 text-sm leading-6 text-green-50">A few everyday habits can help you start a better roommate conversation.</p>
      </div>
      <div className="p-8">
        {profile.isPending ? <p role="status">Loading your lifestyle profile…</p>
          : profile.isError ? <div className="space-y-4"><Notice tone="error">Could not load your lifestyle profile: {messageOf(profile.error)}</Notice><button type="button" className={secondaryButtonClass} onClick={() => void profile.refetch()}>Retry</button></div>
            : <QuickProfileEditor initial={profile.data} onSaved={() => setShowMatches(true)} />}
      </div>
    </section>
    {matchesVisible && <section className={originalCardClass + ' p-6 sm:p-8'}>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#15803d]">Your matches</p>
          <h2 className="mt-2 text-[1.3rem] font-bold text-[#1f2937]">Top Compatible Roommates</h2>
          <p className="mt-2 text-sm leading-6 text-gray-600">Explore profiles shared by verified students and decide who you would like to meet.</p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm font-bold">
          {matches.isSuccess && <span className="rounded-full bg-[#e2f5e9] px-3 py-1.5 text-[#168a48]">{visibleMatches.length} {visibleMatches.length === 1 ? 'match' : 'matches'}</span>}
          <button type="button" onClick={() => void matches.refetch()} disabled={matches.isFetching} className="text-[#203569] underline-offset-4 hover:underline disabled:opacity-50">{matches.isFetching ? 'Refreshing…' : 'Refresh matches'}</button>
          <Link to="/roommates/profile" className="text-[#203569] underline-offset-4 hover:underline">Edit my profile</Link>
        </div>
      </div>
      {matches.isPending ? <p role="status">Finding compatible roommates…</p>
        : matches.isError ? <div className="space-y-4"><Notice tone="error">Could not load matches: {messageOf(matches.error)}</Notice><button type="button" className={secondaryButtonClass} onClick={() => void matches.refetch()}>Retry</button></div>
          : visibleMatches.length === 0 ? <div className="rounded-xl border border-gray-200 bg-[#f8f9fa] p-8 text-center"><h3 className="text-lg font-bold">No matches yet</h3><p className="mt-2 text-sm text-gray-600">Add more lifestyle details or check again later when more students join.</p><Link to="/roommates/profile" className="mt-4 inline-block text-sm font-bold text-[#203569] underline-offset-4 hover:underline">Complete my profile →</Link></div>
            : <div className={visibleMatches.length === 1 ? 'grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(270px,0.85fr)]' : 'grid gap-6 md:grid-cols-2'}>
              {visibleMatches.map(match => <article key={match.id} className="relative mt-2 min-w-0 rounded-xl border border-gray-200 bg-white p-6 transition-colors hover:border-[#a7d8b3]">
                <MatchDetails match={match} />
                <Link to={'/roommates/' + encodeURIComponent(match.id)} className="mb-5 inline-block text-sm font-bold text-[#203569] underline-offset-4 hover:underline">View public profile</Link>
                <CandidateActions match={match} />
              </article>)}
              {visibleMatches.length === 1 && <aside aria-label="Matching guide" className="self-start rounded-xl border border-[#d7eddd] bg-[#f6fbf7] p-5 sm:p-6">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#15803d]">After you match</p>
                <h3 className="mt-2 text-lg font-bold text-[#1f2937]">Get to know your potential roommate</h3>
                <ol className="mt-5 space-y-5">
                  <li className="flex gap-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#dceee1] text-xs font-bold text-[#15803d]">1</span><div><p className="text-sm font-bold text-[#1f2937]">Read their shared profile</p><p className="mt-1 text-xs leading-5 text-gray-600">Review the details they chose to make visible.</p></div></li>
                  <li className="flex gap-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#dceee1] text-xs font-bold text-[#15803d]">2</span><div><p className="text-sm font-bold text-[#1f2937]">Send a connection request</p><p className="mt-1 text-xs leading-5 text-gray-600">Wait for a reply before sharing personal contact details.</p></div></li>
                  <li className="flex gap-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#dceee1] text-xs font-bold text-[#15803d]">3</span><div><p className="text-sm font-bold text-[#1f2937]">Talk about daily life</p><p className="mt-1 text-xs leading-5 text-gray-600">Discuss routines, budget and house rules before deciding.</p></div></li>
                </ol>
                <div className="mt-6 border-t border-[#d7eddd] pt-5 text-xs leading-5 text-gray-600">Match scores and shared habits come from the matching service. Use them to start a conversation, not to make a final decision.</div>
                <Link to="/student/messages" className="mt-4 inline-block text-sm font-bold text-[#203569] underline-offset-4 hover:underline">View messages &amp; requests →</Link>
              </aside>}
            </div>}
      {matches.hasNextPage && <div className="mt-6 text-center"><button type="button" className={secondaryButtonClass} disabled={matches.isFetchingNextPage} onClick={() => void matches.fetchNextPage()}>{matches.isFetchingNextPage ? 'Loading…' : 'Show more roommates'}</button></div>}
      {matches.isSuccess && visibleMatches.length > 1 && <p className="mt-6 text-xs text-gray-500">Match scores are a guide, not a guarantee of a good living arrangement. Contact details should only be shared with mutual consent.</p>}
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
