import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { homeFor } from '../lib/api';
import { AuthCard, ErrorBanner, FieldError, inputClass, labelClass } from '../components/ui';
import Rich from '../components/Rich';
import { useT } from '../i18n';

const Register = () => {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const { register } = useAuth();
    const { t } = useT();
    const [role, setRole] = useState(params.get('role') === 'landlord' ? 'landlord' : 'student');
    const [form, setForm] = useState({
        name: '', email: '', password: '', confirm: '', studentId: '', gender: '', major: '', academicYear: 'Year 1', phone: '', acceptTerms: false,
    });
    const [error, setError] = useState(null);
    const [submitting, setSubmitting] = useState(false);

    const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

    // Student e-mails look like bcs24020031@student.uts.edu.my — fill the Student ID from it.
    const setStudentEmail = (e) => {
        const email = e.target.value;
        const local = email.split('@')[0];
        const autoId = /^[A-Za-z0-9]{6,20}$/.test(local) ? local.toUpperCase() : '';
        const followEmail = !form.studentId || form.studentId === form.email.split('@')[0].toUpperCase();
        setForm({ ...form, email, studentId: followEmail ? autoId : form.studentId });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        if (form.password !== form.confirm) {
            setError({ message: 'Passwords do not match.', fields: { confirm: 'Passwords do not match.' } });
            return;
        }
        setSubmitting(true);
        try {
            const payload = {
                role: role === 'student' ? 'STUDENT' : 'LANDLORD',
                name: form.name,
                email: form.email,
                password: form.password,
                acceptTerms: form.acceptTerms,
                ...(role === 'student'
                    ? { studentId: form.studentId, gender: form.gender || undefined, major: form.major || undefined, academicYear: form.academicYear }
                    : { phone: form.phone || undefined }),
            };
            const user = await register(payload);
            // Next step: upload the verification documents.
            navigate(user.role === 'STUDENT' ? '/student/profile' : homeFor(user.role), { replace: true, state: { justRegistered: true } });
        } catch (err) {
            setError(err);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AuthCard title="Create an Account" wide>
            <div className="flex bg-gray-100 p-1 rounded-lg mb-8" role="tablist">
                {['student', 'landlord'].map((r) => (
                    <button
                        key={r}
                        type="button"
                        role="tab"
                        aria-selected={role === r}
                        onClick={() => setRole(r)}
                        className={`flex-1 py-2 text-sm font-bold rounded-md transition-all capitalize ${role === r ? 'bg-white text-[#203569] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        {t(r === 'student' ? 'Student' : 'Landlord')}
                    </button>
                ))}
            </div>

            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                <ErrorBanner error={error} />

                <div>
                    <label htmlFor="name" className={labelClass}>{t('Full Name')}</label>
                    <input id="name" required autoComplete="name" value={form.name} onChange={set('name')} className={inputClass} />
                    <FieldError error={error} name="name" />
                </div>

                {role === 'student' ? (
                    <>
                        <div>
                            <label htmlFor="email" className={labelClass}>{t('UTS Student Email')}</label>
                            <input id="email" type="email" required autoComplete="email" value={form.email} onChange={setStudentEmail} className={inputClass} placeholder="bcs24020031@student.uts.edu.my" />
                            <p className="text-[12px] text-gray-500 mt-1">{t('Only your university student e-mail can be used. Personal e-mails (Gmail etc.) are not accepted.')}</p>
                            <FieldError error={error} name="email" />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                            <div>
                                <label htmlFor="studentId" className={labelClass}>{t('Student ID')}</label>
                                <input id="studentId" required placeholder={t('Filled in from your e-mail')} value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value.toUpperCase() })} className={inputClass} />
                                <FieldError error={error} name="studentId" />
                            </div>
                            <div>
                                <label htmlFor="academicYear" className={labelClass}>{t('Academic Year')}</label>
                                <select id="academicYear" value={form.academicYear} onChange={set('academicYear')} className={`${inputClass} bg-white`}>
                                    {['Year 1', 'Year 2', 'Year 3', 'Year 4'].map((y) => <option key={y} value={y}>{t(y)}</option>)}
                                </select>
                            </div>
                        </div>
                        <div>
                            <span className={labelClass}>{t('Gender')}</span>
                            <div role="radiogroup" aria-label={t('Gender')} className="flex gap-3">
                                {[['MALE', 'Male'], ['FEMALE', 'Female']].map(([value, text]) => (
                                    <label key={value} className={`flex-1 flex items-center justify-center gap-2 border rounded-lg py-2.5 text-sm font-bold cursor-pointer transition ${form.gender === value ? 'border-[#203569] bg-[#eef2ff] text-[#203569]' : 'border-gray-300 text-gray-600 hover:border-gray-400'}`}>
                                        <input type="radio" name="gender" value={value} required checked={form.gender === value} onChange={set('gender')} className="sr-only" />
                                        {t(text)}
                                    </label>
                                ))}
                            </div>
                            <p className="text-[11px] text-gray-400 mt-1">{t('Used for roommate matching and gender-specific rentals. Only shown to students you could be matched with.')}</p>
                            <FieldError error={error} name="gender" />
                        </div>
                        <div>
                            <label htmlFor="major" className={labelClass}>{t('Major / Course')}</label>
                            <input id="major" value={form.major} onChange={set('major')} className={inputClass} placeholder={t('e.g. Computer Science')} />
                        </div>
                        <p className="text-[12px] text-[#1e3a8a] bg-[#eff6ff] border border-[#bfdbfe] rounded-lg px-3 py-2">
                            <Rich text="After registering, confirm your e-mail and upload your <b>offer letter (PDF)</b> and a <b>photo of your student card</b>. An administrator checks them before roommate matching and reviews unlock." />
                        </p>
                    </>
                ) : (
                    <>
                        <div>
                            <label htmlFor="email" className={labelClass}>{t('Email')}</label>
                            <input id="email" type="email" required autoComplete="email" value={form.email} onChange={set('email')} className={inputClass} />
                            <FieldError error={error} name="email" />
                        </div>
                        <div>
                            <label htmlFor="phone" className={labelClass}>{t('Phone (optional, never shown publicly)')}</label>
                            <input id="phone" type="tel" value={form.phone} onChange={set('phone')} className={inputClass} />
                        </div>
                        <p className="text-[12px] text-[#1e3a8a] bg-[#eff6ff] border border-[#bfdbfe] rounded-lg px-3 py-2">
                            <Rich text="After registering, upload your <b>identity card</b> (or company registration) in Account Settings — a legal reviewer verifies it once. Every property you list also needs its <b>ownership or right-to-rent documents</b> checked before it goes live." />
                        </p>
                    </>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div>
                        <label htmlFor="password" className={labelClass}>{t('Password')}</label>
                        <input id="password" type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={set('password')} className={inputClass} />
                        <FieldError error={error} name="password" />
                    </div>
                    <div>
                        <label htmlFor="confirm" className={labelClass}>{t('Confirm Password')}</label>
                        <input id="confirm" type="password" required autoComplete="new-password" value={form.confirm} onChange={set('confirm')} className={inputClass} />
                        <FieldError error={error} name="confirm" />
                    </div>
                </div>
                <p className="text-[12px] text-gray-500 -mt-2">{t('At least 8 characters. Avoid common passwords.')}</p>

                <label className="flex items-start gap-3 text-[13px] text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={form.acceptTerms} onChange={set('acceptTerms')} className="mt-0.5 accent-[#203569] w-4 h-4" />
                    <span>{t('I agree to the')} <Link to="/terms" className="text-[#203569] font-bold hover:underline" target="_blank">{t('Terms of Use')}</Link> {t('and')} <Link to="/privacy" className="text-[#203569] font-bold hover:underline" target="_blank">{t('Privacy Policy')}</Link>{t('.')}</span>
                </label>
                <FieldError error={error} name="acceptTerms" />

                <button type="submit" disabled={submitting} className="w-full bg-[#203569] text-white font-bold py-3 px-4 rounded-lg hover:bg-[#1a2b56] transition mt-2 shadow-sm disabled:opacity-70 cursor-pointer">
                    {submitting ? t('Creating account...') : role === 'student' ? t('Register as Student') : t('Register as Landlord')}
                </button>
            </form>

            <p className="mt-6 text-center text-[13px] font-bold text-gray-500">
                {t('Already have an account?')} <Link to="/" className="text-[#203569] hover:underline">{t('Log in')}</Link>
            </p>
        </AuthCard>
    );
};

export default Register;
