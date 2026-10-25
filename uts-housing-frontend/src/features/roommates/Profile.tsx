import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, messageOf } from '../../lib/api'
import { EnglishDateInput, isIsoDate } from '../../components/EnglishDateInput'
import { useI18n } from '../../lib/i18n'
import { blankProfile, lifestyleFields, profileOf, profilePayload, type LifestyleKey, type PrivacyField, type RoommateProfile } from './model'
import { buttonClass, inputClass, Notice, RoommateShell, secondaryButtonClass, StudentGate } from './ui'

const privacyFields: Array<{ key: PrivacyField; label: string }> = [
  { key: 'bio', label: 'Bio' },
  { key: 'preferredLocation', label: 'Preferred location' },
  { key: 'budget', label: 'Budget range' },
  { key: 'moveInDate', label: 'Move-in date' },
  { key: 'lifestyle', label: 'Lifestyle answers' },
]

function validate(profile: RoommateProfile): string | null {
  if (profile.discoverable && !profile.displayName.trim()) return 'Enter a public display name before enabling discovery.'
  if (profile.displayName.length > 80) return 'Display name must be 80 characters or fewer.'
  if (profile.bio.length > 1000) return 'Bio must be 1,000 characters or fewer.'
  if (profile.moveInDate && !isIsoDate(profile.moveInDate)) return 'Enter a valid preferred move-in date as YYYY-MM-DD.'
  for (const value of [profile.budgetMin, profile.budgetMax]) {
    if (value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0)) return 'Enter a valid, non-negative budget.'
  }
  if (profile.budgetMin !== '' && profile.budgetMax !== '' && Number(profile.budgetMin) > Number(profile.budgetMax)) return 'Minimum budget cannot exceed maximum budget.'
  return null
}

