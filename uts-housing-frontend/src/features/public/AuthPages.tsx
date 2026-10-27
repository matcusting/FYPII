import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import { api, messageOf } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useI18n } from '../../lib/i18n'
import { homeForUser, loginDestination } from '../../lib/routeAccess'
import { AuthLayout, fieldClass, FormNotice, primaryButtonClass } from './ui'
import { loginSchema, registerSchema, type LoginValues, type RegisterValues } from './schemas'

export function LoginPage() {
  const { t } = useI18n()
  const { signIn, user } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const [roleTab, setRoleTab] = useState<'STUDENT' | 'LANDLORD'>('STUDENT')
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  async function submit(values: LoginValues) {
    setError(null)
    try {
      const signedInUser = await signIn(values.email, values.password)
      navigate(loginDestination(searchParams.get('next'), signedInUser), { replace: true })
    } catch (failure) {
      setError(messageOf(failure))
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#f8f9fa] px-4 py-8 font-sans">
      <div className="relative top-4 w-full max-w-[420px] rounded-xl bg-white p-8 shadow-[0_8px_24px_rgba(15,23,42,0.05)] sm:p-10">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-[#203569] text-2xl font-bold text-white">UTS</div>
        <h1 className="mt-5 text-center text-[26px] font-bold leading-tight text-[#1f2937]">{t('System Login')}</h1>
        <p className="mt-2 text-center text-sm text-[#64748b]">{t('Housing & Roommate Finder')}</p>
        <div role="tablist" aria-label={t('Account Type')} className="mt-6 grid h-11 grid-cols-2 rounded-lg bg-[#f1f2f4] p-1">
          <button type="button" role="tab" aria-selected={roleTab === 'STUDENT'} onClick={() => setRoleTab('STUDENT')} className={'rounded-md text-sm font-bold transition ' + (roleTab === 'STUDENT' ? 'bg-white text-[#203569] shadow-sm' : 'text-[#667085] hover:text-[#203569]')}>{t('Student')}</button>
          <button type="button" role="tab" aria-selected={roleTab === 'LANDLORD'} onClick={() => setRoleTab('LANDLORD')} className={'rounded-md text-sm font-bold transition ' + (roleTab === 'LANDLORD' ? 'bg-white text-[#203569] shadow-sm' : 'text-[#667085] hover:text-[#203569]')}>{t('Landlord')}</button>
        </div>
        {user && <p className="mt-5 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{t('You are signed in.')} <Link to={homeForUser(user)} className="font-semibold underline">{t('Go to Your Dashboard')}</Link></p>}
        <form onSubmit={handleSubmit(submit)} noValidate className="mt-9 space-y-5">
          <FormNotice error={error} />
          <div>
            <label htmlFor="login-email" className="block text-[13px] font-bold text-[#203569]">{roleTab === 'STUDENT' ? t('UTS Email') : t('Landlord Email')}</label>
            <input id="login-email" type="email" autoComplete="email" aria-label={t('Email')} aria-invalid={!!errors.email} aria-describedby={errors.email ? 'login-email-error' : undefined} {...register('email')} className="mt-2 h-[46px] w-full rounded-lg border border-[#cbd5e1] bg-white px-3 text-[#1f2937] outline-none focus:border-[#203569] focus:ring-2 focus:ring-blue-100" />
            {errors.email && <p id="login-email-error" role="alert" className="mt-1 text-sm text-red-700">{t(errors.email.message || "")}</p>}
          </div>
          <div>
            <label htmlFor="login-password" className="block text-[13px] font-bold text-[#203569]">{t('Password')}</label>
            <input id="login-password" type="password" autoComplete="current-password" aria-label={t('Password')} aria-invalid={!!errors.password} aria-describedby={errors.password ? 'login-password-error' : undefined} {...register('password')} className="mt-2 h-[46px] w-full rounded-lg border border-[#cbd5e1] bg-white px-3 text-[#1f2937] outline-none focus:border-[#203569] focus:ring-2 focus:ring-blue-100" />
            {errors.password && <p id="login-password-error" role="alert" className="mt-1 text-sm text-red-700">{t(errors.password.message || "")}</p>}
          </div>
          <button type="submit" aria-label={t('Log In')} disabled={isSubmitting} className="mt-6 flex h-[49px] w-full items-center justify-center rounded-lg bg-[#203569] px-4 font-bold text-white shadow-sm transition hover:bg-[#1a2b56] disabled:cursor-not-allowed disabled:opacity-60">{isSubmitting ? t('Logging in…') : roleTab === 'STUDENT' ? t('Verify & Login') : t('Login as Landlord')}</button>
        </form>
      </div>
      <div className="relative top-4 mt-4 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-[#64748b]">
        <Link to="/register" className="hover:text-[#203569] hover:underline">{t('Create Account')}</Link>
        <Link to="/forgot-password" className="hover:text-[#203569] hover:underline">{t('Forgot Password?')}</Link>
        <Link to="/welcome" className="hover:text-[#203569] hover:underline">{t('Browse Website')}</Link>
      </div>
    </div>
  )
}

export function RegisterPage() {
  const { t } = useI18n()
  const [error, setError] = useState<string | null>(null)
  const [complete, setComplete] = useState(false)
  const [demoVerificationToken, setDemoVerificationToken] = useState('')
  const { register, handleSubmit, control, reset, formState: { errors, isSubmitting } } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', phone: '', password: '', confirmPassword: '', role: 'STUDENT', acceptTerms: false },
  })
  const role = useWatch({ control, name: 'role' })

  async function submit(values: RegisterValues) {
    setError(null)
    try {
      const result = await api<{ demoVerificationToken?: string }>('/auth/register', { method: 'POST', body: JSON.stringify({ name: values.name, email: values.email, ...(values.role === 'LANDLORD' ? { phone: values.phone } : {}), password: values.password, role: values.role, acceptTerms: values.acceptTerms }) })
      setDemoVerificationToken(result?.demoVerificationToken || '')
      setComplete(true)
      reset({ ...values, password: '', confirmPassword: '', acceptTerms: false })
    } catch (failure) {
      setError(messageOf(failure))
    }
  }

  return (
    <AuthLayout title="Create Account" description="Students register with a university-issued email, verify it, then submit a Student ID photo and offer letter for review. Landlords verify their email, then submit identity and property authorization documents for review.">
      {complete ? (
        <div className="space-y-5">
          <FormNotice success={demoVerificationToken ? 'Local preview account created. Use the demo verification link below before signing in.' : 'Registration submitted. Check your email for a verification link before signing in.'} />
          {!demoVerificationToken && <p className="text-sm text-slate-600">{t('If you do not receive an email, check your spam folder. If email delivery is not configured, try again later.')}</p>}
          {role === 'STUDENT' && <p className="text-sm text-slate-600">{t('Students: after verifying your school email, sign in and upload your Student ID and offer letter from Profile Settings.')}</p>}
          {role === 'LANDLORD' && <p className="text-sm text-slate-600">{t('Landlords: after verifying your email, sign in and submit your identity documents from Profile Settings. Each property also needs authorization review before publication.')}</p>}
          {demoVerificationToken && <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{t('Local preview only:')} <Link to={`/verify-email?token=${encodeURIComponent(demoVerificationToken)}`} className="font-semibold underline">{t('Open the demo email verification link')}</Link></p>}
          <div className="flex flex-wrap gap-4"><Link to="/verify-email" className="font-semibold text-blue-800 underline-offset-4 hover:underline">{t('Verify Email')}</Link><Link to="/login" className="font-semibold text-blue-800 underline-offset-4 hover:underline">{t('Go to Login')}</Link></div>
        </div>
      ) : (
        <form onSubmit={handleSubmit(submit)} noValidate className="space-y-5">
          <FormNotice error={error} />
          <fieldset><legend className="font-medium text-slate-800">{t('Account Type')}</legend><div className="mt-2 grid grid-cols-2 gap-3">
            <label className={`flex cursor-pointer items-center gap-2 rounded-xl border p-4 ${role === 'STUDENT' ? 'border-blue-700 bg-blue-50' : 'border-slate-300'}`}><input type="radio" value="STUDENT" {...register('role')} className="accent-blue-800" />{t('Student')}</label>
            <label className={`flex cursor-pointer items-center gap-2 rounded-xl border p-4 ${role === 'LANDLORD' ? 'border-blue-700 bg-blue-50' : 'border-slate-300'}`}><input type="radio" value="LANDLORD" {...register('role')} className="accent-blue-800" />{t('Landlord')}</label>
          </div></fieldset>
          <div><label htmlFor="register-name" className="font-medium text-slate-800">{t(role === 'LANDLORD' ? 'Full Legal Name' : 'Name')}</label><input id="register-name" type="text" autoComplete="name" maxLength={100} aria-invalid={!!errors.name} aria-describedby={role === 'LANDLORD' ? `register-name-hint${errors.name ? ' register-name-error' : ''}` : errors.name ? 'register-name-error' : undefined} {...register('name')} className={fieldClass} />{role === 'LANDLORD' && <p id="register-name-hint" className="mt-1 text-sm text-slate-500">{t('Use the name shown on your identity document. For a company account, enter the authorized representative’s legal name.')}</p>}{errors.name && <p id="register-name-error" role="alert" className="mt-1 text-sm text-red-700">{t(errors.name.message || "")}</p>}</div>
          <div><label htmlFor="register-email" className="font-medium text-slate-800">{t(role === 'STUDENT' ? 'University Student Email' : 'Email')}</label><input id="register-email" type="email" autoComplete="email" placeholder={role === 'STUDENT' ? 'studentid@student.uts.edu.my' : undefined} aria-invalid={!!errors.email} aria-describedby={role === 'STUDENT' ? `register-email-hint${errors.email ? ' register-email-error' : ''}` : errors.email ? 'register-email-error' : undefined} {...register('email')} className={fieldClass} />{role === 'STUDENT' && <p id="register-email-hint" className="mt-1 text-sm text-slate-500">{t('Use your university-issued student email. The part before @ should be your Student ID, for example studentid@student.uts.edu.my.')}</p>}{errors.email && <p id="register-email-error" role="alert" className="mt-1 text-sm text-red-700">{t(errors.email.message || "")}</p>}</div>
          {role === 'LANDLORD' && <div><label htmlFor="register-phone" className="font-medium text-slate-800">{t('Phone Number')} <span aria-hidden="true">*</span></label><input id="register-phone" type="tel" autoComplete="tel" inputMode="tel" maxLength={25} placeholder={t('e.g., +60 12-345 6789')} aria-invalid={!!errors.phone} aria-describedby={errors.phone ? 'register-phone-error' : undefined} {...register('phone')} className={fieldClass} /><p className="mt-1 text-sm text-slate-500">{t('Your phone number is for account contact. It is not verified by SMS.')}</p>{errors.phone && <p id="register-phone-error" role="alert" className="mt-1 text-sm text-red-700">{t(errors.phone.message || '')}</p>}</div>}
          <div><label htmlFor="register-password" className="font-medium text-slate-800">{t('Password')}</label><input id="register-password" type="password" autoComplete="new-password" aria-invalid={!!errors.password} aria-describedby={`register-password-hint${errors.password ? ' register-password-error' : ''}`} {...register('password')} className={fieldClass} /><p id="register-password-hint" className="mt-1 text-sm text-slate-500">{t('At least 8 characters.')}</p>{errors.password && <p id="register-password-error" role="alert" className="mt-1 text-sm text-red-700">{t(errors.password.message || "")}</p>}</div>
          <div><label htmlFor="register-confirm" className="font-medium text-slate-800">{t('Confirm Password')}</label><input id="register-confirm" type="password" autoComplete="new-password" aria-invalid={!!errors.confirmPassword} aria-describedby={errors.confirmPassword ? 'register-confirm-error' : undefined} {...register('confirmPassword')} className={fieldClass} />{errors.confirmPassword && <p id="register-confirm-error" role="alert" className="mt-1 text-sm text-red-700">{t(errors.confirmPassword.message || "")}</p>}</div>
          <div><label className="flex items-start gap-3 text-sm leading-6 text-slate-700"><input type="checkbox" aria-invalid={!!errors.acceptTerms} aria-describedby={errors.acceptTerms ? 'register-terms-error' : undefined} {...register('acceptTerms')} className="mt-1.5 size-4 accent-blue-800" /><span>{t('I have read and agree to the')} <Link to="/terms" className="font-semibold text-blue-800 underline">{t('Terms of Use')}</Link> {t('and')} <Link to="/privacy" className="font-semibold text-blue-800 underline">{t('Privacy Notice')}</Link>.</span></label>{errors.acceptTerms && <p id="register-terms-error" role="alert" className="mt-1 text-sm text-red-700">{t(errors.acceptTerms.message || "")}</p>}</div>
          <button type="submit" disabled={isSubmitting} className={`${primaryButtonClass} w-full`}>{isSubmitting ? t('Creating Account…') : t('Create Account')}</button>
        </form>
      )}
      <p className="mt-6 text-center text-slate-600">{t('Already have an account?')} <Link to="/login" className="font-semibold text-blue-800 underline-offset-4 hover:underline">{t('Log In')}</Link></p>
    </AuthLayout>
  )
}

export function VerifyEmailPage() {
  const { t } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const [token, setToken] = useState(searchParams.get('token') || '')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [complete, setComplete] = useState(false)
  const [resending, setResending] = useState(false)
  const [resendError, setResendError] = useState<string | null>(null)
  const [resendComplete, setResendComplete] = useState(false)
  const [demoResendToken, setDemoResendToken] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token.trim()) { setError('Enter your verification token.'); return }
    setBusy(true)
    setError(null)
    try {
      await api('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token: token.trim() }) })
      setComplete(true)
      setToken('')
      setSearchParams({}, { replace: true })
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const address = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) { setResendError('Enter a valid email address.'); return }
    setResending(true)
    setResendError(null)
    setResendComplete(false)
    setDemoResendToken('')
    try {
      const result = await api<{ demoVerificationToken?: string }>('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email: address }) })
      setDemoResendToken(result?.demoVerificationToken || '')
      setResendComplete(true)
    } catch (failure) {
      setResendError(messageOf(failure))
    } finally {
      setResending(false)
    }
  }

  return (
    <AuthLayout title="Verify Email" description="Use the link or verification code in your email to verify your address.">
      {complete ? <div className="space-y-5"><FormNotice success="Email verified. You can now sign in." /><Link to="/login" className={primaryButtonClass}>{t('Go to Login')}</Link></div> : <>
        <form onSubmit={submit} noValidate className="space-y-5">
          <FormNotice error={error} />
          <div><label htmlFor="verification-token" className="font-medium text-slate-800">{t('Verification Token')}</label><input id="verification-token" name="token" type="text" autoComplete="one-time-code" required value={token} onChange={event => setToken(event.target.value)} className={fieldClass} /><p className="mt-2 text-sm text-slate-600">{t('If the link already includes a token, select Verify Email.')}</p></div>
          <button type="submit" disabled={busy} className={`${primaryButtonClass} w-full`}>{busy ? t('Verifying…') : t('Verify Email')}</button>
        </form>
        <form onSubmit={resend} noValidate className="mt-7 space-y-4 border-t border-slate-200 pt-6">
          <h2 className="font-semibold text-slate-800">{t('Need a new verification link?')}</h2>
          <p className="text-sm text-slate-600">{t('If your link expired or did not arrive, enter the email address you registered with. You can request a new link every 10 minutes.')}</p>
          <FormNotice error={resendError} success={resendComplete ? demoResendToken ? 'A new local preview verification link is ready below.' : 'If this address belongs to an unverified account, a new verification link will be sent when eligible. Check your inbox and spam folder.' : null} />
          {demoResendToken && <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{t('Local preview only:')} <Link to={`/verify-email?token=${encodeURIComponent(demoResendToken)}`} onClick={() => setToken(demoResendToken)} className="font-semibold underline">{t('Open the demo email verification link')}</Link></p>}
          <div><label htmlFor="resend-email" className="font-medium text-slate-800">{t('Email')}</label><input id="resend-email" name="email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={event => setEmail(event.target.value)} className={fieldClass} /></div>
          <button type="submit" disabled={resending} className={`${primaryButtonClass} w-full`}>{resending ? t('Sending…') : t('Resend Verification Link')}</button>
        </form>
      </>}
    </AuthLayout>
  )
}

export function ForgotPasswordPage() {
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [complete, setComplete] = useState(false)
  const [demoResetToken, setDemoResetToken] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const address = email.trim()
    if (!address) { setError('Enter your email address.'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) { setError('Enter a valid email address.'); return }
    setBusy(true)
    setError(null)
    try {
      const result = await api<{ demoResetToken?: string }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: address }) })
      setDemoResetToken(result?.demoResetToken || '')
      setComplete(true)
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="Reset Password" description="Enter your account email address and we will send reset instructions.">
      {complete ? <div className="space-y-5"><FormNotice success={demoResetToken ? 'A local preview password reset link is ready below.' : 'If this email address is registered, you will receive a password reset email. Check your inbox and spam folder.'} />{demoResetToken && <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{t('Local preview only:')} <Link to={`/reset-password?token=${encodeURIComponent(demoResetToken)}`} className="font-semibold underline">{t('Open the demo password reset link')}</Link></p>}<Link to="/login" className="font-semibold text-blue-800 underline">{t('Back to Login')}</Link></div> : (
        <form onSubmit={submit} noValidate className="space-y-5"><FormNotice error={error} /><div><label htmlFor="forgot-email" className="font-medium text-slate-800">{t('Email')}</label><input id="forgot-email" name="email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} className={fieldClass} /></div><button type="submit" disabled={busy} className={`${primaryButtonClass} w-full`}>{busy ? t('Sending…') : t('Send Reset Instructions')}</button></form>
      )}
    </AuthLayout>
  )
}

