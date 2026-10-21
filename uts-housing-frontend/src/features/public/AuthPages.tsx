import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import { api, messageOf } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { homeForUser, loginDestination } from '../../lib/routeAccess'
import { AuthLayout, fieldClass, FormNotice, primaryButtonClass } from './ui'
import { loginSchema, registerSchema, type LoginValues, type RegisterValues } from './schemas'

export function LoginPage() {
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
        <h1 className="mt-5 text-center text-[26px] font-bold leading-tight text-[#1f2937]">System Login</h1>
        <p className="mt-2 text-center text-sm text-[#64748b]">Housing &amp; Roommate Finder</p>
        <div role="tablist" aria-label="Account Type" className="mt-6 grid h-11 grid-cols-2 rounded-lg bg-[#f1f2f4] p-1">
          <button type="button" role="tab" aria-selected={roleTab === 'STUDENT'} onClick={() => setRoleTab('STUDENT')} className={'rounded-md text-sm font-bold transition ' + (roleTab === 'STUDENT' ? 'bg-white text-[#203569] shadow-sm' : 'text-[#667085] hover:text-[#203569]')}>Student</button>
          <button type="button" role="tab" aria-selected={roleTab === 'LANDLORD'} onClick={() => setRoleTab('LANDLORD')} className={'rounded-md text-sm font-bold transition ' + (roleTab === 'LANDLORD' ? 'bg-white text-[#203569] shadow-sm' : 'text-[#667085] hover:text-[#203569]')}>Landlord</button>
        </div>
        {user && <p className="mt-5 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">You are signed in. <Link to={homeForUser(user)} className="font-semibold underline">Go to Your Dashboard</Link></p>}
        <form onSubmit={handleSubmit(submit)} noValidate className="mt-9 space-y-5">
          <FormNotice error={error} />
          <div>
            <label htmlFor="login-email" className="block text-[13px] font-bold text-[#203569]">{roleTab === 'STUDENT' ? 'UTS Email' : 'Landlord Email'}</label>
            <input id="login-email" type="email" autoComplete="email" aria-label="Email" aria-invalid={!!errors.email} aria-describedby={errors.email ? 'login-email-error' : undefined} {...register('email')} className="mt-2 h-[46px] w-full rounded-lg border border-[#cbd5e1] bg-white px-3 text-[#1f2937] outline-none focus:border-[#203569] focus:ring-2 focus:ring-blue-100" />
            {errors.email && <p id="login-email-error" role="alert" className="mt-1 text-sm text-red-700">{errors.email.message}</p>}
          </div>
          <div>
            <label htmlFor="login-password" className="block text-[13px] font-bold text-[#203569]">Password</label>
            <input id="login-password" type="password" autoComplete="current-password" aria-label="Password" aria-invalid={!!errors.password} aria-describedby={errors.password ? 'login-password-error' : undefined} {...register('password')} className="mt-2 h-[46px] w-full rounded-lg border border-[#cbd5e1] bg-white px-3 text-[#1f2937] outline-none focus:border-[#203569] focus:ring-2 focus:ring-blue-100" />
            {errors.password && <p id="login-password-error" role="alert" className="mt-1 text-sm text-red-700">{errors.password.message}</p>}
          </div>
          <button type="submit" aria-label="Log In" disabled={isSubmitting} className="mt-6 flex h-[49px] w-full items-center justify-center rounded-lg bg-[#203569] px-4 font-bold text-white shadow-sm transition hover:bg-[#1a2b56] disabled:cursor-not-allowed disabled:opacity-60">{isSubmitting ? 'Logging in…' : roleTab === 'STUDENT' ? 'Verify & Login' : 'Login as Landlord'}</button>
        </form>
      </div>
      <div className="relative top-4 mt-4 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-[#64748b]">
        <Link to="/register" className="hover:text-[#203569] hover:underline">Create Account</Link>
        <Link to="/forgot-password" className="hover:text-[#203569] hover:underline">Forgot Password?</Link>
        <Link to="/welcome" className="hover:text-[#203569] hover:underline">Browse Website</Link>
      </div>
    </div>
  )
}