function LifestyleQuestions({ title, description, value, onChange, weights, onWeightChange }: {
  title: string
  description: string
  value: RoommateProfile['lifestyle']
  onChange: (key: LifestyleKey, answer: string) => void
  weights?: RoommateProfile['importanceWeights']
  onWeightChange?: (key: LifestyleKey, weight: number) => void
}) {
  const { t } = useI18n()
  return <fieldset className="border-b border-gray-100 pb-8">
    <legend className="text-[1.1rem] font-bold text-[#1f2937]">{t(title)}</legend>
    <p className="mb-6 mt-1 text-sm text-gray-600">{t(description)}</p>
    <div className="space-y-7">
      {lifestyleFields.map(({ key, label, options }) => <div key={key}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p id={`${title.replaceAll(' ', '-')}-${key}`} className="text-[15px] font-bold text-[#374151]">{t(label)}</p>
          {weights && onWeightChange && <label className="flex items-center gap-2 text-xs text-gray-600" htmlFor={`weight-${key}`}>
            {t('Importance')}
            <select id={`weight-${key}`} className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm text-[#374151] focus:border-[#203569] focus-visible:outline-2 focus-visible:outline-[#203569]" value={weights[key]} onChange={event => onWeightChange(key, Number(event.currentTarget.value))}>
              {[1, 2, 3, 4, 5].map(weight => <option key={weight} value={weight}>{weight}{weight === 1 ? ` ${t('(Low)')}` : weight === 5 ? ` ${t('(Very high)')}` : ''}</option>)}
            </select>
          </label>}
        </div>
        <div role="group" aria-labelledby={`${title.replaceAll(' ', '-')}-${key}`} className="flex flex-wrap gap-3">
          {options.map(([optionValue, optionLabel]) => <button key={optionValue} type="button" aria-pressed={value[key] === optionValue} onClick={() => onChange(key, optionValue)}
            className={value[key] === optionValue
              ? 'rounded-full border-2 border-[#86efac] bg-[#e2f5e9] px-5 py-2 text-sm font-bold text-[#168a48] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15803d]'
              : 'rounded-full border border-gray-200 bg-white px-5 py-2 text-sm font-medium text-gray-600 hover:border-gray-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#203569]'}>
            {t(optionLabel)}
          </button>)}
        </div>
      </div>)}
    </div>
  </fieldset>
}

function ProfileEditor({ initial }: { initial: RoommateProfile }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [form, setForm] = useState(initial)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [confirmingRemoval, setConfirmingRemoval] = useState(false)
  const save = useMutation({
    mutationFn: (value: RoommateProfile) => api<unknown>('/roommates/profile', { method: 'PATCH', body: JSON.stringify(profilePayload(value)) }),
    onSuccess: (_data, variables) => {
      setForm(variables)
      setSuccess(variables.discoverable ? 'Profile saved. Roommate discovery is on.' : 'Profile saved. Roommate discovery is paused.')
      void queryClient.invalidateQueries({ queryKey: ['roommates'] })
    },
  })
  const remove = useMutation({
    mutationFn: () => api<unknown>('/roommates/profile', { method: 'DELETE' }),
    onSuccess: () => {
      setForm(blankProfile())
      setSuccess('Roommate profile removed.')
      void queryClient.invalidateQueries({ queryKey: ['roommates'] })
    },
  })

  const update = (key: keyof RoommateProfile, value: string | boolean) => setForm(previous => ({ ...previous, [key]: value }))
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSuccess(null)
    const issue = validate(form)
    setValidationError(issue)
    if (!issue) save.mutate(form)
  }

  return <form onSubmit={submit} noValidate className="space-y-8">
    <section className="border-b border-gray-100 pb-8">
      <h2 className="text-[1.1rem] font-bold text-[#1f2937]">{t('Basic Information')}</h2>
      <p className="mb-5 mt-1 text-sm text-gray-600">{t('Once discovery is on, verified students can see only the details you choose to share.')}</p>
      <div className="grid gap-5 sm:grid-cols-2">
        <div><label className="block text-sm font-medium" htmlFor="roommate-display-name">{t('Display Name')}</label><input id="roommate-display-name" className={inputClass} maxLength={80} value={form.displayName} onChange={event => update('displayName', event.currentTarget.value)} autoComplete="nickname" /></div>
        <div><label className="block text-sm font-medium" htmlFor="roommate-location">{t('Preferred Location')}</label><input id="roommate-location" className={inputClass} maxLength={120} value={form.preferredLocation} onChange={event => update('preferredLocation', event.currentTarget.value)} placeholder={t('e.g. near campus')} /><p className="mt-1 text-xs text-gray-600">{t('Use a general area rather than sharing your exact address.')}</p></div>
        <div><label className="block text-sm font-medium" htmlFor="roommate-move-in">{t('Preferred Move-in Date')}</label><EnglishDateInput id="roommate-move-in" className={inputClass} value={form.moveInDate} onValueChange={value => update('moveInDate', value)} /></div>
        <div><label className="block text-sm font-medium" htmlFor="roommate-budget-min">{t('Minimum Monthly Budget (MYR)')}</label><input id="roommate-budget-min" type="number" min="0" step="1" inputMode="numeric" className={inputClass} value={form.budgetMin} onChange={event => update('budgetMin', event.currentTarget.value)} /></div>
        <div><label className="block text-sm font-medium" htmlFor="roommate-budget-max">{t('Maximum Monthly Budget (MYR)')}</label><input id="roommate-budget-max" type="number" min="0" step="1" inputMode="numeric" className={inputClass} value={form.budgetMax} onChange={event => update('budgetMax', event.currentTarget.value)} /></div>
      </div>
      <div className="mt-5"><label className="block text-sm font-medium" htmlFor="roommate-bio">{t('Short Bio')}</label><textarea id="roommate-bio" className={inputClass} rows={4} maxLength={1000} value={form.bio} onChange={event => update('bio', event.currentTarget.value)} placeholder={t('Share your habits and what makes a good housemate for you. Do not include your phone number or exact address.')} /><p className="mt-1 text-right text-xs text-gray-600">{form.bio.length}/1000</p></div>
    </section>

    <LifestyleQuestions title="My Lifestyle Habits" description="Unanswered questions will not appear as completed information." value={form.lifestyle} onChange={(key, answer) => setForm(previous => ({ ...previous, lifestyle: { ...previous.lifestyle, [key]: answer } }))} />
    <LifestyleQuestions title="Preferred Roommate Habits" description="Choose your preferences and how much each matters to help find a compatible roommate." value={form.roommatePreferences} weights={form.importanceWeights} onChange={(key, answer) => setForm(previous => ({ ...previous, roommatePreferences: { ...previous.roommatePreferences, [key]: answer } }))} onWeightChange={(key, weight) => setForm(previous => ({ ...previous, importanceWeights: { ...previous.importanceWeights, [key]: weight } }))} />

    <fieldset className="border-b border-gray-100 pb-8">
      <legend className="text-[1.1rem] font-bold text-[#1f2937]">{t('Dealbreakers')}</legend>
      <p className="mb-4 mt-1 text-sm text-gray-600">{t('Only students who meet these conditions will appear in your matches.')}</p>
      <div className="space-y-3">
        <label className="flex items-start gap-3"><input type="checkbox" checked={form.smokeFreeOnly} onChange={event => update('smokeFreeOnly', event.currentTarget.checked)} className="mt-1 accent-emerald-700" /><span>{t('Only match with non-smokers')}</span></label>
        <label className="flex items-start gap-3"><input type="checkbox" checked={form.petFreeOnly} onChange={event => update('petFreeOnly', event.currentTarget.checked)} className="mt-1 accent-emerald-700" /><span>{t('Only match with students who have no pets')}</span></label>
      </div>
    </fieldset>

    <fieldset className="border-b border-gray-100 pb-8">
      <legend className="text-[1.1rem] font-bold text-[#1f2937]">{t('Privacy & Discovery')}</legend>
      <p className="mb-4 mt-1 text-sm text-gray-600">{t('Optional details are private by default. When discovery is on, only the details checked below are shown to matches.')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {privacyFields.map(({ key, label }) => <label key={key} className="flex items-start gap-3"><input type="checkbox" className="mt-1 accent-emerald-700" checked={form.visibility[key]} onChange={event => setForm(previous => ({ ...previous, visibility: { ...previous.visibility, [key]: event.currentTarget.checked } }))} /><span>{t('Show {field} to matches', { field: t(label).toLowerCase() })}</span></label>)}
      </div>
      <label className="mt-6 flex items-start gap-3 border-t border-gray-100 pt-5 font-medium"><input type="checkbox" className="mt-1 accent-[#15803d]" checked={form.discoverable} onChange={event => update('discoverable', event.currentTarget.checked)} /><span>{t('Enable discovery so other verified students can see my matching profile')}</span></label>
    </fieldset>

    {validationError && <Notice tone="error">{t(validationError)}</Notice>}
    {save.isError && <Notice tone="error">{t('Could not save your profile:')} {t(messageOf(save.error))}</Notice>}
    {remove.isError && <Notice tone="error">{t('Could not remove your profile:')} {t(messageOf(remove.error))}</Notice>}
    {success && <Notice tone="success">{t(success)}</Notice>}
    <div className="flex flex-wrap items-center gap-3">
      <button className={buttonClass} type="submit" disabled={save.isPending || remove.isPending}>{save.isPending ? t('Saving…') : t('Save Roommate Profile')}</button>
      {form.discoverable && <button className={secondaryButtonClass} type="button" disabled={save.isPending || remove.isPending} onClick={() => {
        const paused = { ...form, discoverable: false }
        setValidationError(null)
        setSuccess(null)
        save.mutate(paused)
      }}>{t('Pause Discovery')}</button>}
      <Link className={secondaryButtonClass} to="/roommates">{t('View Matches')}</Link>
    </div>
    <details className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
      <summary className="cursor-pointer font-medium text-red-800">{t('Remove Roommate Profile')}</summary>
      <p className="my-3 text-gray-600">{t('This deletes your roommate profile and discovery settings. Your account profile is managed separately.')}</p>
      <button type="button" className="rounded-lg border border-red-300 px-4 py-2 font-semibold text-red-800 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-red-700 disabled:opacity-50" disabled={remove.isPending || save.isPending} aria-expanded={confirmingRemoval} onClick={() => setConfirmingRemoval(value => !value)}>{confirmingRemoval ? t('Hide Confirmation') : t('Continue to Remove Profile')}</button>
      {confirmingRemoval && <div role="group" aria-label={t('Confirm profile removal')} className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="font-medium text-red-900" role="status">{t('Are you sure you want to remove your roommate profile and discovery settings?')}</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <button type="button" className="rounded-lg bg-red-700 px-4 py-2 font-semibold text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-red-700 disabled:opacity-50" disabled={remove.isPending || save.isPending} onClick={() => { setConfirmingRemoval(false); remove.mutate() }}>{t('Yes, Remove Profile')}</button>
          <button type="button" className={secondaryButtonClass} onClick={() => setConfirmingRemoval(false)}>{t('Cancel')}</button>
        </div>
      </div>}
    </details>
  </form>
}

function BlockedStudents() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const blocks = useQuery({ queryKey: ['roommates', 'blocks', page], queryFn: () => api<{ items: Array<{ userId: string; displayName: string; blockedAt: string }>; pages: number }>(`/roommates/blocks?page=${page}&limit=20`) })
  const unblock = useMutation({
    mutationFn: (id: string) => api(`/roommates/blocks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['roommates', 'blocks'] }), queryClient.invalidateQueries({ queryKey: ['roommates', 'matches'] })]) },
  })
  return <section className="mt-6 rounded-xl border border-gray-100 bg-white p-5 shadow-[0_2px_10px_rgba(0,0,0,0.04)] sm:p-6" aria-labelledby="blocked-students-heading">
    <h2 id="blocked-students-heading" className="text-lg font-bold text-[#1f2937]">{t('Blocked Students')}</h2>
    <p className="mt-1 text-sm text-gray-600">{t('Blocked students cannot see you in matching or send you messages. Unblocking may make profiles visible again when discovery is on.')}</p>
    {blocks.isPending ? <p role="status" className="mt-4 text-sm text-gray-600">{t('Loading blocked students…')}</p> : blocks.isError ? <div className="mt-4"><Notice tone="error">{t('Could not load blocked students:')} {t(messageOf(blocks.error))}</Notice><button type="button" className={secondaryButtonClass + ' mt-3'} onClick={() => void blocks.refetch()}>{t('Retry')}</button></div> : blocks.data?.items.length ? <ul className="mt-4 divide-y divide-gray-100">{blocks.data.items.map(item => <li key={item.userId} className="flex flex-wrap items-center justify-between gap-3 py-3"><span className="font-medium text-[#1f2937]">{item.displayName || t('Student')}</span><button type="button" className={secondaryButtonClass} disabled={unblock.isPending} onClick={() => unblock.mutate(item.userId)}>{t('Unblock')}</button></li>)}</ul> : <p className="mt-4 text-sm text-gray-500">{t('You have not blocked any students.')}</p>}
    {!!blocks.data?.pages && blocks.data.pages > 1 && <nav className="mt-4 flex items-center justify-end gap-3 text-sm" aria-label={t('Blocked students pages')}><button type="button" className={secondaryButtonClass} disabled={page <= 1} onClick={() => setPage(value => value - 1)}>{t('Previous')}</button><span>{t('Page {page} of {pages}', { page, pages: blocks.data.pages })}</span><button type="button" className={secondaryButtonClass} disabled={page >= blocks.data.pages} onClick={() => setPage(value => value + 1)}>{t('Next')}</button></nav>}
    {unblock.isError && <div className="mt-3"><Notice tone="error">{t('Could not unblock this student:')} {t(messageOf(unblock.error))}</Notice></div>}
  </section>
}

function ProfileContent() {
  const { t } = useI18n()
  const profile = useQuery({ queryKey: ['roommates', 'profile'], queryFn: () => api<unknown>('/roommates/profile').then(profileOf) })
  return <RoommateShell title="My Lifestyle Profile" description="Set your lifestyle and roommate preferences, and decide whether to join matching.">
    {profile.isPending ? <p role="status">{t('Loading your roommate profile…')}</p> : profile.isError ? <div className="space-y-4"><Notice tone="error">{t('Could not load your roommate profile:')} {t(messageOf(profile.error))}</Notice><button type="button" className={secondaryButtonClass} onClick={() => void profile.refetch()}>{t('Retry')}</button></div> : <><ProfileEditor initial={profile.data} /><BlockedStudents /></>}
  </RoommateShell>
}

export function RoommateProfilePage() {
  return <StudentGate><ProfileContent /></StudentGate>
}
