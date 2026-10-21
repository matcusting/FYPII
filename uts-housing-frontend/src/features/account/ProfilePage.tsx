import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, messageOf } from '../../lib/api'
import { hasRole, useAuth } from '../../lib/auth'
import { ErrorNotice, LoadingNotice, Panel } from './shared'
import { inputClass, labelForStatus } from './format'
import { AccountControls } from './AccountControls'

interface AccountProfile {
  displayName?: string | null
  name?: string | null
  university?: string | null
  bio?: string | null
  preferredLocation?: string | null
  budgetMin?: number | string | null
  budgetMax?: number | string | null
  preferredMoveInDate?: string | null
  verificationStatus?: string | null
}

interface ProfileFields {
  displayName: string
  university: string
  bio: string
  preferredLocation: string
  budgetMin: string
  budgetMax: string
  preferredMoveInDate: string
}

function fieldsFrom(profile: AccountProfile | undefined, fallbackName?: string): ProfileFields {
  return {
    displayName: profile?.displayName || profile?.name || fallbackName || '',
    university: profile?.university || '',
    bio: profile?.bio || '',
    preferredLocation: profile?.preferredLocation || '',
    budgetMin: profile?.budgetMin == null ? '' : String(profile.budgetMin),
    budgetMax: profile?.budgetMax == null ? '' : String(profile.budgetMax),
    preferredMoveInDate: profile?.preferredMoveInDate?.slice(0, 10) || '',
  }
}

function normalizedProfile(value: AccountProfile | { profile?: AccountProfile }): AccountProfile {
  return 'profile' in value && value.profile ? value.profile : value as AccountProfile
}

