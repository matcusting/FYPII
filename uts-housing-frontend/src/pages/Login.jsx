import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const Login = () => {
    const navigate = useNavigate();
    
    // 控制当前选中的身份：'student' 或 'landlord'
    const [role, setRole] = useState('student');
    
    // 学生表单数据
    const [studentId, setStudentId] = useState('BCS24020031');
    const [studentEmail, setStudentEmail] = useState('student@uts.edu.my');

    // 房东表单数据
    const [landlordEmail, setLandlordEmail] = useState('wong@example.com');
    const [landlordPassword, setLandlordPassword] = useState('123456');

    const handleLogin = (e) => {
        e.preventDefault();
        // 根据选中的身份，跳转到不同的路由
        if (role === 'student') {
            navigate('/student');
        } else {
            navigate('/landlord');
        }
    };

    return (
        <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center font-sans">
            <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.04)] border border-gray-100 p-10 w-full max-w-[420px]">
                
                <div className="flex flex-col items-center mb-6">
                    <div className="w-16 h-16 bg-[#203569] text-white rounded-full flex items-center justify-center text-2xl font-bold mb-4 tracking-wide">
                        UTS
                    </div>
                    <h2 className="text-[1.6rem] font-bold text-[#1f2937] mb-1">System Login</h2>
                    <p className="text-gray-500 text-[14px]">Housing & Roommate Finder</p>
                </div>

                {/* 身份切换 Tabs */}
                <div className="flex bg-gray-100 p-1 rounded-lg mb-8">
                    <button 
                        type="button"
                        onClick={() => setRole('student')}
                        className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${role === 'student' ? 'bg-white text-[#203569] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        Student
                    </button>
                    <button 
                        type="button"
                        onClick={() => setRole('landlord')}
                        className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${role === 'landlord' ? 'bg-white text-[#203569] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        Landlord
                    </button>
                </div>
                
                <form onSubmit={handleLogin} className="space-y-5">
                    {/* 根据身份动态渲染输入框 */}
                    {role === 'student' ? (
                        <>
                            <div>
                                <label className="block text-[13px] font-bold text-[#203569] mb-1.5">Student ID</label>
                                <input 
                                    type="text" 
                                    value={studentId}
                                    onChange={(e) => setStudentId(e.target.value)}
                                    className="w-full p-2.5 border border-gray-300 rounded-lg focus:border-[#203569] outline-none text-gray-800 transition-colors"
                                />
                            </div>
                            <div>
                                <label className="block text-[13px] font-bold text-[#203569] mb-1.5">UTS Email</label>
                                <input 
                                    type="email" 
                                    value={studentEmail}
                                    onChange={(e) => setStudentEmail(e.target.value)}
                                    className="w-full p-2.5 border border-gray-300 rounded-lg focus:border-[#203569] outline-none text-gray-800 transition-colors"
                                />
                            </div>
                        </>
                    ) : (
                        <>
                            <div>
                                <label className="block text-[13px] font-bold text-[#203569] mb-1.5">Landlord Email</label>
                                <input 
                                    type="email" 
                                    value={landlordEmail}
                                    onChange={(e) => setLandlordEmail(e.target.value)}
                                    className="w-full p-2.5 border border-gray-300 rounded-lg focus:border-[#203569] outline-none text-gray-800 transition-colors"
                                />
                            </div>
                            <div>
                                <label className="block text-[13px] font-bold text-[#203569] mb-1.5">Password</label>
                                <input 
                                    type="password" 
                                    value={landlordPassword}
                                    onChange={(e) => setLandlordPassword(e.target.value)}
                                    className="w-full p-2.5 border border-gray-300 rounded-lg focus:border-[#203569] outline-none text-gray-800 transition-colors"
                                />
                            </div>
                        </>
                    )}
                    
                    <button 
                        type="submit" 
                        className="w-full bg-[#203569] text-white font-bold py-3 px-4 rounded-lg hover:bg-[#1a2b56] transition mt-4 shadow-sm"
                    >
                        {role === 'student' ? 'Verify & Login' : 'Login as Landlord'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default Login;