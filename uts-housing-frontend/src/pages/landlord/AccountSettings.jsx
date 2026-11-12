import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/api';
import { ErrorBanner, SuccessBanner } from '../../components/ui';
import { BlockedUsersSection, DeleteAccountSection, PasswordSection, VerificationSection } from '../../components/AccountSections';

const AccountSettings = () => {
    const { user, refresh } = useAuth();
    const [form, setForm] = useState({ name: user.name, phone: user.phone || '', bio: user.bio || '' });
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState(null);

    const save = async (e) => {
        e.preventDefault();
        setError(null);
        try {
            await api('/profile', { method: 'PATCH', body: form });
            await refresh();
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (err) {
            setError(err);
        }
    };

    return (
        <div className="p-5 sm:p-10 overflow-y-auto animate-fade-in-up">
            <h2 className="text-[1.4rem] font-bold text-[#0f172a] border-b border-gray-100 pb-4 mb-6">Account Settings</h2>
            <div className="max-w-3xl space-y-10">
                <form onSubmit={save} className="space-y-5">
                    <SuccessBanner message={saved && 'Profile updated successfully!'} />
                    <ErrorBanner error={error} />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <div>
                            <label htmlFor="lname" className="block text-[13px] font-bold text-[#374151] mb-2">Display Name</label>
                            <input id="lname" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full p-3 border border-gray-300 rounded-md outline-none focus:border-[#203569] text-gray-800" />
                        </div>
                        <div>
                            <label htmlFor="lphone" className="block text-[13px] font-bold text-[#374151] mb-2">Phone (private)</label>
                            <input id="lphone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full p-3 border border-gray-300 rounded-md outline-none focus:border-[#203569] text-gray-800" />
                        </div>
                    </div>
                    <div>
                        <label htmlFor="lemail" className="block text-[13px] font-bold text-[#374151] mb-2">Email</label>
                        <input id="lemail" disabled value={user.email} className="w-full p-3 border border-gray-200 rounded-md bg-gray-50 text-gray-500 cursor-not-allowed" />
                    </div>
                    <div>
                        <label htmlFor="lbio" className="block text-[13px] font-bold text-[#374151] mb-2">About You</label>
                        <textarea id="lbio" rows="3" maxLength={1000} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} className="w-full p-3 border border-gray-300 rounded-md outline-none focus:border-[#203569] text-gray-800"></textarea>
                    </div>
                    <div className="flex justify-end">
                        <button type="submit" className="bg-[#203569] text-white font-bold py-3 px-6 rounded-md shadow-sm hover:bg-[#1a2b56] transition cursor-pointer">Save Changes</button>
                    </div>
                </form>
                <VerificationSection />
                <PasswordSection />
                <BlockedUsersSection />
                <DeleteAccountSection />
            </div>
        </div>
    );
};

export default AccountSettings;