export function RegisterPage() {
  const [error, setError] = useState<string | null>(null)
  const [complete, setComplete] = useState(false)
  const { register, handleSubmit, control, reset, formState: { errors, isSubmitting } } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '', confirmPassword: '', role: 'STUDENT', acceptTerms: false },
  })
  const role = useWatch({ control, name: 'role' })

  async function submit(values: RegisterValues) {
    setError(null)
    try {
      await api('/auth/register', { method: 'POST', body: JSON.stringify({ name: values.name, email: values.email, password: values.password, role: values.role, acceptTerms: values.acceptTerms }) })
      setComplete(true)
      reset({ ...values, password: '', confirmPassword: '', acceptTerms: false })
    } catch (failure) {
      setError(messageOf(failure))
    }
  }

  return (
    <AuthLayout title="Create Account" description="Choose a student or landlord account. Student-only features still require verification.">
      {complete ? (
        <div className="space-y-5">
          <FormNotice success="Registration submitted. Check your email for a verification link before signing in." />
          <p className="text-sm text-slate-600">If you do not receive an email, check your spam folder. If email delivery is not configured, try again later.</p>
          <div className="flex flex-wrap gap-4"><Link to="/verify-email" className="font-semibold text-blue-800 underline-offset-4 hover:underline">Verify Email</Link><Link to="/login" className="font-semibold text-blue-800 underline-offset-4 hover:underline">Go to Login</Link></div>
        </div>
      ) : (
        <form onSubmit={handleSubmit(submit)} noValidate className="space-y-5">
          <FormNotice error={error} />
          <fieldset><legend className="font-medium text-slate-800">Account Type</legend><div className="mt-2 grid grid-cols-2 gap-3">
            <label className={`flex cursor-pointer items-center gap-2 rounded-xl border p-4 ${role === 'STUDENT' ? 'border-blue-700 bg-blue-50' : 'border-slate-300'}`}><input type="radio" value="STUDENT" {...register('role')} className="accent-blue-800" />Student</label>
            <label className={`flex cursor-pointer items-center gap-2 rounded-xl border p-4 ${role === 'LANDLORD' ? 'border-blue-700 bg-blue-50' : 'border-slate-300'}`}><input type="radio" value="LANDLORD" {...register('role')} className="accent-blue-800" />Landlord</label>
          </div></fieldset>
          <div><label htmlFor="register-name" className="font-medium text-slate-800">Name</label><input id="register-name" type="text" autoComplete="name" maxLength={100} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'register-name-error' : undefined} {...register('name')} className={fieldClass} />{errors.name && <p id="register-name-error" role="alert" className="mt-1 text-sm text-red-700">{errors.name.message}</p>}</div>
          <div><label htmlFor="register-email" className="font-medium text-slate-800">Email</label><input id="register-email" type="email" autoComplete="email" aria-invalid={!!errors.email} aria-describedby={errors.email ? 'register-email-error' : undefined} {...register('email')} className={fieldClass} />{errors.email && <p id="register-email-error" role="alert" className="mt-1 text-sm text-red-700">{errors.email.message}</p>}</div>
          <div><label htmlFor="register-password" className="font-medium text-slate-800">Password</label><input id="register-password" type="password" autoComplete="new-password" aria-invalid={!!errors.password} aria-describedby={`register-password-hint${errors.password ? ' register-password-error' : ''}`} {...register('password')} className={fieldClass} /><p id="register-password-hint" className="mt-1 text-sm text-slate-500">At least 8 characters.</p>{errors.password && <p id="register-password-error" role="alert" className="mt-1 text-sm text-red-700">{errors.password.message}</p>}</div>
          <div><label htmlFor="register-confirm" className="font-medium text-slate-800">Confirm Password</label><input id="register-confirm" type="password" autoComplete="new-password" aria-invalid={!!errors.confirmPassword} aria-describedby={errors.confirmPassword ? 'register-confirm-error' : undefined} {...register('confirmPassword')} className={fieldClass} />{errors.confirmPassword && <p id="register-confirm-error" role="alert" className="mt-1 text-sm text-red-700">{errors.confirmPassword.message}</p>}</div>
          <div><label className="flex items-start gap-3 text-sm leading-6 text-slate-700"><input type="checkbox" aria-invalid={!!errors.acceptTerms} aria-describedby={errors.acceptTerms ? 'register-terms-error' : undefined} {...register('acceptTerms')} className="mt-1.5 size-4 accent-blue-800" /><span>I have read and agree to the <Link to="/terms" className="font-semibold text-blue-800 underline">Terms of Use</Link> and <Link to="/privacy" className="font-semibold text-blue-800 underline">Privacy Notice</Link>.</span></label>{errors.acceptTerms && <p id="register-terms-error" role="alert" className="mt-1 text-sm text-red-700">{errors.acceptTerms.message}</p>}</div>
          <button type="submit" disabled={isSubmitting} className={`${primaryButtonClass} w-full`}>{isSubmitting ? 'Creating Account…' : 'Create Account'}</button>
        </form>
      )}
      <p className="mt-6 text-center text-slate-600">Already have an account? <Link to="/login" className="font-semibold text-blue-800 underline-offset-4 hover:underline">Log In</Link></p>
    </AuthLayout>
  )
}

