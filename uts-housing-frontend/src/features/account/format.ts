export const inputClass = 'mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 focus:border-[#203569] focus:outline-none focus:ring-2 focus:ring-[#203569]/20 disabled:bg-slate-100 disabled:text-slate-500'

export function formatDate(value: string | undefined | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('zh-MY', { dateStyle: 'medium' }).format(date)
}

export function labelForStatus(status: string | undefined | null) {
  const labels: Record<string, string> = {
    UNVERIFIED: '未认证', PENDING: '待处理', PENDING_REVIEW: '待审核', APPROVED: '已通过', ACCEPTED: '已接受',
    REJECTED: '已拒绝', DECLINED: '已婉拒', CLOSED: '已结束', PUBLISHED: '已发布',
    DRAFT: '草稿', PAUSED: '已暂停', RENTED: '已出租', ARCHIVED: '已归档',
  }
  return status ? (labels[status.toUpperCase()] || status) : '状态未知'
}
