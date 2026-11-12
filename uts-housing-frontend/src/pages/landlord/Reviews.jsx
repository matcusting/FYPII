import { useState } from 'react';
import { api } from '../../lib/api';
import { ErrorBanner, ReportDialog } from '../../components/ui';

const AVATAR_BG = ['bg-[#eff6ff] text-[#2563eb]', 'bg-[#f3f4f6] text-gray-600', 'bg-[#f0fdf4] text-[#16a34a]', 'bg-[#faf5ff] text-[#9333ea]'];

const Reviews = ({ data, reload, landlordName }) => {
    const [replyingToId, setReplyingToId] = useState(null);
    const [replyText, setReplyText] = useState('');
    const [error, setError] = useState(null);
    const [reporting, setReporting] = useState(null);
    const { summary, reviews } = data;

    const handleReplySubmit = async (reviewId) => {
        if (!replyText.trim()) return;
        setError(null);
        try {
            await api(`/reviews/${reviewId}/reply`, { method: 'POST', body: { reply: replyText } });
            setReplyingToId(null);
            setReplyText('');
            reload();
        } catch (err) {
            setError(err);
        }
    };

    return (
        <div className="p-5 sm:p-10 overflow-y-auto animate-fade-in-up">
            <div className="flex justify-between items-end border-b border-gray-200 pb-4 mb-8 max-w-4xl">
                <h2 className="text-[1.4rem] font-bold text-[#0f172a]">Student Reviews</h2>
                <div className="text-right">
                    <div className="text-3xl font-bold text-[#eab308] flex items-center gap-1 justify-end">
                        {summary.average ?? '–'} <span className="text-2xl">★</span>
                    </div>
                    <div className="text-[12px] text-gray-500 font-medium">Based on {summary.count} verified review{summary.count === 1 ? '' : 's'}</div>
                </div>
            </div>

            <ErrorBanner error={error} className="mb-4 max-w-4xl" />
            {reviews.length === 0 && <p className="text-sm text-gray-400 font-bold">No published reviews yet. Reviews appear here after an administrator approves them.</p>}

            <div className="space-y-5 max-w-4xl">
                {reviews.map((review, i) => (
                    <div key={review.id} className="border border-gray-200 rounded-xl p-6 bg-white shadow-sm">
                        <div className="flex flex-col sm:flex-row gap-3 justify-between items-start mb-4">
                            <div className="flex items-center gap-4">
                                <div className={`w-12 h-12 ${AVATAR_BG[i % AVATAR_BG.length]} rounded-full flex items-center justify-center font-bold text-lg flex-shrink-0`}>
                                    {review.author.initials}
                                </div>
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="font-bold text-[#0f172a] text-[15px]">{review.author.name}</h3>
                                        <span className="bg-[#dbeafe] text-[#1d4ed8] text-[10px] font-bold px-2 py-0.5 rounded-full">
                                            Verified UTS Student
                                        </span>
                                    </div>
                                    <p className="text-[12px] text-gray-500 mt-0.5 font-medium">
                                        {review.author.academicYear || 'UTS Student'} • Rated Property: {review.listing?.title}
                                    </p>
                                </div>
                            </div>
                            <div className="text-[#eab308] text-lg tracking-widest">
                                {'★'.repeat(review.rating)}
                                <span className="text-gray-300">{'★'.repeat(5 - review.rating)}</span>
                            </div>
                        </div>

                        <p className="text-gray-600 text-[14px] leading-relaxed mb-4">"{review.body}"</p>

                        {review.reply ? (
                            <div className="bg-[#f8f9fa] border-l-4 border-[#203569] p-3.5 rounded-r-lg mt-3">
                                <p className="text-xs font-bold text-[#203569] mb-1">Response from {landlordName} (Landlord):</p>
                                <p className="text-xs text-gray-600">{review.reply}</p>
                            </div>
                        ) : (
                            <div>
                                {replyingToId === review.id ? (
                                    <div className="mt-4 flex flex-col sm:flex-row gap-2">
                                        <input
                                            type="text"
                                            aria-label="Reply"
                                            maxLength={1000}
                                            value={replyText}
                                            onChange={(e) => setReplyText(e.target.value)}
                                            placeholder="Write a public response..."
                                            className="flex-1 text-sm p-2 border border-gray-300 rounded-lg outline-none focus:border-[#203569]"
                                        />
                                        <button
                                            onClick={() => handleReplySubmit(review.id)}
                                            className="bg-[#203569] text-white text-xs font-bold px-4 py-2 rounded-lg hover:bg-[#1a2b56] cursor-pointer"
                                        >
                                            Post Reply
                                        </button>
                                        <button
                                            onClick={() => setReplyingToId(null)}
                                            className="text-gray-500 text-xs font-bold px-3 py-2 hover:bg-gray-100 rounded-lg cursor-pointer"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => { setReplyingToId(review.id); setReplyText(''); }}
                                        className="text-xs font-bold text-[#1d4ed8] hover:underline cursor-pointer"
                                    >
                                        ↪ Reply to this review
                                    </button>
                                )}
                            </div>
                        )}
                        <p className="text-[11px] text-gray-400 mt-3">
                            Landlords can reply publicly but cannot edit reviews.{' '}
                            <button onClick={() => setReporting(review.id)} className="font-bold hover:text-[#e11d48] cursor-pointer">Report this review</button>
                        </p>
                    </div>
                ))}
            </div>

            {reporting && <ReportDialog targetType="REVIEW" targetId={reporting} label="Review" onClose={() => setReporting(null)} />}
        </div>
    );
};

export default Reviews;
