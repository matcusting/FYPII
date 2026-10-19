import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../../components/Navbar';

const RoommateSearch = () => {
    const navigate = useNavigate();
    
    // 问卷状态
    const [study, setStudy] = useState('Night Owl (Late)');
    const [clean, setClean] = useState('Moderate (Weekly)');
    const [smoke, setSmoke] = useState('Non-Smoker');
    const [showMatches, setShowMatches] = useState(false);

    // 记录哪些室友已经被点击了 "Connect"
    const [connectedIds, setConnectedIds] = useState([]);

    const getPillClass = (currentVal, targetVal) => {
        return currentVal === targetVal 
            ? "bg-[#e2f5e9] text-[#168a48] border-[#86efac] border-2 px-5 py-2 rounded-full text-[14px] font-bold cursor-pointer transition-colors"
            : "bg-white text-gray-600 border-gray-200 border px-5 py-2 rounded-full text-[14px] font-medium cursor-pointer hover:border-gray-300 transition-colors";
    };

    const handleConnect = (id) => {
        if (!connectedIds.includes(id)) {
            setConnectedIds([...connectedIds, id]);
        }
    };

    return (
        <div className="min-h-screen bg-[#f8f9fa] pb-20 font-sans">
            {/* 引入统一的全局悬浮导航栏 */}
            <Navbar />

            <div className="w-[1000px] mx-auto space-y-8">
                
                {/* 问卷表单卡片 */}
                <div className="bg-white shadow-[0_2px_10px_rgba(0,0,0,0.04)] rounded-xl overflow-hidden border border-gray-100">
                    <div className="bg-[#15803d] text-white px-8 py-4">
                        <h2 className="text-[1.1rem] font-bold tracking-wide">Lifestyle Profile Builder</h2>
                    </div>
                    
                    <div className="p-8">
                        <h3 className="text-[1.1rem] font-bold text-[#1f2937] border-b border-gray-100 pb-4 mb-8">
                            Select your daily habits
                        </h3>

                        <div className="space-y-8">
                            <div>
                                <p className="text-[15px] font-bold text-[#374151] mb-3">Study Schedule</p>
                                <div className="flex gap-3">
                                    <button onClick={() => setStudy('Night Owl (Late)')} className={getPillClass(study, 'Night Owl (Late)')}>Night Owl (Late)</button>
                                    <button onClick={() => setStudy('Early Bird (Morning)')} className={getPillClass(study, 'Early Bird (Morning)')}>Early Bird (Morning)</button>
                                </div>
                            </div>

                            <div>
                                <p className="text-[15px] font-bold text-[#374151] mb-3">Cleanliness Standard</p>
                                <div className="flex gap-3">
                                    <button onClick={() => setClean('Strict (Daily)')} className={getPillClass(clean, 'Strict (Daily)')}>Strict (Daily)</button>
                                    <button onClick={() => setClean('Moderate (Weekly)')} className={getPillClass(clean, 'Moderate (Weekly)')}>Moderate (Weekly)</button>
                                    <button onClick={() => setClean('Relaxed')} className={getPillClass(clean, 'Relaxed')}>Relaxed</button>
                                </div>
                            </div>

                            <div>
                                <p className="text-[15px] font-bold text-[#374151] mb-3">Smoking Preference</p>
                                <div className="flex gap-3">
                                    <button onClick={() => setSmoke('Non-Smoker')} className={getPillClass(smoke, 'Non-Smoker')}>Non-Smoker</button>
                                    <button onClick={() => setSmoke('Smoker Ok')} className={getPillClass(smoke, 'Smoker Ok')}>Smoker Ok</button>
                                </div>
                            </div>
                        </div>

                        <button 
                            onClick={() => setShowMatches(true)}
                            className="mt-10 bg-[#15803d] text-white font-bold py-3 px-6 rounded-lg hover:bg-green-800 transition shadow-sm cursor-pointer"
                        >
                            Save Profile & Find Matches
                        </button>
                    </div>
                </div>

                {/* 匹配结果卡片 (动态激活 Connect 按钮) */}
                {showMatches && (
                    <div className="bg-white shadow-[0_2px_10px_rgba(0,0,0,0.04)] rounded-xl p-8 border border-gray-100 mt-8 animate-fade-in-up">
                        <h2 className="text-[1.3rem] font-bold text-[#1f2937] mb-8">Top Compatible Roommates</h2>
                        
                        <div className="grid grid-cols-2 gap-8">
                            
                            {/* Alex Lee */}
                            <div className="border border-gray-200 rounded-xl p-6 relative bg-white hover:border-[#203569] transition-colors">
                                <div className="absolute -top-3.5 right-4 bg-[#fbbf24] text-[#78350f] font-bold text-[13px] px-4 py-1.5 rounded-full border-[3px] border-white shadow-sm">
                                    95% Match
                                </div>
                                <div className="flex items-center gap-4 mb-5">
                                    <div className="w-14 h-14 bg-[#eff6ff] text-[#2563eb] rounded-full flex items-center justify-center font-bold text-xl">AL</div>
                                    <div>
                                        <h3 className="font-bold text-[1.1rem] text-gray-900">Alex Lee</h3>
                                        <p className="text-[13px] text-gray-500 mt-0.5">Year 3 <span className="mx-1">•</span> Computer Science</p>
                                    </div>
                                </div>
                                <div className="border-t border-gray-100 pt-5 mb-6">
                                    <p className="text-[11px] font-bold text-gray-400 mb-3 uppercase tracking-wider">Shared Habits</p>
                                    <div className="flex flex-wrap gap-2">
                                        <span className="bg-[#e2f5e9] text-[#168a48] text-[12px] font-bold px-2.5 py-1 rounded">Night Owl</span>
                                        <span className="bg-[#e2f5e9] text-[#168a48] text-[12px] font-bold px-2.5 py-1 rounded">Non-Smoker</span>
                                        <span className="bg-[#e2f5e9] text-[#168a48] text-[12px] font-bold px-2.5 py-1 rounded">Moderate Clean</span>
                                    </div>
                                </div>
                                
                                {/* 动态 Connect 按钮 */}
                                <button 
                                    onClick={() => handleConnect(1)}
                                    disabled={connectedIds.includes(1)}
                                    className={`w-full font-bold py-2.5 rounded-lg transition ${connectedIds.includes(1) ? 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed' : 'border-2 border-[#203569] text-[#203569] hover:bg-blue-50'}`}
                                >
                                    {connectedIds.includes(1) ? '✓ Request Sent' : 'Connect'}
                                </button>
                            </div>

                            {/* Jonathan Tan */}
                            <div className="border border-gray-200 rounded-xl p-6 relative bg-white hover:border-[#203569] transition-colors">
                                <div className="absolute -top-3.5 right-4 bg-[#f3f4f6] text-[#4b5563] font-bold text-[13px] px-4 py-1.5 rounded-full border-[3px] border-white shadow-sm">
                                    80% Match
                                </div>
                                <div className="flex items-center gap-4 mb-5">
                                    <div className="w-14 h-14 bg-[#faf5ff] text-[#9333ea] rounded-full flex items-center justify-center font-bold text-xl">JT</div>
                                    <div>
                                        <h3 className="font-bold text-[1.1rem] text-gray-900">Jonathan Tan</h3>
                                        <p className="text-[13px] text-gray-500 mt-0.5">Year 2 <span className="mx-1">•</span> Engineering</p>
                                    </div>
                                </div>
                                <div className="border-t border-gray-100 pt-5 mb-6">
                                    <p className="text-[11px] font-bold text-gray-400 mb-3 uppercase tracking-wider">Shared Habits</p>
                                    <div className="flex flex-wrap gap-2">
                                        <span className="bg-[#e2f5e9] text-[#168a48] text-[12px] font-bold px-2.5 py-1 rounded">Night Owl</span>
                                        <span className="bg-[#e2f5e9] text-[#168a48] text-[12px] font-bold px-2.5 py-1 rounded">Non-Smoker</span>
                                        <span className="bg-[#fee2e2] text-[#b91c1c] text-[12px] font-bold px-2.5 py-1 rounded">Strict Clean (Mismatch)</span>
                                    </div>
                                </div>
                                
                                {/* 动态 Connect 按钮 */}
                                <button 
                                    onClick={() => handleConnect(2)}
                                    disabled={connectedIds.includes(2)}
                                    className={`w-full font-bold py-2.5 rounded-lg transition ${connectedIds.includes(2) ? 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed' : 'border-2 border-[#203569] text-[#203569] hover:bg-blue-50'}`}
                                >
                                    {connectedIds.includes(2) ? '✓ Request Sent' : 'Connect'}
                                </button>
                            </div>

                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default RoommateSearch;