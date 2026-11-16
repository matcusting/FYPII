import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ErrorBanner, ReportDialog, StarInput, Stars, SuccessBanner } from './ui';
import { useT } from '../i18n';

const emptyForm = { rating: 0, body: '', stayFrom: '', stayTo: '', proofNote: '' };

/** Verified-student reviews for one listing: summary, list, write/edit form. */
const ListingReviews = ({ listingId, landlordName }) => {
    const { t } = useT();
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [formError, setFormError] = useState(null);
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState(null);
    const [reporting, setReporting] = useState(null);

    const load = useCallback(() => {
        api(`/listings/${listingId}/reviews`).then(setData).catch(setError);
    }, [listingId]);

    useEffect(() => { load(); }, [load]);

    const startEdit = () => {
        const m = data.mine;
        setForm({ rating: m.rating, body: m.body, stayFrom: m.stayFrom, stayTo: m.stayTo || '', proofNote: '' });
        setShowForm(true);
    };

    const submit = async (e) => {
        e.preventDefault();
        setFormError(null);
        if (!form.rating) return setFormError({ message: t('Choose a star rating.') });
        setSaving(true);
        try {
            const body = { ...form, stayTo: form.stayTo || null };
            if (data.mine) await api(`/reviews/${data.mine.id}`, { method: 'PATCH', body });
            else await api(`/listings/${listingId}/reviews`, { method: 'POST', body });
            setShowForm(false);
            setForm(emptyForm);
            setNotice(t('Thanks! Your review was submitted and will appear after an administrator checks it.'));
            load();
        } catch (err) {
            setFormError(err);
        } finally {
            setSaving(false);
        }
    };

    if (error) return <ErrorBanner error={error} />;
    if (!data) return <p className="text-sm text-gray-400 font-bold">{t('Loading reviews...')}</p>;
    const { summary, reviews, mine, canReview, reason } = data;

    return (
        <div>
            <div className="flex justify-between items-end mb-3">
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('Verified Student Reviews')}</h4>
                {summary.count > 0 && (
                    <div className="text-right">
                        <span className="text-[#eab308] font-bold">{summary.average} ★</span>
                        <span className="text-[12px] text-gray-500 font-medium ml-1">({t('{n} reviews', { n: summary.count })})</span>
                    </div>
                )}
            </div>

            <SuccessBanner message={notice} className="mb-3" />

            {reviews.length === 0 && <p className="text-sm text-gray-500 mb-3">{t('No reviews yet.')}</p>}
            <div className="space-y-3 mb-4">
                {reviews.map((r) => (
                    <div key={r.id} className="border border-gray-200 rounded-xl p-4 bg-white">
                        <div className="flex justify-between items-start mb-2">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 bg-[#eff6ff] text-[#2563eb] rounded-full flex items-center justify-center font-bold text-sm">{r.author.initials}</div>
                                <div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h5 className="font-bold text-[#0f172a] text-[14px]">{r.author.name}</h5>
                                        <span className="bg-[#dbeafe] text-[#1d4ed8] text-[10px] font-bold px-2 py-0.5 rounded-full">{t('Verified UTS Student')}</span>
                                    </div>
                                    <p className="text-[11px] text-gray-500 font-medium">
                                        {t('Stayed {from} – {to}', { from: r.stayFrom, to: r.stayTo || t('present') })}{r.edited ? ` • ${t('edited')}` : ''}
                                    </p>
                                </div>
                            </div>
                            <Stars value={r.rating} className="text-sm" />
                        </div>
                        <p className="text-gray-600 text-[13px] leading-relaxed">{r.body}</p>
                        {r.reply && (
                            <div className="bg-[#f8f9fa] border-l-4 border-[#203569] p-3 rounded-r-lg mt-3">
                                <p className="text-xs font-bold text-[#203569] mb-1">{t('Response from {name} (Landlord):', { name: landlordName })}</p>
                                <p className="text-xs text-gray-600">{r.reply}</p>
                            </div>
                        )}
                        <button onClick={() => setReporting(r.id)} className="mt-2 text-[11px] font-bold text-gray-400 hover:text-[#e11d48] cursor-pointer">{t('Report review')}</button>
                    </div>
                ))}
            </div>

            {mine && !showForm && (
                <div className="border border-dashed border-gray-300 rounded-xl p-4 mb-3 text-[13px] text-gray-600 flex justify-between items-center gap-3 flex-wrap">
                    <span>
                        {t('Your review ({n}★) is', { n: mine.rating })}{' '}
                        <strong className={mine.moderationStatus === 'APPROVED' ? 'text-[#15803d]' : mine.moderationStatus === 'REJECTED' ? 'text-[#b91c1c]' : 'text-[#a16207]'}>
                            {mine.moderationStatus === 'PENDING' ? t('waiting for moderation') : mine.moderationStatus === 'APPROVED' ? t('published') : t('not published')}
                        </strong>.
                    </span>
                    <button onClick={startEdit} className="text-xs font-bold text-[#1d4ed8] hover:underline cursor-pointer">{t('Edit review')}</button>
                </div>
            )}

            {!mine && !showForm && (
                canReview ? (
                    <button onClick={() => setShowForm(true)} className="text-sm font-bold text-[#1d4ed8] hover:underline cursor-pointer">✍️ {t('Write a review')}</button>
                ) : (
                    <p className="text-[12px] text-gray-400 font-bold">{t(reason)}</p>
                )
            )}

            {showForm && (
                <form onSubmit={submit} className="border border-gray-200 rounded-xl p-4 space-y-3 bg-[#fcfcfd]">
                    <ErrorBanner error={formError} />
                    <div>
                        <p className="text-[13px] font-bold text-[#374151] mb-1">{t('Your rating')}</p>
                        <StarInput value={form.rating} onChange={(rating) => setForm({ ...form, rating })} />
                    </div>
                    <div>
                        <label htmlFor="review-body" className="block text-[13px] font-bold text-[#374151] mb-1">{t('Your experience')}</label>
                        <textarea id="review-body" rows="3" required minLength={20} maxLength={2000} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })}
                            className="w-full p-2.5 border border-gray-300 rounded-md outline-none focus:border-[#203569] text-gray-800 text-sm" placeholder={t('How was the room, the landlord, the deposit return...?')}></textarea>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label htmlFor="stay-from" className="block text-[13px] font-bold text-[#374151] mb-1">{t('Stayed from')}</label>
                            <input id="stay-from" type="date" required value={form.stayFrom} onChange={(e) => setForm({ ...form, stayFrom: e.target.value })} className="w-full p-2.5 border border-gray-300 rounded-md outline-none focus:border-[#203569] text-sm" />
                        </div>
                        <div>
                            <label htmlFor="stay-to" className="block text-[13px] font-bold text-[#374151] mb-1">{t('Until (leave empty if still renting)')}</label>
                            <input id="stay-to" type="date" value={form.stayTo} onChange={(e) => setForm({ ...form, stayTo: e.target.value })} className="w-full p-2.5 border border-gray-300 rounded-md outline-none focus:border-[#203569] text-sm" />
                        </div>
                    </div>
                    <div>
                        <label htmlFor="proof" className="block text-[13px] font-bold text-[#374151] mb-1">{t('Proof of stay (only visible to administrators)')}</label>
                        <textarea id="proof" rows="2" required minLength={10} maxLength={1000} value={form.proofNote} onChange={(e) => setForm({ ...form, proofNote: e.target.value })}
                            className="w-full p-2.5 border border-gray-300 rounded-md outline-none focus:border-[#203569] text-gray-800 text-sm" placeholder={t('e.g. tenancy dates, how you paid rent (no documents or bank numbers needed)')}></textarea>
                    </div>
                    <div className="flex justify-end gap-3">
                        <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-gray-600 font-bold text-sm hover:bg-gray-100 rounded-md cursor-pointer">{t('Cancel')}</button>
                        <button type="submit" disabled={saving} className="px-5 py-2 bg-[#203569] text-white font-bold text-sm rounded-md hover:bg-[#1a2b56] cursor-pointer disabled:opacity-60">
                            {saving ? t('Submitting...') : t('Submit Review')}
                        </button>
                    </div>
                </form>
            )}

            {reporting && <ReportDialog targetType="REVIEW" targetId={reporting} label="Review" onClose={() => setReporting(null)} />}
        </div>
    );
};

export default ListingReviews;