export function ProfilePage() {
  const { user, refresh } = useAuth()
  const queryClient = useQueryClient()
  const isStudent = hasRole(user, 'STUDENT')
  const isLandlord = hasRole(user, 'LANDLORD') && !isStudent && !hasRole(user, 'ADMIN')
  const [edits, setEdits] = useState<Partial<ProfileFields>>({})
  const [formError, setFormError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [verificationMethod, setVerificationMethod] = useState<'EMAIL_DOMAIN' | 'MANUAL'>('EMAIL_DOMAIN')
  const [verificationNote, setVerificationNote] = useState('')
  const [verificationProof, setVerificationProof] = useState<File | null>(null)
  const [verificationMessage, setVerificationMessage] = useState('')

  const profile = useQuery({ queryKey: ['profile'], queryFn: async () => normalizedProfile(await api<AccountProfile>('/profile')), enabled: !!user })
  const fields = { ...fieldsFrom(profile.data, user?.name), ...edits }

  const save = useMutation({
    mutationFn: (values: ProfileFields) => api<AccountProfile>('/profile', {
      method: 'PATCH',
      body: JSON.stringify({
        displayName: values.displayName.trim(),
        university: values.university.trim() || null,
        bio: values.bio.trim() || null,
        preferredLocation: values.preferredLocation.trim() || null,
        budgetMin: values.budgetMin === '' ? null : Number(values.budgetMin),
        budgetMax: values.budgetMax === '' ? null : Number(values.budgetMax),
        preferredMoveInDate: values.preferredMoveInDate || null,
      }),
    }),
    onSuccess: async () => {
      setSaveMessage('资料已保存。')
      await queryClient.invalidateQueries({ queryKey: ['profile'] })
      setEdits({})
      await refresh()
    },
  })

  const verification = useMutation({
    mutationFn: () => {
      if (verificationMethod === 'MANUAL') {
        const body = new FormData()
        body.set('method', 'MANUAL')
        body.set('university', fields.university.trim())
        if (verificationNote.trim()) body.set('note', verificationNote.trim())
        if (verificationProof) body.set('proof', verificationProof)
        return api('/verifications', { method: 'POST', body })
      }
      return api('/verifications', { method: 'POST', body: JSON.stringify({ method: 'EMAIL_DOMAIN', university: fields.university.trim() }) })
    },
    onSuccess: async () => {
      setVerificationMessage('学生认证申请已提交。审核结果会在账户状态中显示。')
      setVerificationNote('')
      setVerificationProof(null)
      await refresh()
    },
  })

  function updateField(name: keyof ProfileFields, value: string) {
    setEdits(previous => ({ ...previous, [name]: value }))
    setFormError('')
    setSaveMessage('')
  }

  function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!fields.displayName.trim()) { setFormError('请输入显示名称。'); return }
    const min = fields.budgetMin === '' ? null : Number(fields.budgetMin)
    const max = fields.budgetMax === '' ? null : Number(fields.budgetMax)
    if ((min !== null && (!Number.isFinite(min) || min < 0)) || (max !== null && (!Number.isFinite(max) || max < 0)) || (min !== null && max !== null && max < min)) {
      setFormError('预算须为非负数，且上限不得低于下限。')
      return
    }
    save.mutate(fields)
  }

  function submitVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setVerificationMessage('')
    if (!fields.university.trim()) { setVerificationMessage('请先填写并保存大学名称，再提交认证。'); return }
    if (fields.university.trim() !== (profile.data?.university || '').trim()) { setVerificationMessage('请先保存修改后的大学名称。'); return }
    if (verificationMethod === 'MANUAL' && !verificationProof) { setVerificationMessage('请先选择学生身份证明文件。'); return }
    verification.mutate()
  }

  const pendingVerification = ['PENDING', 'PENDING_REVIEW', 'SUBMITTED'].includes((user?.verificationStatus || profile.data?.verificationStatus || '').toUpperCase())

  const initials = (user?.name || user?.email || 'UT').split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase()

  return <div className={isLandlord ? 'min-w-0 flex-1 bg-white px-5 py-8 text-[#1f2937] sm:px-8' : 'min-h-screen bg-[#f8f9fa] px-4 pb-20 text-[#1f2937]'}>
    <div className="mx-auto max-w-[800px] space-y-6">
      <section className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <header className="flex items-center justify-between gap-4 bg-[#203569] px-6 py-6 text-white sm:px-8">
          <div><h1 className="text-xl font-bold">{isStudent ? 'Student Profile Settings' : 'Profile Settings'}</h1><p className="mt-1 text-sm text-gray-300">Manage your personal information and housing preferences.</p></div>
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/10 text-xl font-bold" aria-hidden="true">{initials}</span>
        </header>
        {profile.isPending ? <div className="p-8"><LoadingNotice /></div> : profile.isError ? <div className="p-8"><ErrorNotice error={profile.error} onRetry={() => void profile.refetch()} /></div> : <form onSubmit={submitProfile} className="space-y-6 p-6 sm:p-8">
          {saveMessage && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-4 text-center text-sm font-bold text-green-800">✓ Profile updated successfully!</p>}
          <div className="grid gap-6 sm:grid-cols-2">
            <label className="block text-[13px] font-bold text-gray-700">Full Legal Name <span aria-hidden="true">*</span><input className={inputClass} value={fields.displayName} onChange={event => updateField('displayName', event.target.value)} maxLength={100} required autoComplete="name" /></label>
            <label className="block text-[13px] font-bold text-gray-700">University<input className={inputClass} value={fields.university} onChange={event => updateField('university', event.target.value)} maxLength={160} autoComplete="organization" /></label>
            <label className="block text-[13px] font-bold text-gray-700">Preferred Location<input className={inputClass} value={fields.preferredLocation} onChange={event => updateField('preferredLocation', event.target.value)} maxLength={160} placeholder="Near UTS campus" /></label>
            <label className="block text-[13px] font-bold text-gray-700">Preferred Move-in Date<input className={inputClass} type="date" value={fields.preferredMoveInDate} onChange={event => updateField('preferredMoveInDate', event.target.value)} /></label>
            <label className="block text-[13px] font-bold text-gray-700 sm:col-span-2">Account Email<input className={`${inputClass} cursor-not-allowed bg-gray-50 text-gray-500`} value={user?.email || ''} readOnly type="email" /></label>
            <label className="block text-[13px] font-bold text-gray-700 sm:col-span-2">Personal Bio / Roommate Notes<textarea className={inputClass} rows={3} maxLength={1000} value={fields.bio} onChange={event => updateField('bio', event.target.value)} placeholder="Tell others a little about yourself." /></label>
          </div>
          {formError && <p role="alert" className="text-sm text-red-700">{formError}</p>}
          {save.isError && <p role="alert" className="text-sm text-red-700">{messageOf(save.error)}</p>}
          <div className="flex justify-end border-t border-gray-100 pt-4"><button type="submit" disabled={save.isPending} className="min-h-11 rounded-lg bg-[#203569] px-6 py-2 font-bold text-white shadow-sm hover:bg-[#1a2b56] disabled:opacity-60">{save.isPending ? 'Saving…' : 'Save Changes'}</button></div>
        </form>}
      </section>

      <Panel title="Housing Budget">
        <form onSubmit={submitProfile} className="space-y-4">
          <p className="text-sm text-gray-600">Set an optional monthly budget range for your housing search.</p>
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="block text-[13px] font-bold text-gray-700">Monthly Budget From<input className={inputClass} type="number" min="0" step="0.01" inputMode="decimal" value={fields.budgetMin} onChange={event => updateField('budgetMin', event.target.value)} /></label>
            <label className="block text-[13px] font-bold text-gray-700">Monthly Budget To<input className={inputClass} type="number" min="0" step="0.01" inputMode="decimal" value={fields.budgetMax} onChange={event => updateField('budgetMax', event.target.value)} /></label>
          </div>
          {formError && <p role="alert" className="text-sm text-red-700">{formError}</p>}
          {save.isError && <p role="alert" className="text-sm text-red-700">{messageOf(save.error)}</p>}
          {saveMessage && <p role="status" className="text-sm text-green-700">{saveMessage}</p>}
          <button type="submit" disabled={save.isPending || profile.isPending || profile.isError} className="min-h-11 rounded-lg bg-[#203569] px-5 py-2 text-sm font-bold text-white hover:bg-[#1a2b56] disabled:opacity-50">{save.isPending ? 'Saving…' : 'Save Budget'}</button>
        </form>
      </Panel>

      {isStudent && <Panel title="Student Verification">
        <p className="mb-4 text-sm text-gray-600">Current status: <strong>{user?.studentVerified ? 'Verified' : labelForStatus(user?.verificationStatus || profile.data?.verificationStatus || 'UNVERIFIED')}</strong></p>
        {user?.studentVerified ? <p className="text-sm text-green-700">Your student verification is complete.</p> : pendingVerification || verification.isSuccess ? <p className="text-sm text-gray-600">Your application is being reviewed.</p> : <form onSubmit={submitVerification} className="space-y-4 text-sm">
          <p className="text-gray-600">Save your university above before submitting. Approved university email domains are configured by the administrator.</p>
          <fieldset className="space-y-2"><legend className="font-semibold">Verification method</legend>
            <label className="flex items-start gap-2"><input type="radio" name="verification-method" className="mt-1" checked={verificationMethod === 'EMAIL_DOMAIN'} onChange={() => setVerificationMethod('EMAIL_DOMAIN')} /> Use my verified university email</label>
            <label className="flex items-start gap-2"><input type="radio" name="verification-method" className="mt-1" checked={verificationMethod === 'MANUAL'} onChange={() => setVerificationMethod('MANUAL')} /> Request manual review</label>
          </fieldset>
          {verificationMethod === 'MANUAL' && <div className="space-y-3">
            <label className="block font-semibold">Proof of student status
              <input className={inputClass} type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" onChange={event => {
                const file = event.target.files?.[0] || null
                setVerificationMessage('')
                setVerificationProof(null)
                if (!file) return
                if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type) || file.size > 5 * 1024 * 1024) {
                  setVerificationMessage('请选择不超过 5 MB 的 PDF、JPG 或 PNG 文件。')
                  event.target.value = ''
                  return
                }
                setVerificationProof(file)
              }} />
            </label>
            <p className="text-xs text-gray-600">PDF, JPG or PNG, up to 5 MB. Cover unrelated personal details before uploading.</p>
            <label className="block font-semibold">Note (optional)
              <textarea className={inputClass} rows={3} maxLength={500} value={verificationNote} onChange={event => setVerificationNote(event.target.value)} placeholder="Explain why you need manual review. Do not include ID numbers." />
            </label>
          </div>}
          {user?.emailVerified === false && <p className="text-amber-800">Please verify your email first.</p>}
          {verificationMessage && <p role="status" className="text-gray-700">{verificationMessage}</p>}
          {verification.isError && <p role="alert" className="text-red-700">{messageOf(verification.error)}</p>}
          <button disabled={verification.isPending || user?.emailVerified === false} type="submit" className="min-h-11 rounded-lg bg-[#203569] px-4 py-2 font-semibold text-white hover:bg-[#172b59] disabled:opacity-60">{verification.isPending ? 'Submitting…' : 'Submit Verification'}</button>
        </form>}
      </Panel>}
      {isStudent && <Panel title="Roommate Profile & Privacy"><p className="mb-4 text-sm text-gray-600">Manage lifestyle habits, matching preferences and visibility.</p><Link className="text-sm font-semibold text-[#203569] underline underline-offset-2" to="/roommates/profile">Manage Roommate Profile →</Link></Panel>}
      <AccountControls />
    </div>
  </div>
}
