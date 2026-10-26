import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, itemsOf, messageOf } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { AdminShell, Notice, QueryState } from './shared'
import { asRecord, dateText, firstText, nestedText, textValue, type DataRecord } from './data'

interface CampusForm {
  name: string
  university: string
  latitude: string
  longitude: string
  domains: string
  active: boolean
}

const blankForm: CampusForm = { name: '', university: '', latitude: '', longitude: '', domains: '', active: true }

function domainsOf(row: DataRecord): string[] {
  const source = row.domains ?? row.verificationDomains ?? row.emailDomains
  if (!Array.isArray(source)) return []
  return source.map(value => typeof value === 'string' ? value : firstText(asRecord(value), 'domain', 'name')).filter(Boolean)
}

function campusesOf(value: unknown): DataRecord[] {
  const direct = itemsOf<unknown>(value)
  const named = asRecord(value)?.campuses
  const source = direct.length ? direct : Array.isArray(named) ? named : direct
  return source.map(asRecord).filter((row): row is DataRecord => row !== null)
}

function formOf(row: DataRecord): CampusForm {
  return {
    name: firstText(row, 'name', 'campusName'),
    university: firstText(row, 'university', 'universityName') || nestedText(row, 'university', 'name'),
    latitude: textValue(row.latitude ?? asRecord(row.coordinates)?.latitude),
    longitude: textValue(row.longitude ?? asRecord(row.coordinates)?.longitude),
    domains: domainsOf(row).join('\n'),
    active: typeof row.active === 'boolean' ? row.active : typeof row.isActive === 'boolean' ? row.isActive : true,
  }
}

function validatedPayload(form: CampusForm) {
  const name = form.name.trim()
  const university = form.university.trim()
  const latitude = Number(form.latitude)
  const longitude = Number(form.longitude)
  const domains = [...new Set(form.domains.split(/[\n,;]+/).map(domain => domain.trim().toLowerCase()).filter(Boolean))]

  if (!name || !university) throw new Error('Enter a campus name and university.')
  if (name.length > 120 || university.length > 120) throw new Error('Campus and university names must be 120 characters or fewer.')
  if (!form.latitude.trim() || !form.longitude.trim() || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new Error('Enter valid coordinates: latitude must be between -90 and 90, and longitude between -180 and 180.')
  }
  if (domains.some(domain => !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(domain) || domain.includes('..'))) {
    throw new Error('Invalid verification domain. Enter one domain per line, such as student.uts.edu.my.')
  }
  return { name, university, latitude, longitude, domains, active: form.active }
}

