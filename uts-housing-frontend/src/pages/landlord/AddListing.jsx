import React, { useState } from 'react';

const allFacilities = ['High-Speed Wi-Fi', 'Air Conditioning', 'Washing Machine', 'Water Heater', 'Study Desk', 'Microwave'];

const AddListing = ({ myProperties, setMyProperties, setActiveTab }) => {
    const [newTitle, setNewTitle] = useState('');
    const [newRent, setNewRent] = useState('');
    const [newDeposit, setNewDeposit] = useState('');
    const [newDistance, setNewDistance] = useState('');
    const [newRoomType, setNewRoomType] = useState('Whole Apartment');
    const [selectedFacilities, setSelectedFacilities] = useState(['High-Speed Wi-Fi', 'Air Conditioning']);
    const [newImagePreview, setNewImagePreview] = useState(null);
    const [isPublishing, setIsPublishing] = useState(false);

    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const previewUrl = URL.createObjectURL(file);
            setNewImagePreview(previewUrl);
        }
    };

    const toggleFacility = (facility) => {
        if (selectedFacilities.includes(facility)) {
            setSelectedFacilities(selectedFacilities.filter(f => f !== facility));
        } else {
            setSelectedFacilities([...selectedFacilities, facility]);
        }
    };

    const handlePublish = (e) => {
        e.preventDefault();
        setIsPublishing(true);
        
        setTimeout(() => {
            const newProp = {
                id: Date.now(),
                title: newTitle,
                rent: Number(newRent),
                deposit: Number(newDeposit) || 0,
                distance: Number(newDistance),
                roomType: newRoomType,
                facilities: [...selectedFacilities],
                image: newImagePreview,
                status: 'Active'
            };
            
            setMyProperties([newProp, ...myProperties]);
            setIsPublishing(false);
            setActiveTab('manage'); 
        }, 800);
    };

    return (
        <form onSubmit={handlePublish} className="p-10 overflow-y-auto animate-fade-in-up">
            <h2 className="text-[1.4rem] font-bold text-[#0f172a] border-b border-gray-100 pb-4 mb-6">Publish a New Listing</h2>
            <div className="space-y-6 max-w-3xl">
                
                <div>
                    <label className="block text-[13px] font-bold text-[#374151] mb-2">Listing Title</label>
                    <input 
                        type="text" 
                        required 
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        placeholder="e.g., Master Room at Taman Universiti" 
                        className="w-full p-3 border border-gray-300 rounded-md outline-none focus:border-[#203569] text-gray-800" 
                    />
                </div>

                {/* 房屋照片上传与预览组件 */}
                <div>
                    <label className="block text-[13px] font-bold text-[#374151] mb-2">Property Photo</label>
                    {!newImagePreview ? (
                        <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer bg-[#f8f9fa] hover:bg-gray-100 hover:border-[#203569] transition-all">
                            <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                <span className="text-3xl mb-2">📷</span>
                                <p className="mb-1 text-sm text-gray-600 font-bold">Click to upload property photo</p>
                                <p className="text-xs text-gray-400">Supports JPG, PNG, WEBP (Max 5MB)</p>
                            </div>
                            <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                        </label>
                    ) : (
                        <div className="relative w-full h-48 rounded-xl overflow-hidden border border-gray-200 shadow-sm group">
                            <img src={newImagePreview} alt="Property Preview" className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                                <label className="bg-white text-gray-800 text-xs font-bold px-4 py-2 rounded-lg cursor-pointer hover:bg-gray-100 transition shadow">
                                    Change Photo
                                    <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                                </label>
                                <button 
                                    type="button"
                                    onClick={() => setNewImagePreview(null)}
                                    className="bg-red-600 text-white text-xs font-bold px-4 py-2 rounded-lg cursor-pointer hover:bg-red-700 transition shadow"
                                >
                                    Remove
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-2 gap-6">
                    <div>
                        <label className="block text-[13px] font-bold text-[#374151] mb-2">Monthly Rent (RM)</label>
                        <input 
                            type="number" 
                            required 
                            value={newRent}
                            onChange={(e) => setNewRent(e.target.value)}
                            placeholder="0.00" 
                            className="w-full p-3 border border-gray-300 rounded-md outline-none focus:border-[#203569]" 
                        />
                    </div>
                    <div>
                        <label className="block text-[13px] font-bold text-[#374151] mb-2">Security Deposit (RM)</label>
                        <input 
                            type="number" 
                            value={newDeposit}
                            onChange={(e) => setNewDeposit(e.target.value)}
                            placeholder="0.00" 
                            className="w-full p-3 border border-gray-300 rounded-md outline-none focus:border-[#203569]" 
                        />
                    </div>
                </div>
                
                <div className="grid grid-cols-2 gap-6">
                    <div>
                        <label className="block text-[13px] font-bold text-[#374151] mb-2">Distance to UTS (km)</label>
                        <input 
                            type="number" 
                            step="0.1" 
                            required 
                            value={newDistance}
                            onChange={(e) => setNewDistance(e.target.value)}
                            placeholder="e.g., 1.5" 
                            className="w-full p-3 border border-gray-300 rounded-md outline-none focus:border-[#203569]" 
                        />
                    </div>
                    <div>
                        <label className="block text-[13px] font-bold text-[#374151] mb-2">Room Type</label>
                        <select 
                            value={newRoomType}
                            onChange={(e) => setNewRoomType(e.target.value)}
                            className="w-full p-3 border border-gray-300 rounded-md outline-none focus:border-[#203569] text-gray-800 bg-white"
                        >
                            <option>Whole Apartment</option>
                            <option>Single Room</option>
                            <option>Master Room</option>
                            <option>Shared Room</option>
                        </select>
                    </div>
                </div>
                
                <div>
                    <label className="block text-[13px] font-bold text-[#374151] mb-3 mt-2">Included Facilities (Select all that apply)</label>
                    <div className="flex flex-wrap gap-3">
                        {allFacilities.map(facility => {
                            const isSelected = selectedFacilities.includes(facility);
                            return (
                                <button 
                                    key={facility}
                                    type="button"
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
                
                <div className="border-t border-gray-100 mt-8 pt-6 flex justify-end">
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