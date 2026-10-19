import React, { useState } from 'react';

const ManageListings = ({ myProperties, setMyProperties, setActiveTab }) => {
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingProperty, setEditingProperty] = useState(null);

    const togglePropertyStatus = (id) => {
        setMyProperties(myProperties.map(prop => {
            if (prop.id === id) {
                return { ...prop, status: prop.status === 'Active' ? 'Rented' : 'Active' };
            }
            return prop;
        }));
    };

    const handleDeleteProperty = (id) => {
        setMyProperties(myProperties.filter(prop => prop.id !== id));
    };

    const handleEditClick = (prop) => {
        setEditingProperty({ ...prop });
        setIsEditModalOpen(true);
    };

    const handleEditImageUpload = (e) => {
        const file = e.target.files[0];
        if (file && editingProperty) {
            const previewUrl = URL.createObjectURL(file);
            setEditingProperty({ ...editingProperty, image: previewUrl });
        }
    };

    const handleEditSave = (e) => {
        e.preventDefault();
        setMyProperties(myProperties.map(p => p.id === editingProperty.id ? editingProperty : p));
        setIsEditModalOpen(false);
        setEditingProperty(null);
    };

    return (
        <div className="p-10 overflow-y-auto animate-fade-in-up">
            <div className="flex justify-between items-center border-b border-gray-100 pb-4 mb-8 max-w-4xl">
                <h2 className="text-[1.4rem] font-bold text-[#0f172a]">Manage Properties</h2>
                <button 
                    onClick={() => setActiveTab('add')}
                    className="bg-[#203569] text-white text-xs font-bold px-4 py-2.5 rounded-lg hover:bg-[#1a2b56] transition cursor-pointer"
                >
                    + Add New Property
                </button>
            </div>

            <div className="space-y-5 max-w-4xl">
                {myProperties.map(prop => (
                    <div key={prop.id} className={`border ${prop.status === 'Active' ? 'border-gray-200 bg-white shadow-sm' : 'border-gray-100 bg-[#f8f9fa]'} rounded-xl p-5 flex justify-between items-start transition-all duration-300`}>
                        <div className={`flex gap-6 ${prop.status === 'Rented' ? 'opacity-60' : ''}`}>
                            
                            {prop.image ? (
                                <div className="w-[140px] h-[110px] rounded-lg overflow-hidden flex-shrink-0 border border-gray-200 relative">
                                    <img src={prop.image} alt={prop.title} className="w-full h-full object-cover" />
                                    <span className="absolute bottom-1 left-1 bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded">
                                        {prop.roomType}
                                    </span>
                                </div>
                            ) : (
                                <div className={`w-[140px] h-[110px] rounded-lg flex flex-col items-center justify-center font-bold text-sm flex-shrink-0 transition-colors ${prop.status === 'Active' ? 'bg-[#cbd5e1] text-[#475569]' : 'bg-[#e2e8f0] text-gray-400'}`}>
                                    <span>Image</span>
                                    <span className="text-[10px] font-normal mt-1">{prop.roomType}</span>
                                </div>
                            )}

                            <div className="flex flex-col justify-center">
                                <h3 className={`text-[1.15rem] font-bold mb-1 ${prop.status === 'Active' ? 'text-[#1e3a8a]' : 'text-gray-500'}`}>{prop.title}</h3>
                                <p className={`text-[13px] mb-2 ${prop.status === 'Active' ? 'text-[#64748b]' : 'text-gray-400'}`}>
                                    RM {prop.rent}/mo • Deposit: RM {prop.deposit} • {prop.distance} km to UTS
                                </p>
                                
                                <div className="flex flex-wrap gap-1.5 mb-4">
                                    {prop.facilities && prop.facilities.map((fac, idx) => (
                                        <span key={idx} className="bg-gray-100 text-gray-600 text-[10px] font-bold px-2 py-0.5 rounded">
                                            {fac}
                                        </span>
                                    ))}
                                </div>

                                <div className="flex gap-3">
                                    <button 
                                        onClick={() => handleEditClick(prop)}
                                        className="border border-gray-300 text-[#334155] text-[12px] font-bold px-4 py-1.5 rounded bg-white hover:bg-gray-50 transition cursor-pointer"
                                    >
                                        Edit Details
                                    </button>
                                    <button 
                                        onClick={() => togglePropertyStatus(prop.id)}
                                        className="border border-gray-300 text-[#334155] text-[12px] font-bold px-4 py-1.5 rounded bg-white hover:bg-gray-50 transition cursor-pointer"
                                    >
                                        {prop.status === 'Active' ? 'Mark as Rented' : 'Re-list Property'}
                                    </button>
                                    <button 
                                        onClick={() => handleDeleteProperty(prop.id)}
                                        className="border border-red-200 text-red-600 text-[12px] font-bold px-3 py-1.5 rounded bg-white hover:bg-red-50 transition cursor-pointer"
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        </div>
                        {prop.status === 'Active' ? (
                            <div className="bg-[#dcfce7] text-[#15803d] text-[12px] font-bold px-3 py-1.5 rounded flex items-center gap-2 transition-colors">
                                <div className="w-2 h-2 bg-[#15803d] rounded-full"></div> Active
                            </div>
                        ) : (
                            <div className="bg-gray-200 text-gray-500 text-[12px] font-bold px-3 py-1.5 rounded transition-colors">
                                Rented
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* 编辑房源详情弹窗 */}
            {isEditModalOpen && editingProperty && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-[480px] overflow-hidden">
                        <div className="bg-[#0f172a] px-6 py-4 flex justify-between items-center">
                            <h3 className="text-white font-bold text-[1.1rem]">Edit Property Details</h3>
                            <button onClick={() => setIsEditModalOpen(false)} className="text-gray-400 hover:text-white text-xl leading-none font-bold cursor-pointer">×</button>
                        </div>
                        <form onSubmit={handleEditSave} className="p-6 space-y-4">
                            <div>
                                <label className="block text-[13px] font-bold text-[#374151] mb-1.5">Property Photo</label>
                                <div className="flex items-center gap-4">
                                    {editingProperty.image ? (
                                        <img src={editingProperty.image} alt="Preview" className="w-20 h-16 object-cover rounded-lg border border-gray-200" />
                                    ) : (
                                        <div className="w-20 h-16 bg-gray-200 rounded-lg flex items-center justify-center text-xs text-gray-500 font-bold">No Image</div>
                                    )}
                                    <label className="border border-gray-300 text-gray-700 text-xs font-bold px-3 py-2 rounded-md cursor-pointer hover:bg-gray-50 transition">
                                        Upload New Photo
                                        <input type="file" accept="image/*" onChange={handleEditImageUpload} className="hidden" />
                                    </label>
                                </div>
                            </div>

                            <div>
                                <label className="block text-[13px] font-bold text-[#374151] mb-1">Listing Title</label>
                                <input type="text" required value={editingProperty.title} onChange={(e) => setEditingProperty({...editingProperty, title: e.target.value})} className="w-full p-2.5 border border-gray-300 rounded-md outline-none focus:border-[#1d4ed8] text-gray-800" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[13px] font-bold text-[#374151] mb-1">Monthly Rent (RM)</label>
                                    <input type="number" required value={editingProperty.rent} onChange={(e) => setEditingProperty({...editingProperty, rent: Number(e.target.value)})} className="w-full p-2.5 border border-gray-300 rounded-md outline-none focus:border-[#1d4ed8] text-gray-800" />
                                </div>
                                <div>
                                    <label className="block text-[13px] font-bold text-[#374151] mb-1">Security Deposit (RM)</label>
                                    <input type="number" required value={editingProperty.deposit || 0} onChange={(e) => setEditingProperty({...editingProperty, deposit: Number(e.target.value)})} className="w-full p-2.5 border border-gray-300 rounded-md outline-none focus:border-[#1d4ed8] text-gray-800" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[13px] font-bold text-[#374151] mb-1">Distance (km)</label>
                                    <input type="number" step="0.1" required value={editingProperty.distance} onChange={(e) => setEditingProperty({...editingProperty, distance: Number(e.target.value)})} className="w-full p-2.5 border border-gray-300 rounded-md outline-none focus:border-[#1d4ed8] text-gray-800" />
                                </div>
                                <div>
                                    <label className="block text-[13px] font-bold text-[#374151] mb-1">Room Type</label>
                                    <select value={editingProperty.roomType || 'Single Room'} onChange={(e) => setEditingProperty({...editingProperty, roomType: e.target.value})} className="w-full p-2.5 border border-gray-300 rounded-md outline-none focus:border-[#1d4ed8] text-gray-800 bg-white">
                                        <option>Whole Apartment</option>
                                        <option>Single Room</option>
                                        <option>Master Room</option>
                                        <option>Shared Room</option>
                                    </select>
                                </div>
                            </div>
                            <div className="pt-4 mt-2 flex justify-end gap-3 border-t border-gray-100">
                                <button type="button" onClick={() => setIsEditModalOpen(false)} className="px-5 py-2.5 text-gray-600 font-bold hover:bg-gray-100 rounded-md transition cursor-pointer">Cancel</button>
                                <button type="submit" className="px-6 py-2.5 bg-[#1d4ed8] text-white font-bold rounded-md hover:bg-blue-800 transition shadow-sm cursor-pointer">Save Changes</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ManageListings;