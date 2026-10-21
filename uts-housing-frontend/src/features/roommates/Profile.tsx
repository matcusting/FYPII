import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, messageOf } from '../../lib/api'
import { blankProfile, lifestyleFields, profileOf, profilePayload, type LifestyleKey, type PrivacyField, type RoommateProfile } from './model'
import { buttonClass, inputClass, Notice, RoommateShell, secondaryButtonClass, StudentGate } from './ui'

const privacyFields: Array<{ key: PrivacyField; label: string }> = [
  { key: 'university', label: '大学' },
  { key: 'bio', label: '简介' },
  { key: 'preferredLocation', label: '意向地区' },
  { key: 'budget', label: '预算范围' },
  { key: 'moveInDate', label: '计划入住日期' },
  { key: 'lifestyle', label: '生活习惯答案' },
]

function validate(profile: RoommateProfile): string | null {
  if (profile.discoverable && !profile.displayName.trim()) return '开启发现前，请填写公开显示名称。'
  if (profile.displayName.length > 80) return '显示名称不能超过 80 个字符。'
  if (profile.bio.length > 1000) return '简介不能超过 1000 个字符。'
  for (const value of [profile.budgetMin, profile.budgetMax]) {
    if (value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0)) return '预算请输入有效的非负数字。'
  }
  if (profile.budgetMin !== '' && profile.budgetMax !== '' && Number(profile.budgetMin) > Number(profile.budgetMax)) return '最低预算不能高于最高预算。'
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
  return <fieldset className="border-b border-gray-100 pb-8">
    <legend className="text-[1.1rem] font-bold text-[#1f2937]">{title}</legend>
    <p className="mb-6 mt-1 text-sm text-gray-600">{description}</p>
    <div className="space-y-7">
      {lifestyleFields.map(({ key, label, options }) => <div key={key}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p id={`${title}-${key}`} className="text-[15px] font-bold text-[#374151]">{label}</p>
          {weights && onWeightChange && <label className="flex items-center gap-2 text-xs text-gray-600" htmlFor={`weight-${key}`}>
            重视程度
            <select id={`weight-${key}`} className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm text-[#374151] focus:border-[#203569] focus-visible:outline-2 focus-visible:outline-[#203569]" value={weights[key]} onChange={event => onWeightChange(key, Number(event.currentTarget.value))}>
              {[1, 2, 3, 4, 5].map(weight => <option key={weight} value={weight}>{weight}{weight === 1 ? '（一般）' : weight === 5 ? '（非常重要）' : ''}</option>)}
            </select>
          </label>}
        </div>
        <div role="group" aria-labelledby={`${title}-${key}`} className="flex flex-wrap gap-3">
          {options.map(([optionValue, optionLabel]) => <button key={optionValue} type="button" aria-pressed={value[key] === optionValue} onClick={() => onChange(key, optionValue)}
            className={value[key] === optionValue
              ? 'rounded-full border-2 border-[#86efac] bg-[#e2f5e9] px-5 py-2 text-sm font-bold text-[#168a48] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15803d]'
              : 'rounded-full border border-gray-200 bg-white px-5 py-2 text-sm font-medium text-gray-600 hover:border-gray-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#203569]'}>
            {optionLabel}
          </button>)}
        </div>
      </div>)}
    </div>
  </fieldset>
}

