import { useEffect, useState } from 'react';
import { GENDER_RESTRICTION_OPTIONS, api, assetUrl, genderBadge, mapsSearchUrl, statusLabel } from '../../lib/api';
import { pickPhotos } from '../../lib/photos';
import { ErrorBanner, LoadingBlock } from '../../components/ui';

// Listings paused by the availability job can go back online with one click.
const isAutoPaused = (prop) => Boolean(prop.rejectionReason?.startsWith('Paused automatically'));

const STATUS_BADGE = {
    PUBLISHED: 'bg-[#dcfce7] text-[#15803d]',
    PENDING_REVIEW: 'bg-[#fefce8] text-[#a16207]',
    REJECTED: 'bg-[#fee2e2] text-[#b91c1c]',
    DRAFT: 'bg-[#eff6ff] text-[#1d4ed8]',
    PAUSED: 'bg-gray-200 text-gray-500',
    RENTED: 'bg-gray-200 text-gray-500',
};

const ManageListings = ({ myProperties, loading, reload, setActiveTab }) => {
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingProperty, setEditingProperty] = useState(null);
    const [amenities, setAmenities] = useState([]);
    const [roomTypes, setRoomTypes] = useState([]);
    const [busyId, setBusyId] = useState(null);
    const [error, setError] = useState(null);
    const [editError, setEditError] = useState(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        api('/meta').then((m) => { setAmenities(m.amenities); setRoomTypes(m.roomTypes); }).catch(() => {});
    }, []);

    const run = async (id, fn) => {
        setBusyId(id);
        setError(null);
        try {
            await fn();
            await reload();
        } catch (err) {
            setError(err);
        } finally {
            setBusyId(null);
        }
    };

    const setStatus = (prop, status) => run(prop.id, () => api(`/listings/${prop.id}/status`, { method: 'POST', body: { status } }));
    const submitForReview = (prop) => run(prop.id, () => api(`/listings/${prop.id}/submit`, { method: 'POST' }));
    const reconfirm = (prop) => run(prop.id, () => api(`/listings/${prop.id}/availability`, { method: 'POST' }));

    const handleDeleteProperty = (prop) => {
        if (!window.confirm(`Delete "${prop.title}"? Students will no longer see it.`)) return;
        run(prop.id, () => api(`/listings/${prop.id}`, { method: 'DELETE' }));
    };

    const handleEditClick = (prop) => {
        setEditingProperty({
            ...prop,
            newPhotos: [], description: prop.description || '', approximateArea: prop.approximateArea || '', address: prop.address || '', mapUrl: prop.mapUrl || '', houseRules: prop.houseRules || '', availableFrom: prop.availableFrom || '' });
        setEditError(null);
        setIsEditModalOpen(true);
    };

    const closeEdit = () => {
        editingProperty?.newPhotos.forEach((p) => URL.revokeObjectURL(p.preview));
        setIsEditModalOpen(false);
        setEditingProperty(null);
    };

    const handleEditImageUpload = (e) => {
        const { ok, error: err } = pickPhotos(e.target.files, editingProperty.photos.length + editingProperty.newPhotos.length);
        setEditingProperty({ ...editingProperty, newPhotos: [...editingProperty.newPhotos, ...ok] });
        setEditError(err ? { message: err } : null);
        e.target.value = '';
    };

    const removeExistingPhoto = async (photo) => {
        setEditError(null);
        try {
            const updated = await api(`/listings/${editingProperty.id}/photos/${photo.id}`, { method: 'DELETE' });
            setEditingProperty({ ...editingProperty, photos: updated.photos });
            reload();
        } catch (err) {
            setEditError(err);
        }
    };

    const toggleFacility = (f) => {
        const list = editingProperty.facilities;
        setEditingProperty({ ...editingProperty, facilities: list.includes(f) ? list.filter((x) => x !== f) : [...list, f] });
    };

    const handleEditSave = async (e) => {
        e.preventDefault();
        setSaving(true);
        setEditError(null);
        const p = editingProperty;
        try {
            await api(`/listings/${p.id}`, {
                method: 'PATCH',
                body: {
                    title: p.title,
                    description: p.description,
                    rent: Number(p.rent),
                    deposit: Number(p.deposit) || 0,
                    distanceKm: Number(p.distanceKm),
                    roomType: p.roomType,
                    approximateArea: p.approximateArea || null,
                    address: p.address.trim() || null,
                    mapUrl: p.mapUrl.trim() || null,
                    availableFrom: p.availableFrom || null,
                    houseRules: p.houseRules || null,
                    furnished: p.furnished,
                    genderRestriction: p.genderRestriction || 'ANY',
                    facilities: p.facilities,
                },
            });
            if (p.newPhotos.length) {
                const form = new FormData();
                p.newPhotos.forEach((ph) => form.append('photos', ph.file));
                await api(`/listings/${p.id}/photos`, { method: 'POST', form });
            }
            await reload();
            closeEdit();
        } catch (err) {
            setEditError(err);
        } finally {
            setSaving(false);
        }
    };

    const btn = 'border border-gray-300 text-[#334155] text-[12px] font-bold px-4 py-1.5 rounded bg-white hover:bg-gray-50 transition cursor-pointer disabled:opacity-50';

    const actionsFor = (prop) => {
        const busy = busyId === prop.id;
        const list = [<button key="edit" disabled={busy} onClick={() => handleEditClick(prop)} className={btn}>Edit Details</button>];
        if (prop.status === 'PAUSED' && isAutoPaused(prop)) {
            list.push(<button key="confirm" disabled={busy} onClick={() => reconfirm(prop)} className="border border-[#bfdbfe] text-[#1d4ed8] text-[12px] font-bold px-4 py-1.5 rounded bg-[#eff6ff] hover:bg-blue-100 transition cursor-pointer">Confirm Still Available</button>);
            list.push(<button key="rent" disabled={busy} onClick={() => setStatus(prop, 'RENTED')} className={btn}>Mark as Rented</button>);
        } else if (prop.status === 'PUBLISHED') {
            list.push(<button key="rent" disabled={busy} onClick={() => setStatus(prop, 'RENTED')} className={btn}>Mark as Rented</button>);
            list.push(<button key="pause" disabled={busy} onClick={() => setStatus(prop, 'PAUSED')} className={btn}>Pause</button>);
            if (prop.isStale) list.push(<button key="confirm" disabled={busy} onClick={() => reconfirm(prop)} className="border border-[#bfdbfe] text-[#1d4ed8] text-[12px] font-bold px-4 py-1.5 rounded bg-[#eff6ff] hover:bg-blue-100 transition cursor-pointer">Confirm Still Available</button>);
        } else if (prop.status === 'RENTED' || (prop.status === 'PAUSED' && prop.publishedAt && !prop.rejectionReason)) {
            list.push(<button key="relist" disabled={busy} onClick={() => setStatus(prop, 'PUBLISHED')} className={btn}>Re-list Property</button>);
        } else if (['DRAFT', 'REJECTED', 'PAUSED'].includes(prop.status)) {
            list.push(<button key="submit" disabled={busy} onClick={() => submitForReview(prop)} className="border border-[#203569] text-[#203569] text-[12px] font-bold px-4 py-1.5 rounded bg-white hover:bg-blue-50 transition cursor-pointer">Submit for Review</button>);
        }
        list.push(<button key="del" disabled={busy} onClick={() => handleDeleteProperty(prop)} className="border border-red-200 text-red-600 text-[12px] font-bold px-3 py-1.5 rounded bg-white hover:bg-red-50 transition cursor-pointer">Delete</button>);
        return list;
    };

    return (
        <div className="p-5 sm:p-10 overflow-y-auto animate-fade-in-up">
            <div className="flex justify-between items-center border-b border-gray-100 pb-4 mb-8 max-w-4xl">
                <h2 className="text-[1.4rem] font-bold text-[#0f172a]">Manage Properties</h2>
                <button
                    onClick={() => setActiveTab('add')}
                    className="bg-[#203569] text-white text-xs font-bold px-4 py-2.5 rounded-lg hover:bg-[#1a2b56] transition cursor-pointer"
                >
                    + Add New Property
                </button>
            </div>

            <ErrorBanner error={error} className="mb-5 max-w-4xl" />
            {loading && <LoadingBlock />}
            {!loading && myProperties.length === 0 && (
                <p className="text-sm text-gray-400 font-bold">You have no listings yet. Click “Add New Property” to create one.</p>
            )}

            <div className="space-y-5 max-w-4xl">
                {myProperties.map(prop => {
                    const active = prop.status === 'PUBLISHED';
                    return (
                    <div key={prop.id} className={`border ${active ? 'border-gray-200 bg-white shadow-sm' : 'border-gray-100 bg-[#f8f9fa]'} rounded-xl p-5 flex flex-col-reverse sm:flex-row gap-4 justify-between items-start transition-all duration-300`}>
                        <div className={`flex flex-col sm:flex-row gap-6 ${prop.status === 'RENTED' ? 'opacity-60' : ''}`}>

                            {prop.photos[0] ? (
                                <div className="w-full sm:w-[140px] h-[110px] rounded-lg overflow-hidden flex-shrink-0 border border-gray-200 relative">
                                    <img src={assetUrl(prop.photos[0].url)} alt={prop.title} className="w-full h-full object-cover" />
                                    <span className="absolute bottom-1 left-1 bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded">
                                        {prop.roomType}
                                    </span>
                                </div>
                            ) : (
                                <div className={`w-full sm:w-[140px] h-[110px] rounded-lg flex flex-col items-center justify-center font-bold text-sm flex-shrink-0 transition-colors ${active ? 'bg-[#cbd5e1] text-[#475569]' : 'bg-[#e2e8f0] text-gray-400'}`}>
                                    <span>Image</span>
                                    <span className="text-[10px] font-normal mt-1">{prop.roomType}</span>
                                </div>
                            )}

                            <div className="flex flex-col justify-center">
                                <h3 className={`text-[1.15rem] font-bold mb-1 ${active ? 'text-[#1e3a8a]' : 'text-gray-500'}`}>{prop.title}</h3>
                                <p className={`text-[13px] mb-2 ${active ? 'text-[#64748b]' : 'text-gray-400'}`}>
                                    RM {prop.rent}/mo • Deposit: RM {prop.deposit} • {prop.distanceKm} km to UTS • 👁 {prop.viewCount} views
                                    {prop.rating.count > 0 && <> • <span className="text-[#eab308] font-bold">★ {prop.rating.average}</span></>}
                                </p>

                                {prop.address && (
                                    <a href={prop.googleMapsUrl} target="_blank" rel="noopener noreferrer" className="text-[12px] text-[#1d4ed8] font-bold hover:underline mb-2 break-words">📍 {prop.address}</a>
                                )}
                                {prop.status === 'REJECTED' && prop.rejectionReason && (
                                    <p className="text-[12px] text-[#b91c1c] font-bold mb-2">Admin feedback: {prop.rejectionReason}</p>
                                )}
                                {prop.status === 'PAUSED' && prop.rejectionReason && (
                                    <p className={`text-[12px] font-bold mb-2 ${isAutoPaused(prop) ? 'text-[#a16207]' : 'text-[#b91c1c]'}`}>
                                        {prop.rejectionReason}{isAutoPaused(prop) && ' Click “Confirm Still Available” to put it back online.'}
                                    </p>
                                )}
                                {prop.status === 'PENDING_REVIEW' && (
                                    <p className="text-[12px] text-[#a16207] font-bold mb-2">Waiting for an administrator to approve this listing.</p>
                                )}
                                {active && prop.isStale && (
                                    <p className="text-[12px] text-[#1d4ed8] font-bold mb-2">Students see a warning until you confirm this room is still available.</p>
                                )}

                                <div className="flex flex-wrap gap-1.5 mb-4">
                                    {genderBadge(prop.genderRestriction) && <span className="bg-[#fdf2f8] text-[#be185d] text-[10px] font-bold px-2 py-0.5 rounded">{genderBadge(prop.genderRestriction)}</span>}
                                    {prop.facilities && prop.facilities.map((fac, idx) => (
                                        <span key={idx} className="bg-gray-100 text-gray-600 text-[10px] font-bold px-2 py-0.5 rounded">
                                            {fac}
                                        </span>
                                    ))}
                                </div>

                                <div className="flex flex-wrap gap-3">{actionsFor(prop)}</div>
                            </div>
                        </div>
                        <div className={`${STATUS_BADGE[prop.status] || 'bg-gray-200 text-gray-500'} text-[12px] font-bold px-3 py-1.5 rounded flex items-center gap-2 transition-colors whitespace-nowrap`}>
                            {active && <div className="w-2 h-2 bg-[#15803d] rounded-full"></div>} {statusLabel(prop.status)}
                        </div>
                    </div>
                    );
                })}
            </div>

            {/* 编辑房源详情弹窗 */}
            {isEditModalOpen && editingProperty && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div role="dialog" aria-modal="true" aria-label="Edit Property Details" className="bg-white rounded-xl shadow-2xl w-full max-w-[560px] max-h-[92vh] flex flex-col overflow-hidden">
                        <div className="bg-[#0f172a] px-6 py-4 flex justify-between items-center flex-shrink-0">
                            <h3 className="text-white font-bold text-[1.1rem]">Edit Property Details</h3>
                            <button onClick={closeEdit} aria-label="Close" className="text-gray-400 hover:text-white text-xl leading-none font-bold cursor-pointer">×</button>
                        </div>
                        <form onSubmit={handleEditSave} className="p-6 space-y-4 overflow-y-auto">
                            <ErrorBanner error={editError} />
                            {['PUBLISHED', 'REJECTED'].includes(editingProperty.status) && (
                                <p className="text-[12px] text-[#a16207] bg-[#fefce8] border border-[#fef08a] rounded-md px-3 py-2 font-bold">
                                    Saving changes sends this listing back to the admin for a quick re-check.
                                </p>
                            )}
                            <div>
                                <label className="block text-[13px] font-bold text-[#374151] mb-1.5">Property Photos</label>
                                <div className="flex flex-wrap items-center gap-3">
                                    {editingProperty.photos.map((ph) => (
                                        <div key={ph.id} className="relative group">
                                            <img src={assetUrl(ph.url)} alt="Listing" className="w-20 h-16 object-cover rounded-lg border border-gray-200" />
                                            <button type="button" onClick={() => removeExistingPhoto(ph)} aria-label="Remove photo" className="absolute -top-2 -right-2 w-5 h-5 bg-red-600 text-white rounded-full text-xs font-bold leading-none cursor-pointer">×</button>
                                        </div>
                                    ))}
                                    {editingProperty.newPhotos.map((ph) => (
                                        <img key={ph.preview} src={ph.preview} alt="New upload" className="w-20 h-16 object-cover rounded-lg border-2 border-[#1d4ed8]" />
                                    ))}
                                    {editingProperty.photos.length + editingProperty.newPhotos.length === 0 && (
                                        <div className="w-20 h-16 bg-gray-200 rounded-lg flex items-center justify-center text-xs text-gray-500 font-bold">No Image</div>
                                    )}
                                    <label className="border border-gray-300 text-gray-700 text-xs font-bold px-3 py-2 rounded-md cursor-pointer hover:bg-gray-50 transition">
                                        Upload New Photo
                                        <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={handleEditImageUpload} className="hidden" />
                                    </label>
                                </div>
                            </div>

                            <div>
                                <label htmlFor="e-title" className="block text-[13px] font-bold text-[#374151] mb-1">Listing Title</label>
                                <input id="e-title" type="text" required minLength={5} value={editingProperty.title} onChange={(e) => setEditingProperty({...editingProperty, title: e.target.value})} className="w-full p-2.5 border border-gray-300 rounded-md outline-none focus:border-[#1d4ed8] text-gray-800" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="e-rent" className="block text-[13px] font-bold text-[#374151] mb-1">Monthly Rent (RM)</label>
                                    <input id="e-rent" type="number" required min="1" step="0.01" value={editingProperty.rent} onChange={(e) => setEditingProperty({...editingProperty, rent: e.target.value})} className="w-full p-2.5 border border-gray-300 rounded-md outline-none focus:border-[#1d4ed8] text-gray-800" />
                                </div>
                                <div>
                                    <label htmlFor="e-dep" className="block text-[13px] font-bold text-[#374151] mb-1">Security Deposit (RM)</label>
                                    <input id="e-dep" type="number" required min="0" step="0.01" value={editingProperty.deposit ?? 0} onChange={(e) => setEditingProperty({...editingProperty, deposit: e.target.value})} className="w-full p-2.5 border border-gray-300 rounded-md outline-none focus:border-[#1d4ed8] text-gray-800" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="e-dist" className="block text-[13px] font-bold text-[#374151] mb-1">Distance (km)</label>
                                    <input id="e-dist" type="number" step="0.1" min="0" required value={editingProperty.distanceKm} onChange={(e) => setEditingProperty({...editingProperty, distanceKm: e.target.value})} className="w-full p-2.5 border border-gray-300 rounded-md outline-none focus:border-[#1d4ed8] text-gray-800" />
                                </div>
                                <div>
                                    <label htmlFor="e-type" className="block text-[13px] font-bold text-[#374151] mb-1">Room Type</label>
                                    <select id="e-type" value={editingProperty.roomType} onChange={(e) => setEditingProperty({...editingProperty, roomType: e.target.value})} className="w-full p-2.5 border border-gray-300 rounded-md outline-none focus:border-[#1d4ed8] text-gray-800 bg-white">
                                        {roomTypes.map((t) => <option key={t}>{t}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label htmlFor="e-address" className="block text-[13px] font-bold text-[#374151] mb-1">📍 Property Address</label>
                                <input id="e-address" type="text" required minLength={5} maxLength={200} value={editingProperty.address} onChange={(e) => setEditingProperty({...editingProperty, address: e.target.value})} className="w-full p-2.5 border border-gray-300 rounded-md outline-none focus:border-[#1d4ed8] text-gray-800" />
                                {editingProperty.address.trim().length >= 5 && (
                                    <a href={mapsSearchUrl(editingProperty.address)} target="_blank" rel="noopener noreferrer" className="text-[12px] font-bold text-[#1d4ed8] hover:underline">Check it on Google Maps ↗</a>
                                )}
                            </div>
                            <div>
                                <label htmlFor="e-mapurl" className="block text-[13px] font-bold text-[#374151] mb-1">Google Maps Link <span className="text-gray-400 font-medium">(optional)</span></label>
                                <input id="e-mapurl" type="url" maxLength={2000} placeholder="https://maps.app.goo.gl/..." value={editingProperty.mapUrl} onChange={(e) => setEditingProperty({...editingProperty, mapUrl: e.target.value})} className="w-full p-2.5 border border-gray-300 rounded-md outline-none focus:border-[#1d4ed8] text-gray-800" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="e-area" className="block text-[13px] font-bold text-[#374151] mb-1">Area</label>
                                    <input id="e-area" type="text" maxLength={120} value={editingProperty.approximateArea} onChange={(e) => setEditingProperty({...editingProperty, approximateArea: e.target.value})} className="w-full p-2.5 border border-gray-300 rounded-md outline-none focus:border-[#1d4ed8] text-gray-800" />
                                </div>
                                <div>
                                    <label htmlFor="e-avail" className="block text-[13px] font-bold text-[#374151] mb-1">Available From</label>
                                    <input id="e-avail" type="date" value={editingProperty.availableFrom} onChange={(e) => setEditingProperty({...editingProperty, availableFrom: e.target.value})} className="w-full p-2.5 border border-gray-300 rounded-md outline-none focus:border-[#1d4ed8] text-gray-800" />
                                </div>
                            </div>
                            <div>
                                <label htmlFor="e-desc" className="block text-[13px] font-bold text-[#374151] mb-1">Description</label>
                                <textarea id="e-desc" rows="3" maxLength={3000} value={editingProperty.description} onChange={(e) => setEditingProperty({...editingProperty, description: e.target.value})} className="w-full p-2.5 border border-gray-300 rounded-md outline-none focus:border-[#1d4ed8] text-gray-800"></textarea>
                            </div>
                            <div>
                                <label htmlFor="e-rules" className="block text-[13px] font-bold text-[#374151] mb-1">House Rules</label>
                                <textarea id="e-rules" rows="2" maxLength={1000} value={editingProperty.houseRules} onChange={(e) => setEditingProperty({...editingProperty, houseRules: e.target.value})} className="w-full p-2.5 border border-gray-300 rounded-md outline-none focus:border-[#1d4ed8] text-gray-800"></textarea>
                            </div>
                            <div>
                                <label htmlFor="e-gender" className="block text-[13px] font-bold text-[#374151] mb-1">Who can rent this property?</label>
                                <select id="e-gender" value={editingProperty.genderRestriction || 'ANY'} onChange={(e) => setEditingProperty({ ...editingProperty, genderRestriction: e.target.value })} className="w-full p-2.5 border border-gray-300 rounded-md outline-none focus:border-[#1d4ed8] text-gray-800 bg-white">
                                    {GENDER_RESTRICTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </div>
                            <label className="flex items-center gap-2 text-[13px] font-bold text-[#374151] cursor-pointer">
                                <input type="checkbox" checked={editingProperty.furnished} onChange={(e) => setEditingProperty({ ...editingProperty, furnished: e.target.checked })} className="accent-[#1d4ed8] w-4 h-4" />
                                Fully furnished
                            </label>
                            <div>
                                <p className="block text-[13px] font-bold text-[#374151] mb-2">Facilities</p>
                                <div className="flex flex-wrap gap-2">
                                    {amenities.map((f) => {
                                        const on = editingProperty.facilities.includes(f);
                                        return (
                                            <button key={f} type="button" aria-pressed={on} onClick={() => toggleFacility(f)}
                                                className={on ? 'bg-[#1d4ed8] text-white px-3 py-1.5 rounded-full text-[11px] font-bold cursor-pointer' : 'bg-[#f3f4f6] text-gray-500 border border-gray-200 px-3 py-1.5 rounded-full text-[11px] font-bold hover:bg-gray-200 cursor-pointer'}>
                                                {on ? `✓ ${f}` : `+ ${f}`}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                            <div className="pt-4 mt-2 flex justify-end gap-3 border-t border-gray-100">
                                <button type="button" onClick={closeEdit} className="px-5 py-2.5 text-gray-600 font-bold hover:bg-gray-100 rounded-md transition cursor-pointer">Cancel</button>
                                <button type="submit" disabled={saving} className="px-6 py-2.5 bg-[#1d4ed8] text-white font-bold rounded-md hover:bg-blue-800 transition shadow-sm cursor-pointer disabled:opacity-60">{saving ? 'Saving...' : 'Save Changes'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ManageListings;
