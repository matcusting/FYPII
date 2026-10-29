import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, messageOf } from '../../lib/api'
import { hasRole, useAuth } from '../../lib/auth'
import { useI18n } from '../../lib/i18n'
import { ErrorNotice, LoadingNotice, Panel } from './shared'
import { inputClass, labelForStatus } from './format'
import { AccountControls } from './AccountControls'
import { LandlordVerification } from './LandlordVerification'
import { PreviewDocumentNotice } from '../../components/PreviewDocumentNotice'
import { PhoneVerification } from './PhoneVerification'

interface AccountProfile {
  displayName?: string | null
  name?: string | null
  phone?: string | null
  university?: string | null
  bio?: string | null
  verificationStatus?: string | null
}

interface ProfileFields {
  displayName: string
  phone: string
  university: string
  bio: string
}

function fieldsFrom(profile: AccountProfile | undefined, fallbackName?: string): ProfileFields {
  return {
    displayName: profile?.displayName || profile?.name || fallbackName || '',
    phone: profile?.phone || '',
    university: profile?.university || '',
    bio: profile?.bio || '',
  }
}

function normalizedProfile(value: AccountProfile | { profile?: AccountProfile }): AccountProfile {
  return 'profile' in value && value.profile ? value.profile : value as AccountProfile
}