function ProfileEditor({ initial }: { initial: RoommateProfile }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState(initial)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (value: RoommateProfile) => api<unknown>('/roommates/profile', { method: 'PATCH', body: JSON.stringify(profilePayload(value)) }),
    onSuccess: (_data, variables) => {
      setForm(variables)
      setSuccess(variables.discoverable ? '资料已保存，已开启室友发现。' : '资料已保存，室友发现已暂停。')
      void queryClient.invalidateQueries({ queryKey: ['roommates'] })
    },
  })
  const remove = useMutation({
    mutationFn: () => api<unknown>('/roommates/profile', { method: 'DELETE' }),
    onSuccess: () => {
      setForm(blankProfile())
      setSuccess('室友资料已移除。')
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

  return <form onSubmit={submit} className="space-y-8">
    <section className="border-b border-gray-100 pb-8">
      <h2 className="text-[1.1rem] font-bold text-[#1f2937]">基本资料</h2>
      <p className="mb-5 mt-1 text-sm text-gray-600">开启室友发现后，已认证学生可以看到你选择公开的资料。</p>
      <div className="grid gap-5 sm:grid-cols-2">
        <div><label className="block text-sm font-medium" htmlFor="roommate-display-name">显示名称</label><input id="roommate-display-name" className={inputClass} maxLength={80} value={form.displayName} onChange={event => update('displayName', event.currentTarget.value)} autoComplete="nickname" /></div>
        <div><label className="block text-sm font-medium" htmlFor="roommate-university">大学</label><input id="roommate-university" className={inputClass} maxLength={120} value={form.university} onChange={event => update('university', event.currentTarget.value)} /></div>
        <div><label className="block text-sm font-medium" htmlFor="roommate-location">意向地区</label><input id="roommate-location" className={inputClass} maxLength={120} value={form.preferredLocation} onChange={event => update('preferredLocation', event.currentTarget.value)} placeholder="例如：校园附近区域" /><p className="mt-1 text-xs text-gray-600">请填写大致区域，避免公开精确住址。</p></div>
        <div><label className="block text-sm font-medium" htmlFor="roommate-move-in">计划入住日期</label><input id="roommate-move-in" type="date" className={inputClass} value={form.moveInDate} onChange={event => update('moveInDate', event.currentTarget.value)} /></div>
        <div><label className="block text-sm font-medium" htmlFor="roommate-budget-min">最低月预算（MYR）</label><input id="roommate-budget-min" type="number" min="0" step="1" inputMode="numeric" className={inputClass} value={form.budgetMin} onChange={event => update('budgetMin', event.currentTarget.value)} /></div>
        <div><label className="block text-sm font-medium" htmlFor="roommate-budget-max">最高月预算（MYR）</label><input id="roommate-budget-max" type="number" min="0" step="1" inputMode="numeric" className={inputClass} value={form.budgetMax} onChange={event => update('budgetMax', event.currentTarget.value)} /></div>
      </div>
      <div className="mt-5"><label className="block text-sm font-medium" htmlFor="roommate-bio">简短介绍</label><textarea id="roommate-bio" className={inputClass} rows={4} maxLength={1000} value={form.bio} onChange={event => update('bio', event.currentTarget.value)} placeholder="介绍你的生活习惯和理想合租方式。请勿填写电话或精确住址。" /><p className="mt-1 text-right text-xs text-gray-600">{form.bio.length}/1000</p></div>
    </section>

    <LifestyleQuestions title="我的生活习惯" description="留空的维度不会作为已回答信息显示。" value={form.lifestyle} onChange={(key, answer) => setForm(previous => ({ ...previous, lifestyle: { ...previous.lifestyle, [key]: answer } }))} />
    <LifestyleQuestions title="希望室友的习惯" description="选择你的偏好和每项偏好的重要程度，有助于找到更合适的室友。" value={form.roommatePreferences} weights={form.importanceWeights} onChange={(key, answer) => setForm(previous => ({ ...previous, roommatePreferences: { ...previous.roommatePreferences, [key]: answer } }))} onWeightChange={(key, weight) => setForm(previous => ({ ...previous, importanceWeights: { ...previous.importanceWeights, [key]: weight } }))} />

    <fieldset className="border-b border-gray-100 pb-8">
      <legend className="text-[1.1rem] font-bold text-[#1f2937]">不能接受的条件</legend>
      <p className="mb-4 mt-1 text-sm text-gray-600">符合以下条件的学生才会出现在你的匹配结果中。</p>
      <div className="space-y-3">
        <label className="flex items-start gap-3"><input type="checkbox" checked={form.smokeFreeOnly} onChange={event => update('smokeFreeOnly', event.currentTarget.checked)} className="mt-1 accent-emerald-700" /><span>只考虑不吸烟的室友</span></label>
        <label className="flex items-start gap-3"><input type="checkbox" checked={form.petFreeOnly} onChange={event => update('petFreeOnly', event.currentTarget.checked)} className="mt-1 accent-emerald-700" /><span>只考虑没有宠物的室友</span></label>
      </div>
    </fieldset>

    <fieldset className="border-b border-gray-100 pb-8">
      <legend className="text-[1.1rem] font-bold text-[#1f2937]">隐私与发现</legend>
      <p className="mb-4 mt-1 text-sm text-gray-600">所有可选字段默认仅自己可见。开启发现后，只有下面勾选的字段会展示给匹配对象。</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {privacyFields.map(({ key, label }) => <label key={key} className="flex items-start gap-3"><input type="checkbox" className="mt-1 accent-emerald-700" checked={form.visibility[key]} onChange={event => setForm(previous => ({ ...previous, visibility: { ...previous.visibility, [key]: event.currentTarget.checked } }))} /><span>允许向匹配对象显示{label}</span></label>)}
      </div>
      <label className="mt-6 flex items-start gap-3 border-t border-gray-100 pt-5 font-medium"><input type="checkbox" className="mt-1 accent-[#15803d]" checked={form.discoverable} onChange={event => update('discoverable', event.currentTarget.checked)} /><span>开启室友发现，让其他已认证学生看到我的匹配资料</span></label>
    </fieldset>

    {validationError && <Notice tone="error">{validationError}</Notice>}
    {save.isError && <Notice tone="error">保存失败：{messageOf(save.error)}</Notice>}
    {remove.isError && <Notice tone="error">移除失败：{messageOf(remove.error)}</Notice>}
    {success && <Notice tone="success">{success}</Notice>}
    <div className="flex flex-wrap items-center gap-3">
      <button className={buttonClass} type="submit" disabled={save.isPending || remove.isPending}>{save.isPending ? '正在保存…' : '保存室友资料'}</button>
      {form.discoverable && <button className={secondaryButtonClass} type="button" disabled={save.isPending || remove.isPending} onClick={() => {
        const paused = { ...form, discoverable: false }
        setValidationError(null)
        setSuccess(null)
        save.mutate(paused)
      }}>暂停发现</button>}
      <Link className={secondaryButtonClass} to="/roommates">查看匹配</Link>
    </div>
    <details className="rounded-lg border border-gray-200 bg-white p-4 text-sm"><summary className="cursor-pointer font-medium text-red-800">移除室友资料</summary><p className="my-3 text-gray-600">这会删除你的室友资料和发现设置。账户资料仍由账户设置管理。</p><button type="button" className="rounded-lg border border-red-300 px-4 py-2 font-semibold text-red-800 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-red-700 disabled:opacity-50" disabled={remove.isPending || save.isPending} onClick={() => { if (window.confirm('确定移除室友资料？')) remove.mutate() }}>确认移除室友资料</button></details>
  </form>
}

function ProfileContent() {
  const profile = useQuery({ queryKey: ['roommates', 'profile'], queryFn: () => api<unknown>('/roommates/profile').then(profileOf) })
  return <RoommateShell title="My Lifestyle Profile" description="填写生活习惯和室友偏好，并自行决定是否加入匹配。">
    {profile.isPending ? <p role="status">正在读取室友资料…</p> : profile.isError ? <div className="space-y-4"><Notice tone="error">无法读取室友资料：{messageOf(profile.error)}</Notice><button type="button" className={secondaryButtonClass} onClick={() => void profile.refetch()}>重试</button></div> : <ProfileEditor initial={profile.data} />}
  </RoommateShell>
}

export function RoommateProfilePage() {
  return <StudentGate><ProfileContent /></StudentGate>
}
