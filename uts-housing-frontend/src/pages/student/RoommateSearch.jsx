import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../../components/Navbar';
import { useAuth } from '../../context/AuthContext';
import { GENDER_LABELS, api } from '../../lib/api';
import { ErrorBanner, LoadingBlock, ReportDialog, SuccessBanner, VerificationBanner } from '../../components/ui';

const AVATAR_COLORS = [
    'bg-[#eff6ff] text-[#2563eb]',
    'bg-[#faf5ff] text-[#9333ea]',
    'bg-[#f0fdf4] text-[#16a34a]',
    'bg-[#fff7ed] text-[#ea580c]',
    'bg-[#fdf2f8] text-[#db2777]',
];

// 把选项变成简短的标签，例如 "Night Owl (Late)" → "Night Owl"
const shortTag = (key, value) => {
    const base = value.replace(/\s*\(.*\)/, '');
    return key === 'cleanliness' ? `${base} Clean` : base;
};

const IMPORTANCE = { 1: 'Normal', 2: 'Important', 3: 'Very important' };

const RoommateSearch = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const verified = user.studentVerified;

    const [dimensions, setDimensions] = useState([]);
    const [profile, setProfile] = useState(null);
    const [showMatches, setShowMatches] = useState(false);
    const [matches, setMatches] = useState([]);
    const [matchMeta, setMatchMeta] = useState(null);
    const [loadingMatches, setLoadingMatches] = useState(false);
    const [requests, setRequests] = useState([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);
    const [busyId, setBusyId] = useState(null);
    const [reportUser, setReportUser] = useState(null);

    const loadRequests = useCallback(() => api('/roommates/requests').then(setRequests).catch(() => {}), []);

    const loadMatches = useCallback(async () => {
        setLoadingMatches(true);
        setError(null);
        try {
            const res = await api('/roommates/matches');
            setMatches(res.data);
            setMatchMeta(res.meta);
            setShowMatches(true);
        } catch (err) {
            setError(err);
        } finally {
            setLoadingMatches(false);
        }
    }, []);

    useEffect(() => {
        Promise.all([api('/meta'), api('/roommates/profile')])
            .then(([meta, p]) => {
                setDimensions(meta.lifestyleDimensions);
                // 默认值沿用原来的设计
                const filled = {
                    ...p,
                    studySchedule: p.studySchedule || 'Night Owl (Late)',
                    cleanliness: p.cleanliness || 'Moderate (Weekly)',
                    smoking: p.smoking || 'Non-Smoker',
                    discoverable: p.updatedAt && p.studySchedule ? p.discoverable : true,
                };
                setProfile(filled);
                if (verified && p.studySchedule && p.discoverable) loadMatches();
            })
            .catch(setError);
        loadRequests();
    }, [verified, loadMatches, loadRequests]);

    const getPillClass = (currentVal, targetVal) => {
        return currentVal === targetVal
            ? "bg-[#e2f5e9] text-[#168a48] border-[#86efac] border-2 px-5 py-2 rounded-full text-[14px] font-bold cursor-pointer transition-colors"
            : "bg-white text-gray-600 border-gray-200 border px-5 py-2 rounded-full text-[14px] font-medium cursor-pointer hover:border-gray-300 transition-colors";
    };

    const setHabit = (dim, value) => {
        // 可选项再次点击可取消
        const next = !dim.core && profile[dim.key] === value ? null : value;
        setProfile({ ...profile, [dim.key]: next });
    };

    const setWeight = (key, w) => setProfile({ ...profile, weights: { ...profile.weights, [key]: Number(w) } });

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        setNotice(null);
        try {
            const body = {
                ...Object.fromEntries(dimensions.map((d) => [d.key, profile[d.key] || null])),
                weights: profile.weights,
                smokeFreeOnly: profile.smokeFreeOnly,
                roommateGender: profile.roommateGender || 'SAME',
                budgetMin: profile.budgetMin === '' ? null : profile.budgetMin,
                budgetMax: profile.budgetMax === '' ? null : profile.budgetMax,
                moveInDate: profile.moveInDate || null,
                preferredArea: profile.preferredArea || null,
                discoverable: profile.discoverable,
            };
            const saved = await api('/roommates/profile', { method: 'PUT', body });
            setProfile({ ...profile, ...saved });
            if (!verified) {
                setNotice('Profile saved. You can see matches once your student status is verified.');
            } else if (!saved.discoverable) {
                setNotice('Profile saved. Your profile is hidden, so matching is paused.');
                setShowMatches(false);
            } else {
                await loadMatches();
            }
        } catch (err) {
            setError(err);
        } finally {
            setSaving(false);
        }
    };

    const handleConnect = async (match) => {
        setBusyId(match.user.id);
        setError(null);
        try {
            const r = await api('/roommates/requests', { method: 'POST', body: { recipientId: match.user.id } });
            setMatches(matches.map((m) => (m.user.id === match.user.id ? { ...m, request: { id: r.id, status: r.status, direction: r.direction } } : m)));
            loadRequests();
        } catch (err) {
            setError(err);
        } finally {
            setBusyId(null);
        }
    };

    const respond = async (req, action) => {
        setBusyId(req.id);
        setError(null);
        try {
            await api(`/roommates/requests/${req.id}`, { method: 'PATCH', body: { action } });
            await loadRequests();
            if (showMatches) await loadMatches();
            if (action === 'accept') setNotice(`You are now connected with ${req.user.name}. Say hi in Messages!`);
        } catch (err) {
            setError(err);
        } finally {
            setBusyId(null);
        }
    };

    const withdraw = async (requestId) => {
        setBusyId(requestId);
        try {
            await api(`/roommates/requests/${requestId}`, { method: 'DELETE' });
            await Promise.all([loadRequests(), loadMatches()]);
        } catch (err) {
            setError(err);
        } finally {
            setBusyId(null);
        }
    };

    const block = async (match) => {
        if (!window.confirm(`Block ${match.user.name}? They will no longer see you or be able to message you.`)) return;
        try {
            await api(`/blocks/${match.user.id}`, { method: 'POST' });
            setMatches(matches.filter((m) => m.user.id !== match.user.id));
        } catch (err) {
            setError(err);
        }
    };

    const incoming = requests.filter((r) => r.direction === 'received' && r.status === 'PENDING');

    const connectButton = (match) => {
        const r = match.request;
        const base = 'w-full font-bold py-2.5 rounded-lg transition cursor-pointer';
        if (r?.status === 'ACCEPTED') {
            return <button onClick={() => navigate('/student/messages')} className={`${base} bg-[#203569] text-white hover:bg-[#1a2b56]`}>💬 Message</button>;
        }
        if (r?.status === 'PENDING' && r.direction === 'received') {
            const req = requests.find((x) => x.id === r.id) || { id: r.id, user: match.user };
            return (
                <div className="flex gap-2">
                    <button disabled={busyId === r.id} onClick={() => respond(req, 'accept')} className={`${base} bg-[#15803d] text-white hover:bg-green-800`}>Accept</button>
                    <button disabled={busyId === r.id} onClick={() => respond(req, 'decline')} className={`${base} border border-gray-300 text-gray-600 hover:bg-gray-50`}>Decline</button>
                </div>
            );
        }
        if (r?.status === 'PENDING') {
            return (
                <button onClick={() => withdraw(r.id)} disabled={busyId === r.id} title="Click to withdraw" className={`${base} bg-gray-100 text-gray-400 border border-gray-200`}>
                    ✓ Request Sent
                </button>
            );
        }
        return (
            <button onClick={() => handleConnect(match)} disabled={busyId === match.user.id || !verified} className={`${base} border-2 border-[#203569] text-[#203569] hover:bg-blue-50 disabled:opacity-50`}>
                Connect
            </button>
        );
    };

    return (
        <div className="min-h-screen bg-[#f8f9fa] pb-20 font-sans">
            {/* 引入统一的全局悬浮导航栏 */}
            <Navbar />

            <div className="max-w-[1000px] w-[calc(100%-2rem)] mx-auto space-y-8">
                <VerificationBanner />
                <ErrorBanner error={error} />
                <SuccessBanner message={notice} />

                {/* 收到的室友请求 */}
                {incoming.length > 0 && (
                    <div className="bg-white shadow-[0_2px_10px_rgba(0,0,0,0.04)] rounded-xl overflow-hidden border border-gray-100">
                        <div className="bg-[#203569] text-white px-8 py-4">
                            <h2 className="text-[1.1rem] font-bold tracking-wide">Connection Requests ({incoming.length})</h2>
                        </div>
                        <div className="p-6 space-y-4">
                            {incoming.map((r, i) => (
                                <div key={r.id} className="border border-gray-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-4">
                                    <div className={`w-12 h-12 ${AVATAR_COLORS[i % AVATAR_COLORS.length]} rounded-full flex items-center justify-center font-bold text-lg flex-shrink-0`}>{r.user.initials}</div>
                                    <div className="flex-1">
                                        <h3 className="font-bold text-gray-900">{r.user.name} {r.score != null && <span className="text-[12px] text-[#a16207] font-bold ml-1">{r.score}% Match</span>}</h3>
                                        <p className="text-[13px] text-gray-500">{[r.user.academicYear, r.user.major].filter(Boolean).join(' • ')}</p>
                                        {r.message && <p className="text-[13px] text-gray-600 mt-1 italic">"{r.message}"</p>}
                                    </div>
                                    <div className="flex gap-2">
                                        <button disabled={busyId === r.id} onClick={() => respond(r, 'accept')} className="bg-[#15803d] text-white font-bold px-5 py-2 rounded-lg hover:bg-green-800 transition cursor-pointer disabled:opacity-50">Accept</button>
                                        <button disabled={busyId === r.id} onClick={() => respond(r, 'decline')} className="border border-gray-300 text-gray-600 font-bold px-5 py-2 rounded-lg hover:bg-gray-50 transition cursor-pointer disabled:opacity-50">Decline</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* 问卷表单卡片 */}
                <div className="bg-white shadow-[0_2px_10px_rgba(0,0,0,0.04)] rounded-xl overflow-hidden border border-gray-100">
                    <div className="bg-[#15803d] text-white px-8 py-4">
                        <h2 className="text-[1.1rem] font-bold tracking-wide">Lifestyle Profile Builder</h2>
                    </div>

                    {!profile ? <LoadingBlock /> : (
                    <div className="p-6 sm:p-8">
                        <h3 className="text-[1.1rem] font-bold text-[#1f2937] border-b border-gray-100 pb-4 mb-8">
                            Select your daily habits
                        </h3>

                        <div className="space-y-8">
                            {dimensions.map((dim) => (
                                <div key={dim.key}>
                                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                                        <p className="text-[15px] font-bold text-[#374151]">
                                            {dim.label} {!dim.core && <span className="text-[12px] text-gray-400 font-medium">(optional)</span>}
                                        </p>
                                        <label className="text-[12px] text-gray-500 font-bold flex items-center gap-2">
                                            Importance
                                            <select
                                                value={profile.weights?.[dim.key] || 1}
                                                onChange={(e) => setWeight(dim.key, e.target.value)}
                                                className="p-1.5 border border-gray-200 rounded-md text-[12px] outline-none focus:border-[#15803d] bg-white cursor-pointer"
                                            >
                                                {Object.entries(IMPORTANCE).map(([w, label]) => <option key={w} value={w}>{label}</option>)}
                                            </select>
                                        </label>
                                    </div>
                                    <div className="flex flex-wrap gap-3">
                                        {dim.options.map((opt) => (
                                            <button key={opt} type="button" aria-pressed={profile[dim.key] === opt} onClick={() => setHabit(dim, opt)} className={getPillClass(profile[dim.key], opt)}>
                                                {opt}
                                            </button>
                                        ))}
                                    </div>
                                    {dim.key === 'smoking' && (
                                        <label className="mt-3 flex items-center gap-2 text-[13px] text-gray-600 font-medium cursor-pointer">
                                            <input type="checkbox" checked={profile.smokeFreeOnly} onChange={(e) => setProfile({ ...profile, smokeFreeOnly: e.target.checked })} className="accent-[#15803d] w-4 h-4" />
                                            Deal-breaker: I only want a smoke-free home (smokers are hidden from my matches)
                                        </label>
                                    )}
                                </div>
                            ))}

                            {/* 室友性别偏好 */}
                            <div className="border-t border-gray-100 pt-8">
                                <p className="text-[15px] font-bold text-[#374151] mb-1">Roommate Gender</p>
                                <p className="text-[12px] text-gray-500 mb-3">
                                    {user?.gender
                                        ? <>You are registered as <strong>{GENDER_LABELS[user.gender]}</strong>. This is a filter, not part of the score.</>
                                        : <span className="text-[#b45309] font-bold">Set your gender in My Profile first — matching needs it.</span>}
                                </p>
                                <div className="flex flex-wrap gap-3">
                                    {[['SAME', 'Same gender only'], ['ANY', 'Any gender is fine']].map(([value, text]) => (
                                        <button key={value} type="button" aria-pressed={(profile.roommateGender || 'SAME') === value} onClick={() => setProfile({ ...profile, roommateGender: value })} className={getPillClass(profile.roommateGender || 'SAME', value)}>
                                            {text}
                                        </button>
                                    ))}
                                </div>
                                <p className="text-[11px] text-gray-400 mt-2">Students of another gender only appear if you <em>both</em> choose “Any gender is fine”.</p>
                            </div>

                            {/* 预算和入住时间 */}
                            <div className="border-t border-gray-100 pt-8 grid grid-cols-1 sm:grid-cols-3 gap-5">
                                <div>
                                    <label htmlFor="budgetMin" className="block text-[13px] font-bold text-[#374151] mb-1.5">Budget from (RM/month)</label>
                                    <input id="budgetMin" type="number" min="0" value={profile.budgetMin ?? ''} onChange={(e) => setProfile({ ...profile, budgetMin: e.target.value })} className="w-full p-2.5 border border-gray-300 rounded-lg outline-none focus:border-[#15803d] text-gray-800" placeholder="e.g. 300" />
                                </div>
                                <div>
                                    <label htmlFor="budgetMax" className="block text-[13px] font-bold text-[#374151] mb-1.5">Budget up to (RM/month)</label>
                                    <input id="budgetMax" type="number" min="0" value={profile.budgetMax ?? ''} onChange={(e) => setProfile({ ...profile, budgetMax: e.target.value })} className="w-full p-2.5 border border-gray-300 rounded-lg outline-none focus:border-[#15803d] text-gray-800" placeholder="e.g. 600" />
                                </div>
                                <div>
                                    <label htmlFor="moveIn" className="block text-[13px] font-bold text-[#374151] mb-1.5">Preferred move-in date</label>
                                    <input id="moveIn" type="date" value={profile.moveInDate ?? ''} onChange={(e) => setProfile({ ...profile, moveInDate: e.target.value })} className="w-full p-2.5 border border-gray-300 rounded-lg outline-none focus:border-[#15803d] text-gray-800" />
                                </div>
                            </div>

                            <label className="flex items-start gap-3 text-[14px] text-[#374151] font-bold cursor-pointer bg-[#f0fdf4] border border-[#dcfce7] rounded-lg p-4">
                                <input type="checkbox" checked={profile.discoverable} onChange={(e) => setProfile({ ...profile, discoverable: e.target.checked })} className="accent-[#15803d] w-4 h-4 mt-0.5" />
                                <span>
                                    Show my profile to other verified UTS students
                                    <span className="block text-[12px] text-gray-500 font-medium mt-0.5">Only your name, course, year and habit tags are shared. Untick at any time to pause discovery.</span>
                                </span>
                            </label>
                        </div>

                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="mt-10 bg-[#15803d] text-white font-bold py-3 px-6 rounded-lg hover:bg-green-800 transition shadow-sm cursor-pointer disabled:opacity-60"
                        >
                            {saving ? 'Saving...' : 'Save Profile & Find Matches'}
                        </button>
                    </div>
                    )}
                </div>

                {/* 匹配结果卡片 */}
                {(showMatches || loadingMatches) && (
                    <div className="bg-white shadow-[0_2px_10px_rgba(0,0,0,0.04)] rounded-xl p-6 sm:p-8 border border-gray-100 mt-8 animate-fade-in-up">
                        <h2 className="text-[1.3rem] font-bold text-[#1f2937] mb-2">Top Compatible Roommates</h2>
                        <p className="text-[12px] text-gray-500 mb-8">
                            Score = matching habits ÷ habits you both answered × 100%, weighted by the importance you chose. It's a guide, not a guarantee.
                            {matchMeta?.excludedByPreferences > 0 && ` ${matchMeta.excludedByPreferences} student(s) hidden by your budget, move-in date, gender preference or deal-breakers.`}
                        </p>

                        {loadingMatches ? <LoadingBlock text="Finding matches..." /> : matches.length === 0 ? (
                            <div className="h-40 flex flex-col items-center justify-center text-center">
                                <div className="text-4xl mb-3">🧑‍🤝‍🧑</div>
                                <p className="text-sm text-gray-500 font-bold">No compatible students yet. Check back later as more students join.</p>
                            </div>
                        ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            {matches.map((match, i) => (
                                <div key={match.user.id} className="border border-gray-200 rounded-xl p-6 relative bg-white hover:border-[#203569] transition-colors">
                                    <div className={`absolute -top-3.5 right-4 font-bold text-[13px] px-4 py-1.5 rounded-full border-[3px] border-white shadow-sm ${match.score >= 80 ? 'bg-[#fbbf24] text-[#78350f]' : 'bg-[#f3f4f6] text-[#4b5563]'}`}>
                                        {match.score}% Match
                                    </div>
                                    <div className="flex items-center gap-4 mb-5">
                                        <div className={`w-14 h-14 ${AVATAR_COLORS[i % AVATAR_COLORS.length]} rounded-full flex items-center justify-center font-bold text-xl`}>{match.user.initials}</div>
                                        <div>
                                            <h3 className="font-bold text-[1.1rem] text-gray-900">{match.user.name}</h3>
                                            <p className="text-[13px] text-gray-500 mt-0.5">
                                                {match.gender && <>{GENDER_LABELS[match.gender]}<span className="mx-1">•</span></>}
                                                {match.user.academicYear || 'UTS Student'} {match.user.major && <><span className="mx-1">•</span> {match.user.major}</>}
                                            </p>
                                        </div>
                                    </div>
                                    {match.bio && <p className="text-[13px] text-gray-600 mb-4 italic">"{match.bio}"</p>}
                                    <div className="border-t border-gray-100 pt-5 mb-6">
                                        <p className="text-[11px] font-bold text-gray-400 mb-3 uppercase tracking-wider">Shared Habits</p>
                                        <div className="flex flex-wrap gap-2">
                                            {match.breakdown.map((b) => (
                                                b.match ? (
                                                    <span key={b.key} className="bg-[#e2f5e9] text-[#168a48] text-[12px] font-bold px-2.5 py-1 rounded">{shortTag(b.key, b.theirs)}</span>
                                                ) : (
                                                    <span key={b.key} className="bg-[#fee2e2] text-[#b91c1c] text-[12px] font-bold px-2.5 py-1 rounded">{shortTag(b.key, b.theirs)} (Mismatch)</span>
                                                )
                                            ))}
                                        </div>
                                        {(match.budget.min != null || match.budget.max != null || match.moveInDate) && (
                                            <p className="text-[12px] text-gray-500 mt-3">
                                                {(match.budget.min != null || match.budget.max != null) && <>Budget RM {match.budget.min ?? 0}–{match.budget.max ?? 'any'}</>}
                                                {match.moveInDate && <> • Move-in {match.moveInDate}</>}
                                            </p>
                                        )}
                                    </div>

                                    {connectButton(match)}
                                    <div className="flex justify-center gap-4 mt-3">
                                        <button onClick={() => setReportUser(match.user)} className="text-[11px] font-bold text-gray-400 hover:text-[#e11d48] cursor-pointer">Report</button>
                                        <button onClick={() => block(match)} className="text-[11px] font-bold text-gray-400 hover:text-[#e11d48] cursor-pointer">Block</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                        )}
                    </div>
                )}
            </div>

            {reportUser && <ReportDialog targetType="USER" targetId={reportUser.id} label={reportUser.name} onClose={() => setReportUser(null)} />}
        </div>
    );
};

export default RoommateSearch;
