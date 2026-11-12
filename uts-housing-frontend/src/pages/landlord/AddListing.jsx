import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { ErrorBanner, FieldError } from '../../components/ui';
import { MAX_PHOTOS, pickPhotos } from '../../lib/photos';


const AddListing = ({ onCreated }) => {
    const [meta, setMeta] = useState({ amenities: [], roomTypes: [] });
    const [newTitle, setNewTitle] = useState('');
    const [newDescription, setNewDescription] = useState('');
    const [newRent, setNewRent] = useState('');
    const [newDeposit, setNewDeposit] = useState('');
    const [newDistance, setNewDistance] = useState('');
    const [newArea, setNewArea] = useState('');
    const [newRoomType, setNewRoomType] = useState('Whole Apartment');
    const [availableFrom, setAvailableFrom] = useState('');
    const [furnished, setFurnished] = useState(true);
    const [houseRules, setHouseRules] = useState('');
    const [selectedFacilities, setSelectedFacilities] = useState(['High-Speed Wi-Fi', 'Air Conditioning']);
    const [photos, setPhotos] = useState([]);
    const [isPublishing, setIsPublishing] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        api('/meta').then(setMeta).catch(() => {});
    }, []);

    const handleImageUpload = (e) => {
        const { ok, error: err } = pickPhotos(e.target.files, photos.length);
        setPhotos([...photos, ...ok]);
        setError(err ? { message: err } : null);
        e.target.value = '';
    };

    const removePhoto = (i) => {
        URL.revokeObjectURL(photos[i].preview);
        setPhotos(photos.filter((_, idx) => idx !== i));
    };

    const toggleFacility = (facility) => {
        if (selectedFacilities.includes(facility)) {
            setSelectedFacilities(selectedFacilities.filter(f => f !== facility));
        } else {
            setSelectedFacilities([...selectedFacilities, facility]);
        }
    };

    const handlePublish = async (e) => {
        e.preventDefault();
        setError(null);
        if (photos.length === 0) {
            setError({ message: 'Add at least one photo — listings without photos cannot be published.' });
            return;
        }
        setIsPublishing(true);
        let created = null;
        try {
            // 1. 创建草稿  2. 上传照片  3. 提交管理员审核
            created = await api('/listings', {
                method: 'POST',
                body: {
                    title: newTitle,
                    description: newDescription,
                    rent: Number(newRent),
                    deposit: Number(newDeposit) || 0,
                    distanceKm: Number(newDistance),
                    approximateArea: newArea || null,
                    roomType: newRoomType,
                    availableFrom: availableFrom || null,
                    furnished,
                    houseRules: houseRules || null,
                    facilities: selectedFacilities,
                },
            });
            const form = new FormData();
            photos.forEach((p) => form.append('photos', p.file));
            await api(`/listings/${created.id}/photos`, { method: 'POST', form });
            await api(`/listings/${created.id}/submit`, { method: 'POST' });
            photos.forEach((p) => URL.revokeObjectURL(p.preview));
            onCreated();
        } catch (err) {
            if (created) err.message = `${err.message} Your listing was saved as a draft — open Manage Listings to finish it.`;
            setError(err);
        } finally {
            setIsPublishing(false);
        }
    };

    return (
        <form onSubmit={handlePublish} className="p-5 sm:p-10 overflow-y-auto animate-fade-in-up">
            <h2 className="text-[1.4rem] font-bold text-[#0f172a] border-b border-gray-100 pb-4 mb-6">Publish a New Listing</h2>
            <div className="space-y-6 max-w-3xl">
                <ErrorBanner error={error} />

                <div>
                    <label htmlFor="title" className="block text-[13px] font-bold text-[#374151] mb-2">Listing Title</label>
                    <input
                        id="title"
                        type="text"
                        required
                        minLength={5}
                        maxLength={120}
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        placeholder="e.g., Master Room at Taman Universiti"
                        className="w-full p-3 border border-gray-300 rounded-md outline-none focus:border-[#203569] text-gray-800"
                    />
                    <FieldError error={error} name="title" />
                </div>

                {/* 房屋照片上传与预览组件 */}
                <div>
                    <label className="block text-[13px] font-bold text-[#374151] mb-2">Property Photos <span className="text-gray-400 font-medium">({photos.length}/{MAX_PHOTOS}, at least 1)</span></label>
                    {photos.length === 0 ? (
                        <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer bg-[#f8f9fa] hover:bg-gray-100 hover:border-[#203569] transition-all">
                            <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                <span className="text-3xl mb-2">📷</span>
                                <p className="mb-1 text-sm text-gray-600 font-bold">Click to upload property photos</p>
                                <p className="text-xs text-gray-400">Supports JPG, PNG, WEBP (Max 5MB each, up to {MAX_PHOTOS})</p>
                            </div>
                            <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={handleImageUpload} className="hidden" />
                        </label>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {photos.map((p, i) => (
                                <div key={p.preview} className="relative h-32 rounded-xl overflow-hidden border border-gray-200 shadow-sm group">
                                    <img src={p.preview} alt={`Property preview ${i + 1}`} className="w-full h-full object-cover" />
                                    {i === 0 && <span className="absolute top-2 left-2 bg-[#203569] text-white text-[10px] font-bold px-2 py-0.5 rounded">Cover</span>}
                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                        <button
                                            type="button"
                                            onClick={() => removePhoto(i)}
                                            className="bg-red-600 text-white text-xs font-bold px-4 py-2 rounded-lg cursor-pointer hover:bg-red-700 transition shadow"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {photos.length < MAX_PHOTOS && (
                                <label className="h-32 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-xl cursor-pointer bg-[#f8f9fa] hover:bg-gray-100 hover:border-[#203569] transition-all text-sm font-bold text-gray-500">
                                    <span className="text-2xl">＋</span> Add Photo
                                    <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={handleImageUpload} className="hidden" />
                                </label>
                            )}
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div>
                        <label htmlFor="rent" className="block text-[13px] font-bold text-[#374151] mb-2">Monthly Rent (RM)</label>
                        <input
                            id="rent"
                            type="number"
                            required
                            min="1"
                            step="0.01"
                            value={newRent}
                            onChange={(e) => setNewRent(e.target.value)}
                            placeholder="0.00"
                            className="w-full p-3 border border-gray-300 rounded-md outline-none focus:border-[#203569]"
                        />
                        <FieldError error={error} name="rent" />
                    </div>
                    <div>
                        <label htmlFor="deposit" className="block text-[13px] font-bold text-[#374151] mb-2">Security Deposit (RM)</label>
                        <input
                            id="deposit"
                            type="number"
                            min="0"
                            step="0.01"
                            value={newDeposit}
                            onChange={(e) => setNewDeposit(e.target.value)}
                            placeholder="0.00"
                            className="w-full p-3 border border-gray-300 rounded-md outline-none focus:border-[#203569]"
                        />
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div>
                        <label htmlFor="distance" className="block text-[13px] font-bold text-[#374151] mb-2">Distance to UTS (km)</label>
                        <input
                            id="distance"
                            type="number"
                            step="0.1"
                            min="0"
                            required
                            value={newDistance}
                            onChange={(e) => setNewDistance(e.target.value)}
                            placeholder="e.g., 1.5"
                            className="w-full p-3 border border-gray-300 rounded-md outline-none focus:border-[#203569]"
                        />
                    </div>
                    <div>
                        <label htmlFor="roomType" className="block text-[13px] font-bold text-[#374151] mb-2">Room Type</label>
                        <select
                            id="roomType"
                            value={newRoomType}
                            onChange={(e) => setNewRoomType(e.target.value)}
                            className="w-full p-3 border border-gray-300 rounded-md outline-none focus:border-[#203569] text-gray-800 bg-white"
                        >
                            {(meta.roomTypes.length ? meta.roomTypes : ['Whole Apartment', 'Single Room', 'Master Room', 'Shared Room']).map((t) => <option key={t}>{t}</option>)}
                        </select>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div>
                        <label htmlFor="area" className="block text-[13px] font-bold text-[#374151] mb-2">Area / Neighbourhood</label>
                        <input id="area" type="text" maxLength={120} value={newArea} onChange={(e) => setNewArea(e.target.value)} placeholder="e.g., Taman Universiti (no exact address)" className="w-full p-3 border border-gray-300 rounded-md outline-none focus:border-[#203569] text-gray-800" />
                    </div>
                    <div>
                        <label htmlFor="availableFrom" className="block text-[13px] font-bold text-[#374151] mb-2">Available From</label>
                        <input id="availableFrom" type="date" value={availableFrom} onChange={(e) => setAvailableFrom(e.target.value)} className="w-full p-3 border border-gray-300 rounded-md outline-none focus:border-[#203569] text-gray-800" />
                    </div>
                </div>

                <div>
                    <label htmlFor="description" className="block text-[13px] font-bold text-[#374151] mb-2">Description</label>
                    <textarea id="description" rows="4" maxLength={3000} value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Describe the room, the building, nearby shops and transport..." className="w-full p-3 border border-gray-300 rounded-md outline-none focus:border-[#203569] text-gray-800"></textarea>
                </div>

                <div>
                    <label htmlFor="houseRules" className="block text-[13px] font-bold text-[#374151] mb-2">House Rules (optional)</label>
                    <textarea id="houseRules" rows="2" maxLength={1000} value={houseRules} onChange={(e) => setHouseRules(e.target.value)} placeholder="e.g., No smoking indoors, quiet hours after 11pm" className="w-full p-3 border border-gray-300 rounded-md outline-none focus:border-[#203569] text-gray-800"></textarea>
                </div>

                <label className="flex items-center gap-3 text-[13px] font-bold text-[#374151] cursor-pointer">
                    <input type="checkbox" checked={furnished} onChange={(e) => setFurnished(e.target.checked)} className="accent-[#203569] w-4 h-4" />
                    Fully furnished
                </label>

                <div>
                    <label className="block text-[13px] font-bold text-[#374151] mb-3 mt-2">Included Facilities (Select all that apply)</label>
                    <div className="flex flex-wrap gap-3">
                        {meta.amenities.map(facility => {
                            const isSelected = selectedFacilities.includes(facility);
                            return (
                                <button
                                    key={facility}
                                    type="button"
                                    aria-pressed={isSelected}
                                    onClick={() => toggleFacility(facility)}
                                    className={isSelected
                                        ? "bg-[#203569] text-white px-5 py-2.5 rounded-full text-[13px] font-bold transition shadow-sm cursor-pointer"
                                        : "bg-[#f3f4f6] text-gray-500 border border-gray-200 px-5 py-2.5 rounded-full text-[13px] font-bold hover:bg-gray-200 transition cursor-pointer"
                                    }
                                >
                                    {isSelected ? `✓ ${facility}` : `+ ${facility}`}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="border-t border-gray-100 mt-8 pt-6 flex flex-col sm:flex-row gap-3 sm:justify-between sm:items-center">
                    <p className="text-[12px] text-gray-500 max-w-sm">An administrator checks every listing before students can see it. You'll get a notification once it's approved.</p>
                    <button
                        type="submit"
                        disabled={isPublishing}
                        className={`font-bold py-3 px-6 rounded-md shadow-sm transition flex items-center justify-center min-w-[240px] cursor-pointer ${isPublishing ? 'bg-[#1a2b56] text-gray-300 cursor-not-allowed' : 'bg-[#203569] text-white hover:bg-[#1a2b56]'}`}
                    >
                        {isPublishing ? 'Publishing...' : 'Publish to Student Database'}
                    </button>
                </div>
            </div>
        </form>
    );
};

export default AddListing;
