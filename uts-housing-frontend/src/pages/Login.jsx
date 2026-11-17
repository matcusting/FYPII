import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { homeFor } from '../lib/api';
import { ErrorBanner, FullPageLoading } from '../components/ui';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { useT } from '../i18n';

// Demo credentials are only pre-filled in development builds.
const DEV = import.meta.env.DEV;

const Login = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { user, loading, login } = useAuth();
    const { t } = useT();

    // 控制当前选中的身份：'student' / 'landlord' / 'admin'
    const [role, setRole] = useState('student');

    // 学生表单数据
    const [studentId, setStudentId] = useState(DEV ? 'BCS24020031' : '');
    const [studentEmail, setStudentEmail] = useState(DEV ? 'bcs24020031@student.uts.edu.my' : '');
    const [studentPassword, setStudentPassword] = useState(DEV ? 'Demo@2026' : '');

    // 房东 / 管理员表单数据
    const [landlordEmail, setLandlordEmail] = useState(DEV ? 'wong@example.com' : '');
    const [landlordPassword, setLandlordPassword] = useState(DEV ? 'Demo@2026' : '');

    const [error, setError] = useState(null);
    const [submitting, setSubmitting] = useState(false);

    // 已登录用户直接进入对应主页
    useEffect(() => {
        if (!loading && user) navigate(location.state?.from || homeFor(user.role), { replace: true });
    }, [loading, user, navigate, location.state]);

    const handleLogin = async (e) => {
        e.preventDefault();
        setError(null);
        setSubmitting(true);
        try {
            const payload = role === 'student'
                ? { role: 'STUDENT', studentId, email: studentEmail, password: studentPassword }
                : { role: role === 'admin' ? 'STAFF' : 'LANDLORD', email: landlordEmail, password: landlordPassword };
            const u = await login(payload);
            // 根据身份，跳转到不同的路由
            navigate(location.state?.from || homeFor(u.role), { replace: true });
        } catch (err) {
            setError(err);
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) return <FullPageLoading />;

    return (
        <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center font-sans px-4 relative">
            <LanguageSwitcher className="absolute top-4 right-4" />
            <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.04)] border border-gray-100 p-6 sm:p-10 w-full max-w-[420px]">

                <div className="flex flex-col items-center mb-6">
                    <div className="w-16 h-16 bg-[#203569] text-white rounded-full flex items-center justify-center text-2xl font-bold mb-4 tracking-wide">
                        UTS
                    </div>
                    <h2 className="text-[1.6rem] font-bold text-[#1f2937] mb-1">{role === 'admin' ? t('Staff Login') : t('System Login')}</h2>
                    <p className="text-gray-500 text-[14px]">{t('Housing & Roommate Finder')}</p>
                </div>

                {/* 身份切换 Tabs */}
                {role !== 'admin' && (
                    <div className="flex bg-gray-100 p-1 rounded-lg mb-8" role="tablist">
                        <button
                            type="button"
                            role="tab"
                            aria-selected={role === 'student'}
                            onClick={() => { setRole('student'); setError(null); }}
                            className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${role === 'student' ? 'bg-white text-[#203569] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            {t('Student')}
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={role === 'landlord'}
                            onClick={() => { setRole('landlord'); setError(null); }}
                            className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${role === 'landlord' ? 'bg-white text-[#203569] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            {t('Landlord')}
                        </button>
                    </div>
                )}

                <form onSubmit={handleLogin} className="space-y-5">
                    <ErrorBanner error={error} />

                    {/* 根据身份动态渲染输入框 */}
                    {role === 'student' ? (
                        <>
                            <div>
                                <label htmlFor="studentId" className="block text-[13px] font-bold text-[#203569] mb-1.5">{t('Student ID')}</label>
                                <input
                                    id="studentId"
                                    type="text"
                                    required
                                    autoComplete="username"
                                    value={studentId}
                                    onChange={(e) => setStudentId(e.target.value)}
                                    className="w-full p-2.5 border border-gray-300 rounded-lg focus:border-[#203569] outline-none text-gray-800 transition-colors"
                                />
                            </div>
                            <div>
                                <label htmlFor="studentEmail" className="block text-[13px] font-bold text-[#203569] mb-1.5">{t('UTS Student Email')}</label>
                                <input
                                    id="studentEmail"
                                    type="email"
                                    required
                                    autoComplete="email"
                                    value={studentEmail}
                                    placeholder="bcs12345678@student.uts.edu.my"
                                    onChange={(e) => setStudentEmail(e.target.value)}
                                    className="w-full p-2.5 border border-gray-300 rounded-lg focus:border-[#203569] outline-none text-gray-800 transition-colors"
                                />
                            </div>
                            <div>
                                <label htmlFor="studentPassword" className="block text-[13px] font-bold text-[#203569] mb-1.5">{t('Password')}</label>
                                <input
                                    id="studentPassword"
                                    type="password"
                                    required
                                    autoComplete="current-password"
                                    value={studentPassword}
                                    onChange={(e) => setStudentPassword(e.target.value)}
                                    className="w-full p-2.5 border border-gray-300 rounded-lg focus:border-[#203569] outline-none text-gray-800 transition-colors"
                                />
                            </div>
                        </>
                    ) : (
                        <>
                            <div>
                                <label htmlFor="landlordEmail" className="block text-[13px] font-bold text-[#203569] mb-1.5">{role === 'admin' ? t('Staff Email (administrator or legal reviewer)') : t('Landlord Email')}</label>
                                <input
                                    id="landlordEmail"
                                    type="email"
                                    required
                                    autoComplete="email"
                                    value={landlordEmail}
                                    onChange={(e) => setLandlordEmail(e.target.value)}
                                    className="w-full p-2.5 border border-gray-300 rounded-lg focus:border-[#203569] outline-none text-gray-800 transition-colors"
                                />
                            </div>
                            <div>
                                <label htmlFor="landlordPassword" className="block text-[13px] font-bold text-[#203569] mb-1.5">{t('Password')}</label>
                                <input
                                    id="landlordPassword"
                                    type="password"
                                    required
                                    autoComplete="current-password"
                                    value={landlordPassword}
                                    onChange={(e) => setLandlordPassword(e.target.value)}
                                    className="w-full p-2.5 border border-gray-300 rounded-lg focus:border-[#203569] outline-none text-gray-800 transition-colors"
                                />
                            </div>
                        </>
                    )}

                    <button
                        type="submit"
                        disabled={submitting}
                        className="w-full bg-[#203569] text-white font-bold py-3 px-4 rounded-lg hover:bg-[#1a2b56] transition mt-4 shadow-sm disabled:opacity-70 disabled:cursor-not-allowed"
                    >
                        {submitting ? t('Signing in...') : role === 'student' ? t('Verify & Login') : role === 'admin' ? t('Staff Login') : t('Login as Landlord')}
                    </button>
                </form>

                <div className="mt-6 flex justify-between text-[13px] font-bold">
                    <Link to="/forgot-password" className="text-gray-500 hover:text-[#203569] transition-colors">{t('Forgot password?')}</Link>
                    {role !== 'admin' && (
                        <Link to={`/register?role=${role}`} className="text-[#203569] hover:underline">{t('Create an account')}</Link>
                    )}
                </div>
                <div className="mt-6 pt-5 border-t border-gray-100 text-center">
                    <button
                        type="button"
                        onClick={() => {
                            setError(null);
                            if (role === 'admin') { setRole('student'); return; }
                            setRole('admin');
                            if (DEV) { setLandlordEmail('admin@uts-housing.local'); setLandlordPassword('Admin@2026!'); }
                        }}
                        className="text-[12px] font-bold text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
                    >
                        {role === 'admin' ? t('← Back to student / landlord login') : t('Staff login (administrator / legal reviewer)')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Login;