export function AdminCampusesPage() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<CampusForm>(blankForm)
  const [validation, setValidation] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const campuses = useQuery({ queryKey: ['admin', 'campuses'], queryFn: () => api<unknown>('/admin/campuses') })
  const rows = campusesOf(campuses.data)

  const save = useMutation({
    mutationFn: ({ id, payload }: { id: string | null; payload: ReturnType<typeof validatedPayload> }) =>
      api<unknown>('/admin/campuses', {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify(id ? { id, ...payload } : payload),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'campuses'] })
      setSuccess(editingId ? 'Campus updated.' : 'Campus created.')
      setEditingId(null)
      setForm(blankForm)
      setValidation(null)
    },
  })

  function update<Key extends keyof CampusForm>(key: Key, value: CampusForm[Key]) {
    setForm(current => ({ ...current, [key]: value }))
    setValidation(null)
  }

  function edit(row: DataRecord) {
    const id = firstText(row, 'id')
    if (!id) return
    setEditingId(id)
    setForm(formOf(row))
    setValidation(null)
    setSuccess(null)
    save.reset()
    document.getElementById('campus-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const payload = validatedPayload(form)
      setValidation(null)
      setSuccess(null)
      save.mutate({ id: editingId, payload })
    } catch (error) {
      setValidation(messageOf(error))
    }
  }

  return (
    <AdminShell title="Campuses & Verification Domains" description="Manage campus records and university email domains for student verification.">
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(310px,0.8fr)]">
        <section aria-labelledby="campus-list-title">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 id="campus-list-title" className="text-xl font-bold text-slate-950">{t('Existing campuses')}</h2>
            <button type="button" className="button button-secondary button-small" onClick={() => { void campuses.refetch() }} disabled={campuses.isFetching}>{t('Refresh')}</button>
          </div>
          <QueryState loading={campuses.isPending} error={campuses.error ? messageOf(campuses.error) : null} empty={rows.length === 0} emptyText="No campuses have been configured." onRetry={() => { void campuses.refetch() }} />
          {!campuses.isPending && !campuses.error && rows.length > 0 && (
            <ul className="grid gap-3">
              {rows.map((row, index) => {
                const id = firstText(row, 'id')
                const domains = domainsOf(row)
                const university = firstText(row, 'university', 'universityName') || nestedText(row, 'university', 'name')
                const active = typeof row.active === 'boolean' ? row.active : typeof row.isActive === 'boolean' ? row.isActive : null
                const updatedBy = nestedText(row, 'updatedBy', 'name', 'email') || firstText(row, 'updatedByName')
                return (
                  <li key={id || index} className="card p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-bold text-slate-950">{firstText(row, 'name', 'campusName') || t('Unnamed campus')}</h3>
                        <p className="text-sm text-slate-600">{university || t('University unavailable')}</p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${active === false ? 'bg-slate-100 text-slate-700' : active === true ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>{t(active === null ? 'Status unavailable' : active ? 'Active' : 'Inactive')}</span>
                    </div>
                    <dl className="mt-4 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                      <div><dt className="font-semibold">{t('Coordinates')}</dt><dd>{textValue(row.latitude ?? asRecord(row.coordinates)?.latitude) || '—'}, {textValue(row.longitude ?? asRecord(row.coordinates)?.longitude) || '—'}</dd></div>
                      <div><dt className="font-semibold">{t('Verification domains')}</dt><dd className="break-words">{domains.length ? domains.join(', ') : t('None configured')}</dd></div>
                      {(row.updatedAt || updatedBy) && <div className="sm:col-span-2"><dt className="font-semibold">{t('Last updated')}</dt><dd>{updatedBy && `${updatedBy} · `}{dateText(row.updatedAt)}</dd></div>}
                    </dl>
                    <button type="button" className="button button-secondary button-small mt-4" disabled={!id} onClick={() => edit(row)}>{t('Edit campus')}</button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section id="campus-editor" aria-labelledby="campus-editor-title" className="card p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="campus-editor-title" className="text-xl font-bold text-slate-950">{t(editingId ? 'Edit campus' : 'Add campus')}</h2>
            {editingId && <button type="button" className="button button-secondary button-small" onClick={() => { setEditingId(null); setForm(blankForm); setValidation(null); save.reset() }}>{t('Cancel editing')}</button>}
          </div>
          <p className="mt-2 text-sm text-slate-600">{t('Add each school-issued student email domain on its own line, such as student.uts.edu.my. An active domain is required for student registration.')}</p>
          <form onSubmit={submit} noValidate className="mt-5 grid gap-4">
            <div className="field"><label htmlFor="campus-name">{t('Campus name')}</label><input id="campus-name" value={form.name} onChange={event => update('name', event.target.value)} required maxLength={120} autoComplete="off" /></div>
            <div className="field"><label htmlFor="campus-university">{t('University name')}</label><input id="campus-university" value={form.university} onChange={event => update('university', event.target.value)} required maxLength={120} autoComplete="organization" /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="field"><label htmlFor="campus-latitude">{t('Latitude')}</label><input id="campus-latitude" type="number" min="-90" max="90" step="any" value={form.latitude} onChange={event => update('latitude', event.target.value)} required /></div>
              <div className="field"><label htmlFor="campus-longitude">{t('Longitude')}</label><input id="campus-longitude" type="number" min="-180" max="180" step="any" value={form.longitude} onChange={event => update('longitude', event.target.value)} required /></div>
            </div>
            <div className="field"><label htmlFor="campus-domains">{t('Student verification email domains')}</label><textarea id="campus-domains" rows={4} value={form.domains} onChange={event => update('domains', event.target.value)} placeholder="student.uts.edu.my" aria-describedby="campus-domains-hint" /><p id="campus-domains-hint" className="text-xs text-slate-600">{t('Enter only the part after @. Put each domain on a separate line.')}</p></div>
            <label className="flex items-center gap-3 text-sm font-medium text-slate-800"><input type="checkbox" checked={form.active} onChange={event => update('active', event.target.checked)} className="h-5 w-5" />{t('Enable this campus')}</label>
            <Notice error={validation || (save.error ? messageOf(save.error) : null)} success={success} />
            <button type="submit" className="button" disabled={save.isPending}>{t(save.isPending ? 'Saving…' : editingId ? 'Save changes' : 'Create campus')}</button>
          </form>
        </section>
      </div>
    </AdminShell>
  )
}