export function VerifyEmailPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [token, setToken] = useState(searchParams.get('token') || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [complete, setComplete] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token.trim()) return
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

  return (
    <AuthLayout title="Verify Email" description="Use the link or verification code in your email to verify your address.">
      {complete ? <div className="space-y-5"><FormNotice success="Email verified. You can now sign in." /><Link to="/login" className={primaryButtonClass}>Go to Login</Link></div> : (
        <form onSubmit={submit} className="space-y-5">
          <FormNotice error={error} />
          <div><label htmlFor="verification-token" className="font-medium text-slate-800">Verification Token</label><input id="verification-token" name="token" type="text" autoComplete="one-time-code" required value={token} onChange={event => setToken(event.target.value)} className={fieldClass} /><p className="mt-2 text-sm text-slate-600">If the link already includes a token, select Verify Email.</p></div>
          <button type="submit" disabled={busy} className={`${primaryButtonClass} w-full`}>{busy ? 'Verifying…' : 'Verify Email'}</button>
        </form>
      )}
    </AuthLayout>
  )
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [complete, setComplete] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: email.trim() }) })
      setComplete(true)
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="Reset Password" description="Enter your account email address and we will send reset instructions.">
      {complete ? <div className="space-y-5"><FormNotice success="If this email address is registered, you will receive a password reset email. Check your inbox and spam folder." /><Link to="/login" className="font-semibold text-blue-800 underline">Back to Login</Link></div> : (
        <form onSubmit={submit} className="space-y-5"><FormNotice error={error} /><div><label htmlFor="forgot-email" className="font-medium text-slate-800">Email</label><input id="forgot-email" name="email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} className={fieldClass} /></div><button type="submit" disabled={busy} className={`${primaryButtonClass} w-full`}>{busy ? 'Sending…' : 'Send Reset Instructions'}</button></form>
      )}
    </AuthLayout>
  )
}

export function ResetPasswordPage() {
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
      {complete ? <div className="space-y-5"><FormNotice success="Your password has been updated. Sign in with your new password." /><Link to="/login" className={primaryButtonClass}>Go to Login</Link></div> : (
        <form onSubmit={submit} className="space-y-5">
          <FormNotice error={error} />
          <div><label htmlFor="reset-token" className="font-medium text-slate-800">Reset Token</label><input id="reset-token" name="token" type="text" autoComplete="one-time-code" required value={token} onChange={event => setToken(event.target.value)} className={fieldClass} /></div>
          <div><label htmlFor="reset-password" className="font-medium text-slate-800">New Password</label><input id="reset-password" name="password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={event => setPassword(event.target.value)} className={fieldClass} /><p className="mt-1 text-sm text-slate-500">At least 8 characters.</p></div>
          <div><label htmlFor="reset-confirm" className="font-medium text-slate-800">Confirm New Password</label><input id="reset-confirm" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} className={fieldClass} /></div>
          <button type="submit" disabled={busy} className={`${primaryButtonClass} w-full`}>{busy ? 'Updating…' : 'Update Password'}</button>
        </form>
      )}
    </AuthLayout>
  )
}
