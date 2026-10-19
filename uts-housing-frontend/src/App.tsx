import { lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import SiteLayout from './components/SiteLayout'
import { AuthGuard } from './lib/auth'

const HomePage = lazy(() => import('./features/public').then(module => ({ default: module.HomePage })))
const LoginPage = lazy(() => import('./features/public').then(module => ({ default: module.LoginPage })))
const RegisterPage = lazy(() => import('./features/public').then(module => ({ default: module.RegisterPage })))
const VerifyEmailPage = lazy(() => import('./features/public').then(module => ({ default: module.VerifyEmailPage })))
const ForgotPasswordPage = lazy(() => import('./features/public').then(module => ({ default: module.ForgotPasswordPage })))
const ResetPasswordPage = lazy(() => import('./features/public').then(module => ({ default: module.ResetPasswordPage })))
const StaticPage = lazy(() => import('./features/public').then(module => ({ default: module.StaticPage })))
const NotFoundPage = lazy(() => import('./features/public').then(module => ({ default: module.NotFoundPage })))
const ListingsPage = lazy(() => import('./features/listings').then(module => ({ default: module.ListingsPage })))
const ListingDetailPage = lazy(() => import('./features/listings').then(module => ({ default: module.ListingDetailPage })))
const FavoritesPage = lazy(() => import('./features/listings').then(module => ({ default: module.FavoritesPage })))
const MyListingsPage = lazy(() => import('./features/listings').then(module => ({ default: module.MyListingsPage })))
const ListingFormPage = lazy(() => import('./features/listings').then(module => ({ default: module.ListingFormPage })))
const RoommatesPage = lazy(() => import('./features/roommates').then(module => ({ default: module.RoommatesPage })))
const RoommateProfilePage = lazy(() => import('./features/roommates').then(module => ({ default: module.RoommateProfilePage })))
const RoommateDetailPage = lazy(() => import('./features/roommates').then(module => ({ default: module.RoommateDetailPage })))
const DashboardPage = lazy(() => import('./features/account').then(module => ({ default: module.DashboardPage })))
const ProfilePage = lazy(() => import('./features/account').then(module => ({ default: module.ProfilePage })))
const RequestsPage = lazy(() => import('./features/account').then(module => ({ default: module.RequestsPage })))
const ReviewsMinePage = lazy(() => import('./features/account').then(module => ({ default: module.ReviewsMinePage })))
const AdminOverviewPage = lazy(() => import('./features/admin').then(module => ({ default: module.AdminOverviewPage })))
const AdminVerificationsPage = lazy(() => import('./features/admin').then(module => ({ default: module.AdminVerificationsPage })))
const AdminListingsPage = lazy(() => import('./features/admin').then(module => ({ default: module.AdminListingsPage })))
const AdminReviewsPage = lazy(() => import('./features/admin').then(module => ({ default: module.AdminReviewsPage })))
const AdminReportsPage = lazy(() => import('./features/admin').then(module => ({ default: module.AdminReportsPage })))
const AdminCampusesPage = lazy(() => import('./features/admin').then(module => ({ default: module.AdminCampusesPage })))
const AdminAccountsPage = lazy(() => import('./features/admin').then(module => ({ default: module.AdminAccountsPage })))

export default function App() {
  return <BrowserRouter><Routes><Route element={<SiteLayout />}>
    <Route index element={<HomePage />} />
    <Route path="listings" element={<ListingsPage />} />
    <Route path="listings/:id" element={<ListingDetailPage />} />
    <Route path="login" element={<LoginPage />} />
    <Route path="register" element={<RegisterPage />} />
    <Route path="verify-email" element={<VerifyEmailPage />} />
    <Route path="forgot-password" element={<ForgotPasswordPage />} />
    <Route path="reset-password" element={<ResetPasswordPage />} />
    <Route path="dashboard" element={<AuthGuard><DashboardPage /></AuthGuard>} />
    <Route path="profile" element={<AuthGuard><ProfilePage /></AuthGuard>} />
    <Route path="favorites" element={<AuthGuard><FavoritesPage /></AuthGuard>} />
    <Route path="my-listings" element={<AuthGuard roles={['STUDENT', 'LANDLORD']}><MyListingsPage /></AuthGuard>} />
    <Route path="listings/new" element={<AuthGuard roles={['STUDENT', 'LANDLORD']}><ListingFormPage /></AuthGuard>} />
    <Route path="listings/:id/edit" element={<AuthGuard roles={['STUDENT', 'LANDLORD']}><ListingFormPage /></AuthGuard>} />
    <Route path="roommates" element={<AuthGuard roles={['STUDENT']} verifiedStudent><RoommatesPage /></AuthGuard>} />
    <Route path="roommates/profile" element={<AuthGuard roles={['STUDENT']}><RoommateProfilePage /></AuthGuard>} />
    <Route path="roommates/:id" element={<AuthGuard roles={['STUDENT']} verifiedStudent><RoommateDetailPage /></AuthGuard>} />
    <Route path="requests" element={<AuthGuard><RequestsPage /></AuthGuard>} />
    <Route path="reviews/mine" element={<AuthGuard roles={['STUDENT']} verifiedStudent><ReviewsMinePage /></AuthGuard>} />
    <Route path="admin" element={<AuthGuard roles={['ADMIN']}><AdminOverviewPage /></AuthGuard>} />
    <Route path="admin/verifications" element={<AuthGuard roles={['ADMIN']}><AdminVerificationsPage /></AuthGuard>} />
    <Route path="admin/listings" element={<AuthGuard roles={['ADMIN']}><AdminListingsPage /></AuthGuard>} />
    <Route path="admin/reviews" element={<AuthGuard roles={['ADMIN']}><AdminReviewsPage /></AuthGuard>} />
    <Route path="admin/reports" element={<AuthGuard roles={['ADMIN']}><AdminReportsPage /></AuthGuard>} />
    <Route path="admin/campuses" element={<AuthGuard roles={['ADMIN']}><AdminCampusesPage /></AuthGuard>} />
    <Route path="admin/accounts" element={<AuthGuard roles={['ADMIN']}><AdminAccountsPage /></AuthGuard>} />
    <Route path="privacy" element={<StaticPage kind="privacy" />} />
    <Route path="terms" element={<StaticPage kind="terms" />} />
    <Route path="help" element={<StaticPage kind="help" />} />
    <Route path="student/*" element={<Navigate to="/dashboard" replace />} />
    <Route path="landlord/*" element={<Navigate to="/dashboard" replace />} />
    <Route path="*" element={<NotFoundPage />} />
  </Route></Routes></BrowserRouter>
}
