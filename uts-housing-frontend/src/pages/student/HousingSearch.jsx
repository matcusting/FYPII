import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../../components/Navbar';
import ListingReviews from '../../components/ListingReviews';
import { ErrorBanner, ReportDialog } from '../../components/ui';
import { api, assetUrl } from '../../lib/api';

const PAGE_SIZE = 10;

// 卡片上的标签：押金 / 家具 / 第一个设施
const tagsFor = (prop) => {
    const tags = [prop.deposit > 0 ? `Deposit: RM ${prop.deposit}` : 'No Deposit'];
    if (prop.furnished) tags.push('Fully Furnished');
    if (prop.facilities[0]) tags.push(prop.facilities[0]);
    return tags.slice(0, 3);
};

const HousingSearch = ({ savedOnly = false }) => {
    const navigate = useNavigate();
    const [meta, setMeta] = useState({ amenities: [], roomTypes: [] });

    // 筛选表单状态
    const [maxRent, setMaxRent] = useState(600);
    const [maxDistance, setMaxDistance] = useState('5');
    const [keyword, setKeyword] = useState('');
    const [roomType, setRoomType] = useState('');
    const [maxDeposit, setMaxDeposit] = useState('any');
    const [facilities, setFacilities] = useState([]);
    const [furnishedOnly, setFurnishedOnly] = useState(false);
    const [availableBy, setAvailableBy] = useState('');
    const [sort, setSort] = useState('newest');
    const [showSaved, setShowSaved] = useState(savedOnly);
    const [page, setPage] = useState(1);
    const [showMoreFilters, setShowMoreFilters] = useState(false);

    // 列表与交互状态
    const [displayProperties, setDisplayProperties] = useState([]);
    const [pageMeta, setPageMeta] = useState({ total: 0, totalPages: 0 });
    const [isFiltering, setIsFiltering] = useState(true);
    const [error, setError] = useState(null);

    // 当前选中查看详情的房源状态
    const [selectedProperty, setSelectedProperty] = useState(null);
    const [photoIndex, setPhotoIndex] = useState(0);
    const [composing, setComposing] = useState(false);
    const [inquiryText, setInquiryText] = useState('');
    const [sending, setSending] = useState(false);
    const [modalError, setModalError] = useState(null);
    const [reporting, setReporting] = useState(false);

    useEffect(() => {
        api('/meta').then(setMeta).catch(() => {});
    }, []);

    // 根据当前筛选条件请求房源（overrides 用于排序/收藏切换时立即生效）
    const fetchListings = ({ page: targetPage = 1, sort: sortBy = sort, saved = showSaved } = {}) =>
        api('/listings', {
            query: {
                q: keyword.trim(),
                maxRent: saved ? undefined : maxRent,
                maxDistance: saved || maxDistance === 'any' ? undefined : maxDistance,
                roomType,
                maxDeposit: maxDeposit === 'any' ? undefined : maxDeposit,
                amenities: facilities,
                furnished: furnishedOnly ? 'true' : undefined,
                availableBy,
                saved: saved ? 'true' : undefined,
                sort: sortBy,
                page: targetPage,
                limit: PAGE_SIZE,
            },
        }).then((res) => {
            setDisplayProperties(res.data);
            setPageMeta(res.meta);
            setPage(targetPage);
        }).catch(setError).finally(() => setIsFiltering(false));

    const applyFilters = (opts) => {
        setIsFiltering(true);
        setError(null);
        return fetchListings(opts);
    };

    // 首次加载
    useEffect(() => {
        fetchListings();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleApplyFilters = (e) => {
        e.preventDefault();
        applyFilters();
    };

    const changeSort = (value) => {
        setSort(value);
        applyFilters({ sort: value });
    };

    const changeSaved = (value) => {
        setShowSaved(value);
        applyFilters({ saved: value });
    };

    const resetFilters = () => {
        setMaxRent(1000); setMaxDistance('any'); setKeyword(''); setRoomType(''); setMaxDeposit('any');
        setFacilities([]); setFurnishedOnly(false); setAvailableBy(''); setShowSaved(false);
    };

    const toggleFacility = (f) => setFacilities(facilities.includes(f) ? facilities.filter((x) => x !== f) : [...facilities, f]);

    const openProperty = async (prop) => {
        setSelectedProperty(prop);
        setPhotoIndex(0);
        setComposing(false);
        setInquiryText(`Hi ${prop.landlord.name}, is "${prop.title}" still available?`);
        setModalError(null);
        // 获取最新详情（同时记录浏览次数）
        try {
            const fresh = await api(`/listings/${prop.id}`);
            setSelectedProperty((cur) => (cur && cur.id === fresh.id ? fresh : cur));
        } catch { /* keep list data */ }
    };

    // 收藏/取消收藏功能（阻止事件冒泡，避免触发详情弹窗）
    const toggleSaveProperty = async (e, prop) => {
        e.stopPropagation();
        const next = !prop.isSaved;
        const update = (p) => (p.id === prop.id ? { ...p, isSaved: next } : p);
        setDisplayProperties((list) => list.map(update));
        setSelectedProperty((cur) => (cur ? update(cur) : cur));
        try {
            await api(`/favorites/${prop.id}`, { method: next ? 'POST' : 'DELETE' });
            if (showSaved && !next) setDisplayProperties((list) => list.filter((p) => p.id !== prop.id));
        } catch (err) {
            const revert = (p) => (p.id === prop.id ? { ...p, isSaved: !next } : p);
            setDisplayProperties((list) => list.map(revert));
            setSelectedProperty((cur) => (cur ? revert(cur) : cur));
            setError(err);
        }
    };

    const sendInquiry = async () => {
        if (!inquiryText.trim()) return;
        setSending(true);
        setModalError(null);
        try {
            const { conversationId } = await api(`/listings/${selectedProperty.id}/inquiries`, { method: 'POST', body: { body: inquiryText } });
            navigate(`/student/messages?c=${conversationId}`);
        } catch (err) {
            setModalError(err);
        } finally {
            setSending(false);
        }
    };

    const photos = selectedProperty?.photos || [];

    return (
        <div className="min-h-screen bg-[#f8f9fa] pb-20 font-sans relative">
            <Navbar />

            <div className="max-w-[1000px] w-[calc(100%-2rem)] mx-auto mb-4 flex justify-between items-center">
                <button onClick={() => navigate('/student')} className="text-gray-500 hover:text-gray-800 font-bold text-sm flex items-center gap-1 transition-colors cursor-pointer">
                    ← Back to Dashboard
                </button>
                <label className="text-sm font-bold text-gray-600 flex items-center gap-2">
                    Sort by
                    <select value={sort} onChange={(e) => changeSort(e.target.value)} className="p-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-[#203569] text-gray-800 bg-white cursor-pointer">
                        <option value="newest">Newest</option>
                        <option value="rent_asc">Rent: Low to High</option>
                        <option value="rent_desc">Rent: High to Low</option>
                        <option value="distance">Distance to UTS</option>
                    </select>
                </label>
            </div>

            <div className="max-w-[1000px] w-[calc(100%-2rem)] mx-auto bg-white shadow-[0_2px_10px_rgba(0,0,0,0.04)] rounded-xl overflow-hidden border border-gray-100 flex flex-col md:flex-row min-h-[600px]">

                {/* 左侧：Filters 筛选面板 */}
                <div className="w-full md:w-[300px] bg-[#fcfcfd] border-b md:border-b-0 md:border-r border-gray-100 p-6 md:p-8 flex flex-col">
                    <h2 className="text-xl font-bold text-[#1f2937] mb-8">Filters</h2>

                    <form onSubmit={handleApplyFilters} className="flex-1 flex flex-col">
                        <div className="mb-6">
                            <label htmlFor="keyword" className="block text-[11px] font-bold text-[#4b5563] mb-3 uppercase tracking-wider">Search</label>
                            <input
                                id="keyword"
                                type="search"
                                value={keyword}
                                onChange={(e) => setKeyword(e.target.value)}
                                placeholder="Area, title or keyword"
                                className="w-full p-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:border-[#203569] text-gray-800 bg-white"
                            />
                        </div>

                        <div className="mb-8">
                            <label htmlFor="maxRent" className="block text-[11px] font-bold text-[#4b5563] mb-4 uppercase tracking-wider">Max Rent (RM)</label>
                            <input
                                id="maxRent"
                                type="range"
                                min="200" max="1000" step="50"
                                value={maxRent}
                                disabled={showSaved}
                                onChange={(e) => setMaxRent(e.target.value)}
                                className="w-full accent-[#e11d48] h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                            />
                            <div className="text-right text-sm text-[#4b5563] mt-3 font-medium">RM {maxRent}</div>
                        </div>

                        <div className="mb-8">
                            <label htmlFor="maxDistance" className="block text-[11px] font-bold text-[#4b5563] mb-3 uppercase tracking-wider">Distance to UTS</label>
                            <select
                                id="maxDistance"
                                value={maxDistance}
                                disabled={showSaved}
                                onChange={(e) => setMaxDistance(e.target.value)}
                                className="w-full p-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:border-[#203569] text-gray-800 bg-white cursor-pointer"
                            >
                                <option value="5">Less than 5 km</option>
                                <option value="2">Less than 2 km</option>
                                <option value="any">Any Distance</option>
                            </select>
                            <p className="text-[11px] text-gray-400 mt-1.5">Approximate straight-line distance, not driving distance.</p>
                        </div>

                        <button type="button" onClick={() => setShowMoreFilters(!showMoreFilters)} className="text-left text-[12px] font-bold text-[#203569] mb-6 cursor-pointer hover:underline" aria-expanded={showMoreFilters}>
                            {showMoreFilters ? '− Fewer filters' : '+ More filters (deposit, room type, facilities...)'}
                        </button>

                        {showMoreFilters && (
                            <>
                                <div className="mb-6">
                                    <label htmlFor="maxDeposit" className="block text-[11px] font-bold text-[#4b5563] mb-3 uppercase tracking-wider">Security Deposit</label>
                                    <select id="maxDeposit" value={maxDeposit} onChange={(e) => setMaxDeposit(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:border-[#203569] text-gray-800 bg-white cursor-pointer">
                                        <option value="any">Any Deposit</option>
                                        <option value="0">No Deposit</option>
                                        <option value="500">Up to RM 500</option>
                                        <option value="1000">Up to RM 1000</option>
                                    </select>
                                </div>

                                <div className="mb-6">
                                    <label htmlFor="roomType" className="block text-[11px] font-bold text-[#4b5563] mb-3 uppercase tracking-wider">Room Type</label>
                                    <select id="roomType" value={roomType} onChange={(e) => setRoomType(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:border-[#203569] text-gray-800 bg-white cursor-pointer">
                                        <option value="">Any Room Type</option>
                                        {meta.roomTypes.map((t) => <option key={t}>{t}</option>)}
                                    </select>
                                </div>

                                <div className="mb-6">
                                    <label htmlFor="availableBy" className="block text-[11px] font-bold text-[#4b5563] mb-3 uppercase tracking-wider">Available By</label>
                                    <input id="availableBy" type="date" value={availableBy} onChange={(e) => setAvailableBy(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:border-[#203569] text-gray-800 bg-white" />
                                </div>

                                <div className="mb-6">
                                    <p className="block text-[11px] font-bold text-[#4b5563] mb-3 uppercase tracking-wider">Facilities</p>
                                    <div className="flex flex-wrap gap-2">
                                        {meta.amenities.map((f) => (
                                            <button
                                                key={f}
                                                type="button"
                                                aria-pressed={facilities.includes(f)}
                                                onClick={() => toggleFacility(f)}
                                                className={facilities.includes(f)
                                                    ? 'bg-[#203569] text-white px-3 py-1.5 rounded-full text-[11px] font-bold cursor-pointer'
                                                    : 'bg-[#f3f4f6] text-gray-500 border border-gray-200 px-3 py-1.5 rounded-full text-[11px] font-bold hover:bg-gray-200 cursor-pointer'}
                                            >
                                                {facilities.includes(f) ? `✓ ${f}` : f}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <label className="mb-6 flex items-center gap-2 text-[13px] font-bold text-[#4b5563] cursor-pointer">
                                    <input type="checkbox" checked={furnishedOnly} onChange={(e) => setFurnishedOnly(e.target.checked)} className="accent-[#203569] w-4 h-4" />
                                    Fully furnished only
                                </label>
                            </>
                        )}

                        <label className="mb-8 flex items-center gap-2 text-[13px] font-bold text-[#e11d48] cursor-pointer">
                            <input type="checkbox" checked={showSaved} onChange={(e) => changeSaved(e.target.checked)} className="accent-[#e11d48] w-4 h-4" />
                            ❤️ Show my saved listings only
                        </label>

                        <div className="flex-1"></div>

                        <button
                            type="submit"
                            disabled={isFiltering}
                            className={`w-full font-bold py-3 rounded-lg transition shadow-sm flex justify-center items-center cursor-pointer ${isFiltering ? 'bg-[#1a2b56] text-gray-300 cursor-not-allowed' : 'bg-[#203569] text-white hover:bg-[#1a2b56]'}`}
                        >
                            {isFiltering ? 'Searching...' : 'Apply Filters'}
                        </button>
                    </form>
                </div>

                {/* 右侧：Listings 房源列表 */}
                <div className="flex-1 p-5 md:p-8 bg-white overflow-y-auto">
                    <h2 className="text-xl font-bold text-[#203569] mb-6" aria-live="polite">
                        {isFiltering ? 'Loading...' : showSaved ? `${pageMeta.total} Saved Listings` : `${pageMeta.total} Verified Listings`}
                    </h2>

                    <ErrorBanner error={error} className="mb-4" />

                    {!isFiltering && !error && displayProperties.length === 0 && (
                        <div className="h-64 flex flex-col items-center justify-center text-center">
                            <div className="text-4xl mb-4">{showSaved ? '🤍' : '🔍'}</div>
                            <h3 className="text-lg font-bold text-gray-800 mb-2">{showSaved ? 'No saved listings yet' : 'No properties found'}</h3>
                            <p className="text-sm text-gray-500">{showSaved ? 'Tap the heart on a listing to save it here.' : 'Try adjusting your filters to see more results.'}</p>
                            <button
                                onClick={resetFilters}
                                className="mt-4 text-[#e11d48] font-bold text-sm hover:underline cursor-pointer"
                            >
                                Reset Filters
                            </button>
                        </div>
                    )}

                    <div className="space-y-4 pb-6">
                        {!isFiltering && displayProperties.map(prop => (
                            <div
                                key={prop.id}
                                onClick={() => openProperty(prop)} // 点击整张卡片打开详情
                                onKeyDown={(e) => { if (e.key === 'Enter') openProperty(prop); }}
                                tabIndex={0}
                                role="button"
                                className="border border-gray-200 rounded-xl p-4 flex flex-col sm:flex-row gap-5 hover:shadow-md hover:border-[#203569] transition-all bg-white group relative cursor-pointer"
                            >
                                {/* 收藏/爱心按钮 */}
                                <button
                                    onClick={(e) => toggleSaveProperty(e, prop)}
                                    aria-label={prop.isSaved ? 'Remove from wishlist' : 'Save to wishlist'}
                                    className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors cursor-pointer"
                                >
                                    <svg
                                        className={`w-6 h-6 transition-colors ${prop.isSaved ? 'text-[#e11d48] fill-[#e11d48]' : 'text-gray-300 fill-transparent hover:text-gray-400'}`}
                                        xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"
                                    >
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                                    </svg>
                                </button>

                                {/* 房源图片 */}
                                {prop.photos[0] ? (
                                    <img src={assetUrl(prop.photos[0].url)} alt={prop.title} className="w-full sm:w-[140px] h-[160px] sm:h-[100px] object-cover rounded-lg flex-shrink-0" />
                                ) : (
                                    <div className="w-full sm:w-[140px] h-[100px] bg-[#e2e8f0] rounded-lg flex-shrink-0 flex items-center justify-center text-gray-400 font-bold text-sm group-hover:bg-[#cbd5e1] transition-colors">
                                        Image
                                    </div>
                                )}

                                <div className="flex-1 flex flex-col justify-center pr-8">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <h3 className="text-[1.1rem] font-bold text-[#203569] group-hover:text-blue-700 transition-colors">{prop.title}</h3>
                                            <p className="text-[13px] text-gray-500 mt-1">
                                                {prop.landlord.verified ? 'Verified Landlord' : 'Landlord'} <span className="mx-1">•</span> {prop.location ? '📍 ' : ''}{prop.distanceKm} km to UTS
                                                {prop.rating.count > 0 && <> <span className="mx-1">•</span> <span className="text-[#eab308] font-bold">★ {prop.rating.average}</span> ({prop.rating.count})</>}
                                            </p>
                                            {prop.isStale && <p className="text-[11px] text-[#a16207] font-bold mt-1">⚠ Availability not confirmed recently</p>}
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap gap-y-3 justify-between items-end mt-4">
                                        <div className="flex flex-wrap gap-2">
                                            {tagsFor(prop).map((tag, index) => (
                                                <span key={index} className="bg-[#f8f9fa] text-gray-600 text-[11px] font-bold px-2.5 py-1 rounded border border-gray-200">
                                                    {tag}
                                                </span>
                                            ))}
                                        </div>
                                        <div className="text-[1.1rem] font-bold text-[#16a34a]">RM {prop.rent}/mo</div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* 分页 */}
                    {!isFiltering && pageMeta.totalPages > 1 && (
                        <div className="flex justify-center items-center gap-3 pb-6">
                            <button disabled={page <= 1} onClick={() => applyFilters({ page: page - 1 })} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 cursor-pointer">← Prev</button>
                            <span className="text-sm font-bold text-gray-500">Page {page} of {pageMeta.totalPages}</span>
                            <button disabled={page >= pageMeta.totalPages} onClick={() => applyFilters({ page: page + 1 })} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 cursor-pointer">Next →</button>
                        </div>
                    )}
                </div>
            </div>

            {/* --- 房源完整详情弹窗 (Property Detail Modal) --- */}
            {selectedProperty && (
                <div
                    onClick={() => setSelectedProperty(null)}
                    className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in"
                >
                    <div
                        onClick={(e) => e.stopPropagation()} // 防止点击弹窗内部时关闭
                        role="dialog"
                        aria-modal="true"
                        aria-label={selectedProperty.title}
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-[650px] max-h-[92vh] overflow-y-auto border border-gray-100"
                    >
                        {/* 顶部大图区域 */}
                        <div className="h-[220px] bg-[#cbd5e1] relative flex items-center justify-center overflow-hidden">
                            {photos.length > 0 ? (
                                <img src={assetUrl(photos[photoIndex]?.url)} alt={`${selectedProperty.title} photo ${photoIndex + 1}`} className="w-full h-full object-cover" />
                            ) : (
                                <span className="text-gray-500 font-bold text-lg">Property Image Gallery</span>
                            )}

                            {photos.length > 1 && (
                                <>
                                    <button onClick={() => setPhotoIndex((photoIndex - 1 + photos.length) % photos.length)} aria-label="Previous photo" className="absolute left-4 top-1/2 -translate-y-1/2 w-9 h-9 bg-black/40 hover:bg-black/60 text-white rounded-full flex items-center justify-center font-bold transition cursor-pointer">‹</button>
                                    <button onClick={() => setPhotoIndex((photoIndex + 1) % photos.length)} aria-label="Next photo" className="absolute right-4 top-1/2 -translate-y-1/2 w-9 h-9 bg-black/40 hover:bg-black/60 text-white rounded-full flex items-center justify-center font-bold transition cursor-pointer">›</button>
                                    <span className="absolute bottom-4 right-6 bg-black/50 text-white text-xs font-bold px-2.5 py-1 rounded-md">{photoIndex + 1} / {photos.length}</span>
                                </>
                            )}

                            {/* 右上角关闭按钮 */}
                            <button
                                onClick={() => setSelectedProperty(null)}
                                aria-label="Close"
                                className="absolute top-4 right-4 w-9 h-9 bg-black/40 hover:bg-black/60 text-white rounded-full flex items-center justify-center font-bold text-xl transition cursor-pointer"
                            >
                                ×
                            </button>

                            {/* 左下角房型标签 */}
                            <span className="absolute bottom-4 left-6 bg-[#203569] text-white text-xs font-bold px-3 py-1.5 rounded-md shadow-sm">
                                {selectedProperty.roomType}
                            </span>
                        </div>

                        {/* 弹窗主体内容 */}
                        <div className="p-6 sm:p-8">
                            <div className="flex flex-col sm:flex-row gap-3 justify-between items-start border-b border-gray-100 pb-5 mb-6">
                                <div>
                                    <h2 className="text-2xl font-bold text-[#1f2937]">{selectedProperty.title}</h2>
                                    <p className="text-sm text-gray-500 mt-1 flex flex-wrap items-center gap-2">
                                        <span>Posted by <strong className="text-gray-800">{selectedProperty.landlord.name}</strong></span>
                                        {selectedProperty.landlord.verified && <span className="bg-[#dcfce7] text-[#15803d] text-[10px] font-bold px-2 py-0.5 rounded">✓ Verified</span>}
                                        <span>• {selectedProperty.distanceKm} km to UTS</span>
                                        {selectedProperty.approximateArea && <span>• {selectedProperty.approximateArea}</span>}
                                    </p>
                                </div>
                                <div className="sm:text-right">
                                    <div className="text-2xl font-bold text-[#16a34a]">RM {selectedProperty.rent}<span className="text-sm text-gray-500 font-normal">/mo</span></div>
                                    <div className="text-xs text-gray-400 font-medium mt-0.5">Deposit: RM {selectedProperty.deposit}</div>
                                </div>
                            </div>

                            {/* 可入住时间 / 状态 */}
                            <div className="mb-6 flex flex-wrap gap-2">
                                <span className="bg-[#eff6ff] text-[#1d4ed8] text-xs font-bold px-3 py-1.5 rounded-md">
                                    📅 {selectedProperty.availableFrom ? `Available from ${selectedProperty.availableFrom}` : 'Available now'}
                                </span>
                                {selectedProperty.furnished && <span className="bg-[#f0fdf4] text-[#15803d] text-xs font-bold px-3 py-1.5 rounded-md">🛋 Fully Furnished</span>}
                                <span className={`text-xs font-bold px-3 py-1.5 rounded-md ${selectedProperty.isStale ? 'bg-[#fefce8] text-[#a16207]' : 'bg-gray-100 text-gray-500'}`}>
                                    {selectedProperty.isStale ? '⚠ ' : ''}Availability confirmed {new Date(selectedProperty.lastConfirmedAt).toLocaleDateString()}
                                </span>
                            </div>

                            {/* 房源简介 */}
                            <div className="mb-6">
                                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">About this property</h4>
                                <p className="text-gray-600 text-sm leading-relaxed whitespace-pre-line">
                                    {selectedProperty.description || 'No description provided.'}
                                </p>
                            </div>

                            {selectedProperty.houseRules && (
                                <div className="mb-6">
                                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">House Rules</h4>
                                    <p className="text-gray-600 text-sm leading-relaxed whitespace-pre-line">{selectedProperty.houseRules}</p>
                                </div>
                            )}

                            {/* 配套设施列表 */}
                            <div className="mb-8">
                                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Included Facilities</h4>
                                <div className="flex flex-wrap gap-2.5">
                                    {selectedProperty.facilities.length === 0 && <span className="text-sm text-gray-500">None listed.</span>}
                                    {selectedProperty.facilities.map((fac, idx) => (
                                        <span key={idx} className="bg-[#f0f4f8] text-[#203569] text-xs font-bold px-3.5 py-1.5 rounded-full flex items-center gap-1.5">
                                            ✓ {fac}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            {/* 地图位置 (Google Maps) */}
                            {selectedProperty.location && (
                                <div className="mb-8">
                                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Location</h4>
                                    <div className="border border-gray-200 rounded-xl overflow-hidden">
                                        <iframe
                                            title={`Map of ${selectedProperty.title}`}
                                            src={selectedProperty.location.links.embed}
                                            className="w-full h-[220px] border-0"
                                            loading="lazy"
                                            referrerPolicy="no-referrer-when-downgrade"
                                        ></iframe>
                                        <div className="px-4 py-3 bg-[#fcfcfd] flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                                            <span className="text-[12px] text-gray-500">
                                                ≈ {selectedProperty.distanceKm} km straight-line to UTS. Approximate area shown — ask the landlord for the exact address.
                                            </span>
                                            <div className="flex gap-2 flex-shrink-0">
                                                <a href={selectedProperty.location.links.view} target="_blank" rel="noopener noreferrer" className="text-[12px] font-bold text-[#203569] border border-[#203569] px-3 py-1.5 rounded-md hover:bg-blue-50 transition">📍 Open in Google Maps</a>
                                                {selectedProperty.location.links.directions && (
                                                    <a href={selectedProperty.location.links.directions} target="_blank" rel="noopener noreferrer" className="text-[12px] font-bold text-white bg-[#203569] px-3 py-1.5 rounded-md hover:bg-[#1a2b56] transition">🧭 Directions to UTS</a>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* 学生评价 */}
                            <div className="mb-8">
                                <ListingReviews listingId={selectedProperty.id} landlordName={selectedProperty.landlord.name} />
                            </div>

                            <ErrorBanner error={modalError} className="mb-4" />

                            {/* 联系房东的消息输入 */}
                            {composing && (
                                <div className="mb-4">
                                    <label htmlFor="inquiry" className="block text-[13px] font-bold text-[#374151] mb-1.5">Message to {selectedProperty.landlord.name}</label>
                                    <textarea id="inquiry" rows="3" maxLength={2000} value={inquiryText} onChange={(e) => setInquiryText(e.target.value)} className="w-full p-3 border border-gray-300 rounded-xl outline-none focus:border-[#203569] text-gray-800 text-sm"></textarea>
                                    <p className="text-[11px] text-gray-400 mt-1">Your e-mail and phone stay private — the conversation happens in Messages.</p>
                                </div>
                            )}

                            {/* 底部操作按钮 */}
                            <div className="flex flex-col sm:flex-row gap-4 pt-4 border-t border-gray-100">
                                <button
                                    onClick={(e) => toggleSaveProperty(e, selectedProperty)}
                                    className={`px-5 py-3 rounded-xl font-bold text-sm border flex items-center justify-center gap-2 transition cursor-pointer ${selectedProperty.isSaved ? 'border-[#e11d48] text-[#e11d48] bg-pink-50' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                                >
                                    <span>{selectedProperty.isSaved ? '❤️ Saved' : '🤍 Save to Wishlist'}</span>
                                </button>

                                <button
                                    onClick={() => (composing ? sendInquiry() : setComposing(true))}
                                    disabled={sending}
                                    className="flex-1 bg-[#203569] hover:bg-[#1a2b56] text-white font-bold py-3 px-6 rounded-xl transition shadow-sm cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60"
                                >
                                    <span>{sending ? 'Sending...' : composing ? '✈ Send Message' : `💬 Contact Landlord (${selectedProperty.landlord.name})`}</span>
                                </button>
                            </div>
                            <div className="text-center mt-4">
                                <button onClick={() => setReporting(true)} className="text-[12px] font-bold text-gray-400 hover:text-[#e11d48] cursor-pointer">🚩 Report this listing</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {reporting && selectedProperty && (
                <ReportDialog targetType="LISTING" targetId={selectedProperty.id} label="Listing" onClose={() => setReporting(false)} />
            )}
        </div>
    );
};

export default HousingSearch;
