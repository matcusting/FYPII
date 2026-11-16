import { useState } from 'react';
import Navbar from '../../components/Navbar';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/api';
import { ErrorBanner } from '../../components/ui';
import { BlockedUsersSection, DeleteAccountSection, MyReviewsSection, NotificationSettingsSection, PasswordSection, VerificationSection } from '../../components/AccountSections';
import { useT } from '../../i18n';

const Profile = () => {
    const { t } = useT();
    const { user, refresh } = useAuth();

    // 学生的个人信息状态
    const [profile, setProfile] = useState({
        name: user.name,
        studentId: user.studentId,
        email: user.email,
        major: user.major || '',
        gender: user.gender || '',
        year: user.academicYear || 'Year 1',
        bio: user.bio || '',
    });

    const [isSaved, setIsSaved] = useState(false);
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setSaving(true);
        try {
            await api('/profile', { method: 'PATCH', body: { name: profile.name, major: profile.major, academicYear: profile.year, bio: profile.bio, gender: profile.gender || undefined } });
            await refresh();
            setIsSaved(true);
            setTimeout(() => setIsSaved(false), 2000); // 2秒后自动隐藏成功提示
        } catch (err) {
            setError(err);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#f8f9fa] pb-20 font-sans">
            <Navbar />

            <div className="max-w-[800px] w-[calc(100%-2rem)] mx-auto bg-white rounded-xl shadow-[0_2px_10px_rgba(0,0,0,0.04)] border border-gray-100 overflow-hidden">

                {/* 顶部蓝色横幅 */}
                <div className="bg-[#203569] px-6 sm:px-8 py-6 text-white flex justify-between items-center gap-4">
                    <div>
                        <h1 className="text-xl font-bold">{t('Student Profile Settings')}</h1>
                        <p className="text-gray-300 text-sm mt-1">{t('Manage your personal information and roommate matching preferences.')}</p>
                    </div>
                    <div className="w-14 h-14 bg-white/10 rounded-full flex items-center justify-center font-bold text-xl flex-shrink-0">
                        {user.initials}
                    </div>
                </div>

                {/* 表单区域 */}
                <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-6">
                    {isSaved && (
                        <div className="bg-[#dcfce7] text-[#15803d] p-4 rounded-lg font-bold text-sm border border-[#bbf7d0] text-center">
                            ✓ {t('Profile updated successfully!')}
                        </div>
                    )}
                    <ErrorBanner error={error} />

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <div>
                            <label htmlFor="pname" className="block text-[13px] font-bold text-gray-700 mb-1.5">{t('Full Legal Name')}</label>
                            <input
                                id="pname"
                                type="text"
                                required
                                value={profile.name}
                                onChange={(e) => setProfile({...profile, name: e.target.value})}
                                className="w-full p-2.5 border border-gray-300 rounded-lg outline-none focus:border-[#203569] text-gray-800"
                            />
                        </div>
                        <div>
                            <label htmlFor="psid" className="block text-[13px] font-bold text-gray-700 mb-1.5">{t('Student ID')}</label>
                            <input
                                id="psid"
                                type="text"
                                disabled
                                value={profile.studentId || ''}
                                className="w-full p-2.5 border border-gray-200 rounded-lg bg-gray-50 text-gray-500 cursor-not-allowed"
                            />
                        </div>
                    </div>

                    <div>
                        <label htmlFor="pgender" className="block text-[13px] font-bold text-gray-700 mb-1.5">{t('Gender')}</label>
                        <select
                            id="pgender"
                            required
                            value={profile.gender}
                            onChange={(e) => setProfile({ ...profile, gender: e.target.value })}
                            className={`w-full p-2.5 border rounded-lg outline-none focus:border-[#203569] text-gray-800 bg-white ${profile.gender ? 'border-gray-300' : 'border-[#f59e0b]'}`}
                        >
                            <option value="" disabled>{t('Choose…')}</option>
                            <option value="MALE">{t('Male')}</option>
                            <option value="FEMALE">{t('Female')}</option>
                        </select>
                        <p className={`text-[11px] mt-1 ${profile.gender ? 'text-gray-400' : 'text-[#b45309] font-bold'}`}>
                            {profile.gender ? t('Used for roommate matching and gender-specific rentals.') : t('Please choose your gender — roommate matching needs it.')}
                        </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <div>
                            <label htmlFor="pmajor" className="block text-[13px] font-bold text-gray-700 mb-1.5">{t('Major / Course')}</label>
                            <input
                                id="pmajor"
                                type="text"
                                value={profile.major}
                                onChange={(e) => setProfile({...profile, major: e.target.value})}
                                className="w-full p-2.5 border border-gray-300 rounded-lg outline-none focus:border-[#203569] text-gray-800"
                            />
                        </div>
                        <div>
                            <label htmlFor="pyear" className="block text-[13px] font-bold text-gray-700 mb-1.5">{t('Academic Year')}</label>
                            <select
                                id="pyear"
                                value={profile.year}
                                onChange={(e) => setProfile({...profile, year: e.target.value})}
                                className="w-full p-2.5 border border-gray-300 rounded-lg outline-none focus:border-[#203569] text-gray-800 bg-white"
                            >
                                <option value="Year 1">{t('Year 1')}</option>
                                <option value="Year 2">{t('Year 2')}</option>
                                <option value="Year 3">{t('Year 3')}</option>
                                <option value="Year 4">{t('Year 4')}</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <label htmlFor="pemail" className="block text-[13px] font-bold text-gray-700 mb-1.5">{t('UTS Email')}</label>
                        <input
                            id="pemail"
                            type="email"
                            disabled
                            value={profile.email}
                            className="w-full p-2.5 border border-gray-200 rounded-lg bg-gray-50 text-gray-500 cursor-not-allowed"
                        />
                    </div>

                    <div>
                        <label htmlFor="pbio" className="block text-[13px] font-bold text-gray-700 mb-1.5">{t('Personal Bio / Roommate Notes')}</label>
                        <textarea
                            id="pbio"
                            rows="3"
                            maxLength={1000}
                            value={profile.bio}
                            onChange={(e) => setProfile({...profile, bio: e.target.value})}
                            className="w-full p-2.5 border border-gray-300 rounded-lg outline-none focus:border-[#203569] text-gray-800"
                        ></textarea>
                        <p className="text-[12px] text-gray-400 mt-1">{t('Shown on your roommate match card when your profile is visible.')}</p>
                    </div>

                    <div className="pt-4 border-t border-gray-100 flex justify-end">
                        <button
                            type="submit"
                            disabled={saving}
                            className="bg-[#203569] text-white font-bold py-3 px-6 rounded-lg hover:bg-[#1a2b56] transition shadow-sm cursor-pointer disabled:opacity-60"
                        >
                            {saving ? t('Saving...') : t('Save Changes')}
                        </button>
                    </div>
                </form>

                <div className="px-6 sm:px-8 pb-8 space-y-10">
                    <VerificationSection />
                    <MyReviewsSection />
                    <NotificationSettingsSection />
                    <PasswordSection />
                    <BlockedUsersSection />
                    <DeleteAccountSection />
                </div>
            </div>
        </div>
    );
};

export default Profile;
