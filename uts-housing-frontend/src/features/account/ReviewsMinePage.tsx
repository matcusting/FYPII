import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, itemsOf } from '../../lib/api'
import { EmptyNotice, ErrorNotice, LoadingNotice, PageShell, Panel } from './shared'
import { formatDate, labelForStatus } from './format'

interface Review {
  id: string
  listingId?: string
  listing?: { id?: string; title?: string }
  rating: number
  body?: string
  moderationStatus?: string
  status?: string
  createdAt?: string
  updatedAt?: string
  ownerResponse?: string
}

export function ReviewsMinePage() {
  // The route is required by the screen plan; the API table omits its GET endpoint.
  const reviews = useQuery({ queryKey: ['reviews-mine'], queryFn: () => api<unknown>('/reviews/mine') })
  const ownReviews = itemsOf<Review>(reviews.data)

  return <PageShell title="我的评价" description="查看已提交评价的审核状态。只有审核通过的评价才会公开显示。">
    <Panel title="评价记录" action={<Link to="/listings" className="text-sm font-medium text-[#203569] underline">浏览房源</Link>}>
      {reviews.isPending ? <LoadingNotice /> : reviews.isError ? <ErrorNotice error={reviews.error} onRetry={() => void reviews.refetch()} /> : ownReviews.length ? <ul className="divide-y divide-slate-200">
        {ownReviews.map(review => {
          const listingId = review.listingId || review.listing?.id
          const rating = Number(review.rating)
          return <li key={review.id} className="py-5 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="font-semibold">{listingId ? <Link className="text-[#203569] underline underline-offset-2" to={`/listings/${encodeURIComponent(listingId)}`}>{review.listing?.title || '查看房源'}</Link> : review.listing?.title || '房源评价'}</h3>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">{labelForStatus(review.moderationStatus || review.status)}</span>
            </div>
            <p className="mt-2 text-sm" aria-label={`评分 ${Number.isFinite(rating) ? rating : '未知'} 星`}>
              {Number.isFinite(rating) && rating >= 1 && rating <= 5 ? <><span aria-hidden="true" className="text-amber-500">{'★'.repeat(Math.round(rating))}{'☆'.repeat(5 - Math.round(rating))}</span><span className="ml-2 text-slate-600">{rating}/5</span></> : '评分未知'}
            </p>
            {review.body && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{review.body}</p>}
            {review.ownerResponse && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700"><strong>发布者回复：</strong>{review.ownerResponse}</p>}
            <p className="mt-2 text-xs text-slate-500">提交于 {formatDate(review.createdAt)}{review.updatedAt && review.updatedAt !== review.createdAt ? ` · 更新于 ${formatDate(review.updatedAt)}` : ''}</p>
          </li>
        })}
      </ul> : <EmptyNotice>你还没有提交评价。只有已通过学生认证并符合实际租住经历条件的用户可以评价。</EmptyNotice>}
    </Panel>
  </PageShell>
}
