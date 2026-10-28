import { useI18n } from '../lib/i18n'

export function isLocalPreview(): boolean {
  return typeof document !== 'undefined' && document.querySelector('meta[name="uts-housing-preview"][content="true"]') !== null
}

export function PreviewDocumentNotice({ reviewer = false }: { reviewer?: boolean }) {
  const { t } = useI18n()
  if (!isLocalPreview()) return null

  return <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
    {t(reviewer
      ? 'Local preview only: these downloads are sample placeholders. Applicants’ uploaded files were discarded, so real documents cannot be reviewed here. Do not treat preview approvals as real verification.'
      : 'Local preview only: uploaded verification files are discarded immediately. Reviewers see sample placeholders, not your files. Do not upload real documents here.')}
  </p>
}