export function ProfilePage() {
  const { user, refresh } = useAuth()
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const isStudent = hasRole(user, 'STUDENT')
  const isLandlord = hasRole(user, 'LANDLORD') && !isStudent && !hasRole(user, 'ADMIN')
  const [edits, setEdits] = useState<Partial<ProfileFields>>({})
  const [formError, setFormError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [verificationNote, setVerificationNote] = useState('')
  const [studentIdFile, setStudentIdFile] = useState<File | null>(null)
  const [offerLetterFile, setOfferLetterFile] = useState<File | null>(null)
  const [verificationMessage, setVerificationMessage] = useState('')

  const profile = useQuery({ queryKey: ['profile'], queryFn: async () => normalizedProfile(await api<AccountProfile>('/profile')), enabled: !!user, refetchInterval: isStudent ? 30_000 : false })
  const fields = { ...fieldsFrom(profile.data, user?.name), ...edits }

  useEffect(() => {
    if (isStudent && profile.data?.verificationStatus && profile.data.verificationStatus !== user?.verificationStatus) void refresh()
  }, [isStudent, profile.data?.verificationStatus, refresh, user?.verificationStatus])

  const save = useMutation({
    mutationFn: (values: ProfileFields) => api<AccountProfile>('/profile', {
      method: 'PATCH',
      body: JSON.stringify(isLandlord ? {
        displayName: values.displayName.trim(),
        phone: values.phone.trim(),
      } : {
        displayName: values.displayName.trim(),
        university: values.university.trim() || null,
        bio: values.bio.trim() || null,
        ...(isStudent ? { phone: values.phone.trim() || null } : {}),
      }),
    }),
    onSuccess: async () => {
      setSaveMessage('Profile saved.')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['profile'] }),
        queryClient.invalidateQueries({ queryKey: ['phone-verification'] }),
        ...(isLandlord ? [
          queryClient.invalidateQueries({ queryKey: ['landlord-identity'] }),
          queryClient.invalidateQueries({ queryKey: ['property-authorization'] }),
          queryClient.invalidateQueries({ queryKey: ['my-listings'] }),
        ] : []),
      ])
      setEdits({})
      await refresh()
    },
  })

  const verification = useMutation({
    mutationFn: ({ studentId, offerLetter, note }: { studentId: File; offerLetter: File; note: string }) => {
      const body = new FormData()
      body.set('method', 'DOCUMENTS')
      body.set('studentId', studentId)
      body.set('offerLetter', offerLetter)
      if (note) body.set('note', note)
      return api('/verifications', { method: 'POST', body })
    },
    onSuccess: async () => {
      setVerificationMessage('')
      setVerificationNote('')
      setStudentIdFile(null)
      setOfferLetterFile(null)
      await queryClient.invalidateQueries({ queryKey: ['profile'] })
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
    if (fields.displayName.trim().length < 2) { setFormError('Enter at least 2 characters for your name.'); return }
    if (isLandlord || (isStudent && fields.phone.trim())) {
      const phone = fields.phone.trim()
      const compact = phone.replace(/[ ()-]/g, '')
      const international = compact.startsWith('+') ? compact : compact.startsWith('0') ? `+60${compact.slice(1)}` : compact.startsWith('60') ? `+${compact}` : ''
      if (!/^\+?[0-9][0-9 ()-]*$/.test(phone) || !/^\+[1-9]\d{7,14}$/.test(international)) { setFormError('Enter a Malaysian number beginning with 0 or an international number with +country code.'); return }
    }
    save.mutate(fields)
  }

  function chooseDocument(kind: 'studentId' | 'offerLetter', event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] || null
    setVerificationMessage('')
    if (kind === 'studentId') setStudentIdFile(null)
    else setOfferLetterFile(null)
    if (!file) return
    const allowed = kind === 'studentId' ? ['image/jpeg', 'image/png'] : ['application/pdf', 'image/jpeg', 'image/png']
    if (!allowed.includes(file.type) || file.size < 1 || file.size > 5_000_000) {
      setVerificationMessage(kind === 'studentId' ? 'Select a JPG or PNG Student ID photo no larger than 5 MB.' : 'Select a PDF, JPG or PNG offer letter no larger than 5 MB.')
      event.currentTarget.value = ''
      return
    }
    if (kind === 'studentId') setStudentIdFile(file)
    else setOfferLetterFile(file)
  }

  function submitVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setVerificationMessage('')
    if (user?.emailVerified !== true) { setVerificationMessage('Verify your university-issued email before submitting documents.'); return }
    if (!studentIdFile) { setVerificationMessage('Select a Student ID photo.'); return }
    if (!offerLetterFile) { setVerificationMessage('Select an offer letter file or photo.'); return }
    verification.mutate({ studentId: studentIdFile, offerLetter: offerLetterFile, note: verificationNote.trim() })
  }

  const verificationStatus = (profile.data?.verificationStatus || user?.verificationStatus || 'UNVERIFIED').toUpperCase()
  const studentVerified = verificationStatus === 'APPROVED' || (!profile.data?.verificationStatus && user?.studentVerified === true)
  const pendingVerification = ['PENDING', 'PENDING_REVIEW', 'SUBMITTED'].includes(verificationStatus)
  const rejectedVerification = ['REJECTED', 'DECLINED'].includes(verificationStatus)

  const initials = (user?.name || user?.email || 'UT').split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase()

  return <div className={isLandlord ? 'min-w-0 flex-1 bg-white px-5 py-8 text-[#1f2937] sm:px-8' : 'min-h-screen bg-[#f8f9fa] px-4 pb-20 text-[#1f2937]'}>
    <div className="mx-auto max-w-[800px] space-y-6">
      <section className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <header className="flex items-center justify-between gap-4 bg-[#203569] px-6 py-6 text-white sm:px-8">
          <div><h1 className="text-xl font-bold">{isStudent ? t('Student Profile Settings') : t('Profile Settings')}</h1><p className="mt-1 text-sm text-gray-300">{t(isStudent ? 'Manage your personal information and contact details.' : isLandlord ? 'Manage your name and contact details.' : 'Manage your personal information and housing preferences.')}</p></div>
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/10 text-xl font-bold" aria-hidden="true">{initials}</span>
        </header>
        {profile.isPending ? <div className="p-8"><LoadingNotice /></div> : profile.isError ? <div className="p-8"><ErrorNotice error={profile.error} onRetry={() => void profile.refetch()} /></div> : <form onSubmit={submitProfile} noValidate className="space-y-6 p-6 sm:p-8">
          {saveMessage && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-4 text-center text-sm font-bold text-green-800">{t('✓ Profile updated successfully!')}</p>}
          <div className="grid gap-6 sm:grid-cols-2">
            <label className="block text-[13px] font-bold text-gray-700">{t('Full Legal Name')} <span aria-hidden="true">*</span><input className={inputClass} value={fields.displayName} onChange={event => updateField('displayName', event.target.value)} maxLength={100} required autoComplete="name" /></label>
            {!isLandlord && <label className="block text-[13px] font-bold text-gray-700">{t('University')}<input className={inputClass} value={fields.university} onChange={event => updateField('university', event.target.value)} maxLength={160} autoComplete="organization" /></label>}
            <label className="block text-[13px] font-bold text-gray-700 sm:col-span-2">{t('Account Email')}<input className={`${inputClass} cursor-not-allowed bg-gray-50 text-gray-500`} value={user?.email || ''} readOnly type="email" /></label>
            {(isLandlord || isStudent) && <label className="block text-[13px] font-bold text-gray-700 sm:col-span-2">{t('Phone Number')} {isLandlord && <span aria-hidden="true">*</span>}<input aria-label={t('Phone Number')} className={inputClass} value={fields.phone} onChange={event => updateField('phone', event.target.value)} maxLength={25} required={isLandlord} type="tel" autoComplete="tel" inputMode="tel" placeholder={t('e.g., +60 12-345 6789')} /><span className="mt-1 block text-xs font-normal text-gray-600">{t('For SMS, use a Malaysian number beginning with 0 or include +country code.')}</span></label>}
            {!isLandlord && <label className="block text-[13px] font-bold text-gray-700 sm:col-span-2">{t('Personal Bio / Roommate Notes')}<textarea className={inputClass} rows={3} maxLength={1000} value={fields.bio} onChange={event => updateField('bio', event.target.value)} placeholder={t('Tell others a little about yourself.')} /></label>}
          </div>
          {formError && <p role="alert" className="text-sm text-red-700">{t(formError)}</p>}
          {save.isError && <p role="alert" className="text-sm text-red-700">{t(messageOf(save.error))}</p>}
          <div className="flex justify-end border-t border-gray-100 pt-4"><button type="submit" disabled={save.isPending} className="min-h-11 rounded-lg bg-[#203569] px-6 py-2 font-bold text-white shadow-sm hover:bg-[#1a2b56] disabled:opacity-60">{save.isPending ? t('Saving…') : t('Save Changes')}</button></div>
        </form>}
      </section>

      {(isStudent || isLandlord) && !profile.isPending && !profile.isError && <PhoneVerification phone={profile.data?.phone || null} />}

      {isStudent && <Panel title={t('Student Verification')}>
        <p className="mb-4 text-sm text-gray-600">{t('Current status:')} <strong>{studentVerified ? t('Verified') : labelForStatus(verificationStatus)}</strong></p>
        {!studentVerified && <div className="mb-4"><PreviewDocumentNotice /></div>}
        {verificationMessage && <p role="alert" className="mb-4 text-sm text-red-700">{t(verificationMessage)}</p>}
        {studentVerified ? <p className="text-sm text-green-700">{t('Your student verification is complete.')}</p>
          : pendingVerification || verification.isSuccess ? <p className="text-sm text-gray-600">{t('Your application is being reviewed.')}</p>
            : user?.emailVerified !== true ? <p className="text-sm text-amber-800">{t('Verify your university-issued email before uploading your Student ID and offer letter.')} <Link to="/verify-email" className="font-semibold underline">{t('Verify Email')}</Link></p>
              : <form onSubmit={submitVerification} noValidate className="space-y-5 text-sm">
                {rejectedVerification && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">{t('Your previous verification was not approved. You may submit new documents for review.')}</p>}
                <p className="text-gray-600">{t('Your verified university email and two documents are required. An administrator will review your Student ID photo and offer letter before student access is approved.')}</p>
                <div>
                  <span id="student-id-photo-label" className="block font-semibold">{t('Student ID photo')} <span aria-hidden="true">*</span></span>
                  <label className="mt-2 flex min-h-11 cursor-pointer flex-wrap items-center gap-3 rounded-lg border border-gray-300 bg-white px-3 py-2 focus-within:ring-2 focus-within:ring-[#203569]">
                    <input type="file" className="sr-only" aria-labelledby="student-id-photo-label" accept="image/jpeg,image/png,.jpg,.jpeg,.png" onChange={event => chooseDocument('studentId', event)} />
                    <span aria-hidden="true" className="rounded-md bg-[#203569] px-3 py-1.5 font-semibold text-white">{t('Choose photo')}</span>
                    <span className="min-w-0 flex-1 truncate text-gray-600">{studentIdFile?.name || t('No file selected')}</span>
                  </label>
                  <p className="mt-1 text-xs text-gray-600">{t('JPG or PNG, up to 5 MB. Make sure your name, photo and student status are readable.')}</p>
                </div>
                <div>
                  <span id="offer-letter-label" className="block font-semibold">{t('Offer letter')} <span aria-hidden="true">*</span></span>
                  <label className="mt-2 flex min-h-11 cursor-pointer flex-wrap items-center gap-3 rounded-lg border border-gray-300 bg-white px-3 py-2 focus-within:ring-2 focus-within:ring-[#203569]">
                    <input type="file" className="sr-only" aria-labelledby="offer-letter-label" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" onChange={event => chooseDocument('offerLetter', event)} />
                    <span aria-hidden="true" className="rounded-md bg-[#203569] px-3 py-1.5 font-semibold text-white">{t('Choose file')}</span>
                    <span className="min-w-0 flex-1 truncate text-gray-600">{offerLetterFile?.name || t('No file selected')}</span>
                  </label>
                  <p className="mt-1 text-xs text-gray-600">{t('PDF, JPG or PNG, up to 5 MB. Upload the page that shows your name and admission details.')}</p>
                </div>
                <p className="text-xs text-gray-600">{t('Only authorized reviewers can open these documents. Cover unrelated personal information before uploading.')}</p>
                <label className="block font-semibold">{t('Note (optional)')}
                  <textarea className={inputClass} rows={3} maxLength={500} value={verificationNote} onChange={event => setVerificationNote(event.target.value)} placeholder={t('Add context for the reviewer without including ID numbers.')} />
                </label>
                {verification.isError && <p role="alert" className="text-red-700">{t(messageOf(verification.error))}</p>}
                <button disabled={verification.isPending} type="submit" className="min-h-11 rounded-lg bg-[#203569] px-4 py-2 font-semibold text-white hover:bg-[#172b59] disabled:opacity-60">{verification.isPending ? t('Submitting…') : t('Submit Verification')}</button>
              </form>}
      </Panel>}
      {isStudent && <Panel title={t('Roommate Profile & Privacy')}><p className="mb-4 text-sm text-gray-600">{t('Manage lifestyle habits, matching preferences and visibility.')}</p><Link className="text-sm font-semibold text-[#203569] underline underline-offset-2" to="/roommates/profile">{t('Manage Roommate Profile →')}</Link></Panel>}
      {isLandlord && <LandlordVerification />}
      <AccountControls />
    </div>
  </div>
}
