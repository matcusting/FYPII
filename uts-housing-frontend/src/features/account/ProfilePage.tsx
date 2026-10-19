import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, messageOf } from '../../lib/api'
import { hasRole, useAuth } from '../../lib/auth'
import { ErrorNotice, LoadingNotice, PageShell, Panel } from './shared'
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

  return <PageShell title="账户与个人资料" description="更新你的公开介绍及找房偏好。敏感证明材料不会在此页面公开显示。">
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <Panel title="基本资料">
        {profile.isPending ? <LoadingNotice /> : profile.isError ? <ErrorNotice error={profile.error} onRetry={() => void profile.refetch()} /> : <form onSubmit={submitProfile} className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="block text-sm font-medium">显示名称 <span aria-hidden="true">*</span>
              <input className={inputClass} value={fields.displayName} onChange={event => updateField('displayName', event.target.value)} maxLength={100} required autoComplete="name" />
            </label>
            <label className="block text-sm font-medium">电子邮箱
              <input className={inputClass} value={user?.email || ''} readOnly type="email" />
            </label>
            <label className="block text-sm font-medium">大学
              <input className={inputClass} value={fields.university} onChange={event => updateField('university', event.target.value)} maxLength={160} autoComplete="organization" />
            </label>
            <label className="block text-sm font-medium">偏好地点
              <input className={inputClass} value={fields.preferredLocation} onChange={event => updateField('preferredLocation', event.target.value)} maxLength={160} placeholder="例如：靠近校园的区域" />
            </label>
            <label className="block text-sm font-medium">每月预算下限
              <input className={inputClass} type="number" min="0" step="0.01" inputMode="decimal" value={fields.budgetMin} onChange={event => updateField('budgetMin', event.target.value)} />
            </label>
            <label className="block text-sm font-medium">每月预算上限
              <input className={inputClass} type="number" min="0" step="0.01" inputMode="decimal" value={fields.budgetMax} onChange={event => updateField('budgetMax', event.target.value)} />
            </label>
            <label className="block text-sm font-medium sm:col-span-2">期望入住日期
              <input className={inputClass} type="date" value={fields.preferredMoveInDate} onChange={event => updateField('preferredMoveInDate', event.target.value)} />
            </label>
          </div>
          <label className="block text-sm font-medium">个人简介
            <textarea className={inputClass} rows={4} maxLength={1000} value={fields.bio} onChange={event => updateField('bio', event.target.value)} placeholder="简要介绍自己；请勿填写电话、证件号码等敏感信息。" />
          </label>
          {formError && <p role="alert" className="text-sm text-red-700">{formError}</p>}
          {save.isError && <p role="alert" className="text-sm text-red-700">{messageOf(save.error)}</p>}
          {saveMessage && <p role="status" className="text-sm text-green-700">{saveMessage}</p>}
          <button type="submit" disabled={save.isPending} className="min-h-11 rounded-lg bg-[#203569] px-5 py-2 font-semibold text-white hover:bg-[#172b59] disabled:opacity-60">{save.isPending ? '正在保存…' : '保存资料'}</button>
        </form>}
      </Panel>

      <div className="space-y-6">
        {isStudent && <Panel title="学生身份认证">
          <p className="mb-4 text-sm text-slate-600">当前状态：<strong>{user?.studentVerified ? '已通过' : labelForStatus(user?.verificationStatus || profile.data?.verificationStatus || 'UNVERIFIED')}</strong></p>
          {user?.studentVerified ? <p className="text-sm text-green-700">你的学生认证已通过。</p> : pendingVerification || verification.isSuccess ? <p className="text-sm text-slate-600">申请正在审核中。请等待状态更新。</p> : <form onSubmit={submitVerification} className="space-y-4 text-sm">
            <p className="text-slate-600">请先在左侧填写并保存大学名称。认可的大学邮箱域名由管理员配置。</p>
            <fieldset className="space-y-2"><legend className="font-medium">认证方式</legend>
              <label className="flex items-start gap-2"><input type="radio" name="verification-method" className="mt-1" checked={verificationMethod === 'EMAIL_DOMAIN'} onChange={() => setVerificationMethod('EMAIL_DOMAIN')} /> 使用已验证的大学邮箱</label>
              <label className="flex items-start gap-2"><input type="radio" name="verification-method" className="mt-1" checked={verificationMethod === 'MANUAL'} onChange={() => setVerificationMethod('MANUAL')} /> 申请人工审核</label>
            </fieldset>
            {verificationMethod === 'MANUAL' && <div className="space-y-3">
              <label className="block font-medium">学生身份证明文件
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
              <p className="text-xs text-slate-600">仅用于人工审核。请遮盖与学生身份无关的证件号码和个人资料。</p>
              <label className="block font-medium">申请说明（选填）
                <textarea className={inputClass} rows={3} maxLength={500} value={verificationNote} onChange={event => setVerificationNote(event.target.value)} placeholder="简述需要人工审核的原因。不要在文字中输入证件号码。" />
              </label>
            </div>}
            {user?.emailVerified === false && <p className="text-amber-800">请先验证电子邮箱后再提交申请。</p>}
            {verificationMessage && <p role="status" className="text-slate-700">{verificationMessage}</p>}
            {verification.isError && <p role="alert" className="text-red-700">{messageOf(verification.error)}</p>}
            <button disabled={verification.isPending || user?.emailVerified === false} type="submit" className="min-h-11 rounded-lg bg-[#203569] px-4 py-2 font-semibold text-white hover:bg-[#172b59] disabled:opacity-60">{verification.isPending ? '正在提交…' : '提交认证申请'}</button>
          </form>}
        </Panel>}
        {isStudent && <Panel title="室友资料与隐私">
          <p className="mb-4 text-sm text-slate-600">生活习惯、匹配偏好和发现可见性在单独页面管理。</p>
          <Link className="text-sm font-semibold text-[#203569] underline underline-offset-2" to="/roommates/profile">管理室友资料 →</Link>
        </Panel>}
        <AccountControls />
      </div>
    </div>
  </PageShell>
}
