import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../../components/Navbar';

// --- 扩充后的模拟房源数据（包含完整详情字段） ---
const initialProperties = [
    { 
        id: 1, 
        title: 'Taman Universiti Room', 
        rent: 450, 
        deposit: 900,
        distance: 1.2, 
        roomType: 'Single Room',
        landlord: 'Mr. Wong',
        tags: ['Deposit: RM 900', 'Fully Furnished'], 
        facilities: ['High-Speed Wi-Fi', 'Air Conditioning', 'Washing Machine', 'Water Heater', 'Study Desk'],
        description: 'Spacious and quiet single room located right next to UTS campus. Walking distance to local eateries and supermarkets. Ideal for students looking for a conducive study environment.',
        isSaved: false 
    },
    { 
        id: 2, 
        title: 'Sibu Jaya Shared Apt', 
        rent: 300, 
        deposit: 300,
        distance: 3.5, 
        roomType: 'Shared Apartment',
        landlord: 'Mr. Wong',
        tags: ['Deposit: RM 300', 'Utility Included'], 
        facilities: ['High-Speed Wi-Fi', 'Washing Machine', 'Water Heater', 'Cooking Allowed'],
        description: 'Affordable shared apartment with utility bills included in the monthly rent. Friendly housemates and 24-hour security guard patrol.',
        isSaved: true 
    },
    { 
        id: 3, 
        title: 'Wong King Huo Studio', 
        rent: 850, 
        deposit: 1700,
        distance: 4.0, 
        roomType: 'Whole Studio',
        landlord: 'Madam Ling',
        tags: ['Aircond', 'Private Bath', 'Gym'], 
        facilities: ['High-Speed Wi-Fi', 'Air Conditioning', 'Private Bathroom', 'Gym Access', 'Microwave', 'Parking Lot'],
        description: 'Modern studio unit with full privacy. Comes with an attached bathroom, kitchenette, and free access to the apartment gym and swimming pool.',
        isSaved: false 
    },
    { 
        id: 4, 
        title: 'Campus Walk Single', 
        rent: 550, 
        deposit: 0,
        distance: 0.8, 
        roomType: 'Single Room',
        landlord: 'Mr. Tan',
        tags: ['No Deposit', 'High-Speed Wi-Fi'], 
        facilities: ['High-Speed Wi-Fi', 'Air Conditioning', 'Study Desk', 'Water Dispenser'],
        description: 'Superb location just 800m from UTS main gate! Zero deposit promotion for verified UTS students. Newly renovated with brand new furniture.',
        isSaved: false 
    },
    { 
        id: 5, 
        title: 'Pahlawan Master Room', 
        rent: 650, 
        deposit: 650,
        distance: 2.5, 
        roomType: 'Master Room',
        landlord: 'Ms. Rachel',
        tags: ['Attached Bathroom', 'Spacious'], 
        facilities: ['High-Speed Wi-Fi', 'Air Conditioning', 'Attached Bathroom', 'Washing Machine', 'Balcony'],
        description: 'Large master bedroom with a private attached bathroom and balcony. Located near Pahlawan bus terminal and commercial center.',
        isSaved: false 
    },
];

