import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../../components/Navbar';

const Profile = () => {
    const navigate = useNavigate();

    // 学生的个人信息状态
    const [profile, setProfile] = useState({
        name: 'Marcus Ting Zhong Sheng',
        studentId: 'BCS24020031',
        email: 'student@uts.edu.my',
        major: 'Computer Science',
        year: 'Year 2',
        bio: 'Looking for a quiet roommate near UTS campus who respects study hours.'
    });

    const [isSaved, setIsSaved] = useState(false);

    const handleSubmit = (e) => {
        e.preventDefault();
        setIsSaved(true);
        setTimeout(() => setIsSaved(false), 2000); // 2秒后自动隐藏成功提示
    };

    return (
        <div className="min-h-screen bg-[#f8f9fa] pb-20 font-sans">
            <Navbar />

            <div className="w-[800px] mx-auto bg-white rounded-xl shadow-[0_2px_10px_rgba(0,0,0,0.04)] border border-gray-100 overflow-hidden">
                
                {/* 顶部蓝色横幅 */}
                <div className="bg-[#203569] px-8 py-6 text-white flex justify-between items-center">
                    <div>
                        <h1 className="text-xl font-bold">Student Profile Settings</h1>
                        <p className="text-gray-300 text-sm mt-1">Manage your personal information and roommate matching preferences.</p>
                    </div>
                    <div className="w-14 h-14 bg-white/10 rounded-full flex items-center justify-center font-bold text-xl">
                        MT
                    </div>
                </div>

                {/* 表单区域 */}
                <form onSubmit={handleSubmit} className="p-8 space-y-6">
                    {isSaved && (
                        <div className="bg-[#dcfce7] text-[#15803d] p-4 rounded-lg font-bold text-sm border border-[#bbf7d0] text-center">
                            ✓ Profile updated successfully!
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-6">
                        <div>
                            <label className="block text-[13px] font-bold text-gray-700 mb-1.5">Full Legal Name</label>
                            <input 
                                type="text" 
                                value={profile.name}
                                onChange={(e) => setProfile({...profile, name: e.target.value})}
                                className="w-full p-2.5 border border-gray-300 rounded-lg outline-none focus:border-[#203569] text-gray-800"
                            />
                        </div>
                        <div>
                            <label className="block text-[13px] font-bold text-gray-700 mb-1.5">Student ID</label>
                            <input 
                                type="text" 
                                disabled
                                value={profile.studentId}
                                className="w-full p-2.5 border border-gray-200 rounded-lg bg-gray-50 text-gray-500 cursor-not-allowed"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                        <div>
                            <label className="block text-[13px] font-bold text-gray-700 mb-1.5">Major / Course</label>
                            <input 
                                type="text" 
                                value={profile.major}
                                onChange={(e) => setProfile({...profile, major: e.target.value})}
                                className="w-full p-2.5 border border-gray-300 rounded-lg outline-none focus:border-[#203569] text-gray-800"
                            />
                        </div>
                        <div>
                            <label className="block text-[13px] font-bold text-gray-700 mb-1.5">Academic Year</label>
                            <select 
                                value={profile.year}
                                onChange={(e) => setProfile({...profile, year: e.target.value})}
                                className="w-full p-2.5 border border-gray-300 rounded-lg outline-none focus:border-[#203569] text-gray-800 bg-white"
                            >
                                <option>Year 1</option>
                                <option>Year 2</option>
                                <option>Year 3</option>
                                <option>Year 4</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block text-[13px] font-bold text-gray-700 mb-1.5">UTS Email</label>
                        <input 
                            type="email" 
                            disabled
                            value={profile.email}
                            className="w-full p-2.5 border border-gray-200 rounded-lg bg-gray-50 text-gray-500 cursor-not-allowed"
                        />
                    </div>

                    <div>
                        <label className="block text-[13px] font-bold text-gray-700 mb-1.5">Personal Bio / Roommate Notes</label>
                        <textarea 
                            rows="3"
                            value={profile.bio}
                            onChange={(e) => setProfile({...profile, bio: e.target.value})}
                            className="w-full p-2.5 border border-gray-300 rounded-lg outline-none focus:border-[#203569] text-gray-800"
                        ></textarea>
                    </div>

                    <div className="pt-4 border-t border-gray-100 flex justify-end">
                        <button 
                            type="submit" 
                            className="bg-[#203569] text-white font-bold py-3 px-6 rounded-lg hover:bg-[#1a2b56] transition shadow-sm cursor-pointer"
                        >
                            Save Changes
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default Profile;