export function ResetPasswordPage() {
  const { t } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const [token, setToken] = useState(searchParams.get('token') || '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [complete, setComplete] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (!token.trim()) { setError('Enter your reset token.'); return }
    if (password.length < 8) { setError('The new password must be at least 8 characters.'); return }
    if (!confirmPassword) { setError('Confirm your new password.'); return }
    if (confirmPassword.length < 8) { setError('The confirmation password must be at least 8 characters.'); return }
    if (password !== confirmPassword) {
      setError('The passwords do not match.')
      return
    }
    setBusy(true)
    try {
      await api('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: token.trim(), password }) })
      setComplete(true)
      setToken('')
      setPassword('')
      setConfirmPassword('')
      setSearchParams({}, { replace: true })
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="Set a New Password" description="Use the link and token in your reset email to update your password.">
      {complete ? <div className="space-y-5"><FormNotice success="Your password has been updated. Sign in with your new password." /><Link to="/login" className={primaryButtonClass}>{t('Go to Login')}</Link></div> : (
        <form onSubmit={submit} noValidate className="space-y-5">
          <FormNotice error={error} />
          <div><label htmlFor="reset-token" className="font-medium text-slate-800">{t('Reset Token')}</label><input id="reset-token" name="token" type="text" autoComplete="one-time-code" required value={token} onChange={event => setToken(event.target.value)} className={fieldClass} /></div>
          <div><label htmlFor="reset-password" className="font-medium text-slate-800">{t('New Password')}</label><input id="reset-password" name="password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={event => setPassword(event.target.value)} className={fieldClass} /><p className="mt-1 text-sm text-slate-500">{t('At least 8 characters.')}</p></div>
          <div><label htmlFor="reset-confirm" className="font-medium text-slate-800">{t('Confirm New Password')}</label><input id="reset-confirm" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} className={fieldClass} /></div>
          <button type="submit" disabled={busy} className={`${primaryButtonClass} w-full`}>{busy ? t('Updating…') : t('Update Password')}</button>
        </form>
      )}
    </AuthLayout>
  )
}
