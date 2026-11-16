import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { homeFor } from '../lib/api';
import { AuthCard, ErrorBanner, FieldError, inputClass, labelClass } from '../components/ui';

const Register = () => {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const { register } = useAuth();
    const [role, setRole] = useState(params.get('role') === 'landlord' ? 'landlord' : 'student');
    const [form, setForm] = useState({
        name: '', email: '', password: '', confirm: '', studentId: '', gender: '', major: '', academicYear: 'Year 1', phone: '', verificationNote: '', acceptTerms: false,
    });
    const [error, setError] = useState(null);
    const [submitting, setSubmitting] = useState(false);

    const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

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
                verificationNote: form.verificationNote || undefined,
                ...(role === 'student'
                    ? { studentId: form.studentId, gender: form.gender || undefined, major: form.major || undefined, academicYear: form.academicYear }
                    : { phone: form.phone || undefined }),
            };
            const user = await register(payload);
            navigate(homeFor(user.role), { replace: true });
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
                        {r}
                    </button>
                ))}
            </div>

            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                <ErrorBanner error={error} />

                <div>
                    <label htmlFor="name" className={labelClass}>Full Name</label>
                    <input id="name" required autoComplete="name" value={form.name} onChange={set('name')} className={inputClass} />
                    <FieldError error={error} name="name" />
                </div>

                {role === 'student' ? (
                    <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                            <div>
                                <label htmlFor="studentId" className={labelClass}>Student ID</label>
                                <input id="studentId" required placeholder="e.g. BCS24020031" value={form.studentId} onChange={set('studentId')} className={inputClass} />
                                <FieldError error={error} name="studentId" />
                            </div>
                            <div>
                                <label htmlFor="academicYear" className={labelClass}>Academic Year</label>
                                <select id="academicYear" value={form.academicYear} onChange={set('academicYear')} className={`${inputClass} bg-white`}>
                                    <option>Year 1</option><option>Year 2</option><option>Year 3</option><option>Year 4</option>
                                </select>
                            </div>
                        </div>
                        <div>
                            <span className={labelClass}>Gender</span>
                            <div role="radiogroup" aria-label="Gender" className="flex gap-3">
                                {[['MALE', 'Male'], ['FEMALE', 'Female']].map(([value, text]) => (
                                    <label key={value} className={`flex-1 flex items-center justify-center gap-2 border rounded-lg py-2.5 text-sm font-bold cursor-pointer transition ${form.gender === value ? 'border-[#203569] bg-[#eef2ff] text-[#203569]' : 'border-gray-300 text-gray-600 hover:border-gray-400'}`}>
                                        <input type="radio" name="gender" value={value} required checked={form.gender === value} onChange={set('gender')} className="sr-only" />
                                        {text}
                                    </label>
                                ))}
                            </div>
                            <p className="text-[11px] text-gray-400 mt-1">Used for roommate matching and gender-specific rentals. Only shown to students you could be matched with.</p>
                            <FieldError error={error} name="gender" />
                        </div>
                        <div>
                            <label htmlFor="major" className={labelClass}>Major / Course</label>
                            <input id="major" value={form.major} onChange={set('major')} className={inputClass} placeholder="e.g. Computer Science" />
                        </div>
                        <div>
                            <label htmlFor="email" className={labelClass}>UTS Email</label>
                            <input id="email" type="email" required autoComplete="email" value={form.email} onChange={set('email')} className={inputClass} placeholder="you@uts.edu.my" />
                            <p className="text-[12px] text-gray-500 mt-1">A UTS e-mail is verified automatically. Other e-mails need manual approval by an admin.</p>
                            <FieldError error={error} name="email" />
                        </div>
                    </>
                ) : (
                    <>
                        <div>
                            <label htmlFor="email" className={labelClass}>Email</label>
                            <input id="email" type="email" required autoComplete="email" value={form.email} onChange={set('email')} className={inputClass} />
                            <FieldError error={error} name="email" />
                        </div>
                        <div>
                            <label htmlFor="phone" className={labelClass}>Phone (optional, never shown publicly)</label>
                            <input id="phone" type="tel" value={form.phone} onChange={set('phone')} className={inputClass} />
                        </div>
                    </>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div>
                        <label htmlFor="password" className={labelClass}>Password</label>
                        <input id="password" type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={set('password')} className={inputClass} />
                        <FieldError error={error} name="password" />
                    </div>
                    <div>
                        <label htmlFor="confirm" className={labelClass}>Confirm Password</label>
                        <input id="confirm" type="password" required autoComplete="new-password" value={form.confirm} onChange={set('confirm')} className={inputClass} />
                        <FieldError error={error} name="confirm" />
                    </div>
                </div>
                <p className="text-[12px] text-gray-500 -mt-2">At least 8 characters. Avoid common passwords.</p>

                <div>
                    <label htmlFor="verificationNote" className={labelClass}>
                        {role === 'student' ? 'Verification note (only if you are not using a UTS e-mail)' : 'How can we verify you own or manage the property?'}
                    </label>
                    <textarea id="verificationNote" rows="2" value={form.verificationNote} onChange={set('verificationNote')} maxLength={1000} className={inputClass}
                        placeholder={role === 'student' ? 'e.g. intake, programme, student card number' : 'e.g. property address area, assessment bill name'}></textarea>
                </div>

                <label className="flex items-start gap-3 text-[13px] text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={form.acceptTerms} onChange={set('acceptTerms')} className="mt-0.5 accent-[#203569] w-4 h-4" />
                    <span>I agree to the <Link to="/terms" className="text-[#203569] font-bold hover:underline" target="_blank">Terms of Use</Link> and <Link to="/privacy" className="text-[#203569] font-bold hover:underline" target="_blank">Privacy Policy</Link>.</span>
                </label>
                <FieldError error={error} name="acceptTerms" />

                <button type="submit" disabled={submitting} className="w-full bg-[#203569] text-white font-bold py-3 px-4 rounded-lg hover:bg-[#1a2b56] transition mt-2 shadow-sm disabled:opacity-70 cursor-pointer">
                    {submitting ? 'Creating account...' : `Register as ${role === 'student' ? 'Student' : 'Landlord'}`}
                </button>
            </form>

            <p className="mt-6 text-center text-[13px] font-bold text-gray-500">
                Already have an account? <Link to="/" className="text-[#203569] hover:underline">Log in</Link>
            </p>
        </AuthCard>
    );
};

export default Register;