const HousingSearch = () => {
    const navigate = useNavigate();
    
    // 筛选表单状态
    const [maxRent, setMaxRent] = useState(600);
    const [maxDistance, setMaxDistance] = useState('5'); 
    
    // 列表与交互状态
    const [allProperties, setAllProperties] = useState(initialProperties);
    const [displayProperties, setDisplayProperties] = useState([]);
    const [isFiltering, setIsFiltering] = useState(false);

    // 新增：当前选中查看详情的房源状态
    const [selectedProperty, setSelectedProperty] = useState(null);

    useEffect(() => {
        applyFilters();
        // eslint-disable-next-line
    }, []);

    const applyFilters = () => {
        setIsFiltering(true);
        setTimeout(() => {
            const filtered = allProperties.filter(prop => {
                const passRent = prop.rent <= maxRent;
                let passDist = true;
                if (maxDistance === '5') passDist = prop.distance <= 5;
                else if (maxDistance === '2') passDist = prop.distance <= 2;
                return passRent && passDist;
            });
            setDisplayProperties(filtered);
            setIsFiltering(false);
        }, 500);
    };

    const handleApplyFilters = (e) => {
        e.preventDefault();
        applyFilters();
    };

    // 收藏/取消收藏功能（阻止事件冒泡，避免触发详情弹窗）
    const toggleSaveProperty = (e, id) => {
        e.stopPropagation();
        const updateData = (list) => list.map(p => p.id === id ? { ...p, isSaved: !p.isSaved } : p);
        setAllProperties(updateData(allProperties));
        setDisplayProperties(updateData(displayProperties));
        if (selectedProperty && selectedProperty.id === id) {
            setSelectedProperty({ ...selectedProperty, isSaved: !selectedProperty.isSaved });
        }
    };

    return (
        <div className="min-h-screen bg-[#f8f9fa] pb-20 font-sans relative">
            <Navbar />

            <div className="w-[1000px] mx-auto mb-4">
                <button onClick={() => navigate('/student')} className="text-gray-500 hover:text-gray-800 font-bold text-sm flex items-center gap-1 transition-colors cursor-pointer">
                    ← Back to Dashboard
                </button>
            </div>

            <div className="w-[1000px] mx-auto bg-white shadow-[0_2px_10px_rgba(0,0,0,0.04)] rounded-xl overflow-hidden border border-gray-100 flex min-h-[600px]">
                
                {/* 左侧：Filters 筛选面板 */}
                <div className="w-[300px] bg-[#fcfcfd] border-r border-gray-100 p-8 flex flex-col">
                    <h2 className="text-xl font-bold text-[#1f2937] mb-8">Filters</h2>
                    
                    <form onSubmit={handleApplyFilters} className="flex-1 flex flex-col">
                        <div className="mb-8">
                            <label className="block text-[11px] font-bold text-[#4b5563] mb-4 uppercase tracking-wider">Max Rent (RM)</label>
                            <input 
                                type="range" 
                                min="200" max="1000" step="50"
                                value={maxRent}
                                onChange={(e) => setMaxRent(e.target.value)}
                                className="w-full accent-[#e11d48] h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                            />
                            <div className="text-right text-sm text-[#4b5563] mt-3 font-medium">RM {maxRent}</div>
                        </div>

                        <div className="mb-8">
                            <label className="block text-[11px] font-bold text-[#4b5563] mb-3 uppercase tracking-wider">Distance to UTS</label>
                            <select 
                                value={maxDistance}
                                onChange={(e) => setMaxDistance(e.target.value)}
                                className="w-full p-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:border-[#203569] text-gray-800 bg-white cursor-pointer"
                            >
                                <option value="5">Less than 5 km</option>
                                <option value="2">Less than 2 km</option>
                                <option value="any">Any Distance</option>
                            </select>
                        </div>

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
                <div className="flex-1 p-8 bg-white overflow-y-auto">
                    <h2 className="text-xl font-bold text-[#203569] mb-6">
                        {isFiltering ? 'Loading...' : `${displayProperties.length} Verified Listings`}
                    </h2>
                    
                    {!isFiltering && displayProperties.length === 0 && (
                        <div className="h-64 flex flex-col items-center justify-center text-center">
                            <div className="text-4xl mb-4">🔍</div>
                            <h3 className="text-lg font-bold text-gray-800 mb-2">No properties found</h3>
                            <p className="text-sm text-gray-500">Try adjusting your filters to see more results.</p>
                            <button 
                                onClick={() => { setMaxRent(1000); setMaxDistance('any'); }}
                                className="mt-4 text-[#e11d48] font-bold text-sm hover:underline cursor-pointer"
                            >
                                Reset Filters
                            </button>
                        </div>
                    )}

                    <div className="space-y-4 pb-10">
                        {!isFiltering && displayProperties.map(prop => (
                            <div 
                                key={prop.id} 
                                onClick={() => setSelectedProperty(prop)} // 点击整张卡片打开详情
                                className="border border-gray-200 rounded-xl p-4 flex gap-5 hover:shadow-md hover:border-[#203569] transition-all bg-white group relative cursor-pointer"
                            >
                                {/* 收藏/爱心按钮 */}
                                <button 
                                    onClick={(e) => toggleSaveProperty(e, prop.id)}
                                    className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors cursor-pointer"
                                >
                                    <svg 
                                        className={`w-6 h-6 transition-colors ${prop.isSaved ? 'text-[#e11d48] fill-[#e11d48]' : 'text-gray-300 fill-transparent hover:text-gray-400'}`} 
                                        xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"
                                    >
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                                    </svg>
                                </button>

                                {/* 图片占位符 */}
                                <div className="w-[140px] h-[100px] bg-[#e2e8f0] rounded-lg flex-shrink-0 flex items-center justify-center text-gray-400 font-bold text-sm group-hover:bg-[#cbd5e1] transition-colors">
                                    Image
                                </div>
                                
                                <div className="flex-1 flex flex-col justify-center pr-8">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <h3 className="text-[1.1rem] font-bold text-[#203569] group-hover:text-blue-700 transition-colors">{prop.title}</h3>
                                            <p className="text-[13px] text-gray-500 mt-1">
                                                Verified Landlord <span className="mx-1">•</span> {prop.distance} km to UTS
                                            </p>
                                        </div>
                                    </div>
                                    
                                    <div className="flex justify-between items-end mt-4">
                                        <div className="flex gap-2">
                                            {prop.tags.map((tag, index) => (
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
                </div>
            </div>

            {/* --- 新增：房源完整详情弹窗 (Property Detail Modal) --- */}
            {selectedProperty && (
                <div 
                    onClick={() => setSelectedProperty(null)}
                    className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in"
                >
                    <div 
                        onClick={(e) => e.stopPropagation()} // 防止点击弹窗内部时关闭
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-[650px] overflow-hidden border border-gray-100"
                    >
                        {/* 顶部大图区域 */}
                        <div className="h-[220px] bg-[#cbd5e1] relative flex items-center justify-center">
                            <span className="text-gray-500 font-bold text-lg">Property Image Gallery</span>
                            
                            {/* 右上角关闭按钮 */}
                            <button 
                                onClick={() => setSelectedProperty(null)}
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
                        <div className="p-8">
                            <div className="flex justify-between items-start border-b border-gray-100 pb-5 mb-6">
                                <div>
                                    <h2 className="text-2xl font-bold text-[#1f2937]">{selectedProperty.title}</h2>
                                    <p className="text-sm text-gray-500 mt-1 flex items-center gap-2">
                                        <span>Posted by <strong className="text-gray-800">{selectedProperty.landlord}</strong></span>
                                        <span className="bg-[#dcfce7] text-[#15803d] text-[10px] font-bold px-2 py-0.5 rounded">✓ Verified</span>
                                        <span>• {selectedProperty.distance} km to UTS</span>
                                    </p>
                                </div>
                                <div className="text-right">
                                    <div className="text-2xl font-bold text-[#16a34a]">RM {selectedProperty.rent}<span className="text-sm text-gray-500 font-normal">/mo</span></div>
                                    <div className="text-xs text-gray-400 font-medium mt-0.5">Deposit: RM {selectedProperty.deposit}</div>
                                </div>
                            </div>

                            {/* 房源简介 */}
                            <div className="mb-6">
                                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">About this property</h4>
                                <p className="text-gray-600 text-sm leading-relaxed">
                                    {selectedProperty.description}
                                </p>
                            </div>

                            {/* 配套设施列表 */}
                            <div className="mb-8">
                                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Included Facilities</h4>
                                <div className="flex flex-wrap gap-2.5">
                                    {selectedProperty.facilities.map((fac, idx) => (
                                        <span key={idx} className="bg-[#f0f4f8] text-[#203569] text-xs font-bold px-3.5 py-1.5 rounded-full flex items-center gap-1.5">
                                            ✓ {fac}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            {/* 底部操作按钮 */}
                            <div className="flex gap-4 pt-4 border-t border-gray-100">
                                <button 
                                    onClick={(e) => toggleSaveProperty(e, selectedProperty.id)}
                                    className={`px-5 py-3 rounded-xl font-bold text-sm border flex items-center gap-2 transition cursor-pointer ${selectedProperty.isSaved ? 'border-[#e11d48] text-[#e11d48] bg-pink-50' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                                >
                                    <span>{selectedProperty.isSaved ? '❤️ Saved' : '🤍 Save to Wishlist'}</span>
                                </button>
                                
                                <button 
                                    onClick={() => navigate('/student/messages')}
                                    className="flex-1 bg-[#203569] hover:bg-[#1a2b56] text-white font-bold py-3 px-6 rounded-xl transition shadow-sm cursor-pointer flex items-center justify-center gap-2"
                                >
                                    <span>💬 Contact Landlord ({selectedProperty.landlord})</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default HousingSearch;