export { AdminOverviewPage } from './AdminOverviewPage'
export { AdminCampusesPage } from './AdminCampusesPage'
export { AdminModerationPage } from './AdminModerationPage'

import { AdminModerationPage } from './AdminModerationPage'

export function AdminVerificationsPage() { return <AdminModerationPage kind="verifications" /> }
export function AdminLandlordVerificationsPage() { return <AdminModerationPage kind="landlord-verifications" /> }
export function AdminPropertyAuthorizationsPage() { return <AdminModerationPage kind="property-authorizations" /> }
export function AdminListingsPage() { return <AdminModerationPage kind="listings" /> }
export function AdminReviewsPage() { return <AdminModerationPage kind="reviews" /> }
export function AdminReportsPage() { return <AdminModerationPage kind="reports" /> }
export function AdminAccountsPage() { return <AdminModerationPage kind="accounts" /> }
