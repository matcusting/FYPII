import { Link } from 'react-router-dom'
import { secondaryButtonClass } from './ui'
import { useI18n } from '../../lib/i18n'

export type StaticPageKind = 'privacy' | 'terms' | 'help'

export function StaticPage({ kind }: { kind: StaticPageKind }) {
  const { t } = useI18n()
  if (kind === 'privacy') return (
    <div className="mx-4 my-8 max-w-[1000px] rounded-xl border border-slate-200 bg-white px-6 py-9 text-slate-800 shadow-sm sm:mx-auto sm:w-[calc(100%-2rem)] sm:px-10 sm:py-11">
      <h1 className="border-b border-slate-200 pb-5 text-2xl font-bold text-[#203569]">{t("Privacy Notice")}</h1>
      <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">{t("This is a draft description of planned features. The project owner must confirm data retention periods, legal grounds for processing, contact details and the full legal notice before launch.")}</p>
      <section className="mt-8 space-y-3"><h2 className="text-xl font-semibold">{t("Information We Process")}</h2><p>{t("Account information includes your name, email address, role and any phone number you add. Student information you choose to provide may include your university, budget, lifestyle preferences and housing needs. We also process content submitted with listings, reviews and contact requests.")}</p><p>{t("For student verification, we collect your verified university email address, a Student ID photo and an offer letter file or photo. Authorized administrators can access these documents to decide your application; they are not displayed to other users.")}</p><p>{t("For landlord verification, we collect an identity photo and, where applicable, company registration and representative authorization documents. For each listing, we collect ownership, agency or subletting evidence. These private files are accessible only to authorized reviewers and are not displayed to other users.")}</p></section>
      <section className="mt-8 space-y-3"><h2 className="text-xl font-semibold">{t("Public Display and Privacy Controls")}</h2><p>{t("Public listings show an approximate area, not a full address by default. Students must opt in to roommate discovery. Contact information should be shared only with appropriate consent from both parties. Verification documents must not be displayed publicly.")}</p></section>
      <section className="mt-8 space-y-3"><h2 className="text-xl font-semibold">{t("Managing Your Account and Data")}</h2><p>{t("You can adjust available visibility and notification settings in your profile, pause roommate discovery and request account deletion. The exact process and timeframe still need project approval.")}</p></section>
      <p className="mt-10"><Link to="/help" className="font-semibold text-[#203569] underline">{t("View Help")}</Link></p>
    </div>
  )

  if (kind === 'terms') return (
    <div className="mx-4 my-8 max-w-[1000px] rounded-xl border border-slate-200 bg-white px-6 py-9 text-slate-800 shadow-sm sm:mx-auto sm:w-[calc(100%-2rem)] sm:px-10 sm:py-11">
      <h1 className="border-b border-slate-200 pb-5 text-2xl font-bold text-[#203569]">{t("Terms of Use")}</h1>
      <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">{t("The following is a draft description of planned features, not approved legal terms. The operating entity, dispute process and applicable law must be confirmed before launch.")}</p>
      <section className="mt-8 space-y-3"><h2 className="text-xl font-semibold">{t("Accounts and Listings")}</h2><p>{t("Members should provide accurate information and protect their accounts. Listing owners must confirm their right to list or sublet a property and provide accurate rent, availability and property details. Listings are reviewed before public display.")}</p></section>
      <section className="mt-8 space-y-3"><h2 className="text-xl font-semibold">{t("Contact and Reviews")}</h2><p>{t("When using contact, roommate matching and review features, respect others’ privacy. Do not harass others, submit false information or publish someone else’s personal details. Reviews should reflect a real rental experience and may require evidence and moderation.")}</p></section>
      <section className="mt-8 space-y-3"><h2 className="text-xl font-semibold">{t("Properties and Transactions")}</h2><p>{t("Availability is provided by listing owners and should be reconfirmed when you contact them. The platform does not currently process rent, deposits, leases or payments, and does not hold funds in escrow.")}</p></section>
      <p className="mt-10"><Link to="/privacy" className="font-semibold text-[#203569] underline">{t("View Privacy Notice")}</Link></p>
    </div>
  )

  return (
    <div className="mx-4 my-8 max-w-[1000px] rounded-xl border border-slate-200 bg-white px-6 py-9 text-slate-800 shadow-sm sm:mx-auto sm:w-[calc(100%-2rem)] sm:px-10 sm:py-11">
      <h1 className="border-b border-slate-200 pb-5 text-2xl font-bold text-[#203569]">{t("Help")}</h1>
      <div className="mt-8 space-y-8">
        <section><h2 className="text-xl font-semibold">{t("How do I find housing?")}</h2><p className="mt-2">{t("Use")}{' '}<Link to="/listings" className="font-semibold text-[#203569] underline">{t("Listing Search")}</Link>{' '}{t("to filter by area, rent and other criteria. Confirm the listing status and move-in date with the owner.")}</p></section>
        <section><h2 className="text-xl font-semibold">{t("How do I find a roommate?")}</h2><p className="mt-2">{t("Create a student account, complete the required verification and opt in to discovery in your profile settings. A match percentage shows how similar your preferences are; it does not guarantee a good living arrangement.")}</p></section>
        <section><h2 className="text-xl font-semibold">{t("How do I list a property?")}</h2><p className="mt-2">{t("After registering, create a draft in")}{' '}<Link to="/my-listings" className="font-semibold text-[#203569] underline">{t("My Listings")}</Link>{t(", add the details and photos, then submit property authorization documents. Landlords must also complete identity review. Students who sublet must provide their lease and the owner's consent. After authorization is approved, submit the listing for publication review.")}</p></section>
        <section><h2 className="text-xl font-semibold">{t("Having trouble with your account?")}</h2><p className="mt-2">{t("You can")}{' '}<Link to="/forgot-password" className="font-semibold text-[#203569] underline">{t("reset your password")}</Link>{t(". Support channels and the formal feedback process still need to be configured by the project owner.")}</p></section>
      </div>
    </div>
  )
}

export function NotFoundPage() {
  const { t } = useI18n()
  return (
    <div className="mx-4 my-8 flex min-h-[45vh] max-w-[1000px] flex-col items-center justify-center rounded-xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm sm:mx-auto sm:w-[calc(100%-2rem)]">
      <p className="text-5xl font-bold text-[#203569]">404</p>
      <h1 className="mt-4 text-3xl font-bold text-slate-950">{t("Page Not Found")}</h1>
      <p className="mt-3 text-slate-600">{t("The link may have changed, or this page may be temporarily unavailable.")}</p>
      <Link to="/" className={`${secondaryButtonClass} mt-7`}>{t("Back to Login")}</Link>
    </div>
  )
}
