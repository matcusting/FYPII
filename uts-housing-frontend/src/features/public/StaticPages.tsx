import { Link } from 'react-router-dom'
import { secondaryButtonClass } from './ui'
import { useI18n } from '../../lib/i18n'

export type StaticPageKind = 'privacy' | 'terms' | 'help'

export function StaticPage({ kind }: { kind: StaticPageKind }) {
  const { t } = useI18n()
  const supportEmail = String(import.meta.env.VITE_SUPPORT_EMAIL || 'matcusting@gmail.com').trim()
  const validSupportEmail = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(supportEmail)
  const operatorName = String(import.meta.env.VITE_OPERATOR_NAME || 'Marcus Ting Zhong Sheng').trim()
  const validOperatorName = operatorName.length >= 2 && operatorName.length <= 100 && ![...operatorName].some(char => char.charCodeAt(0) < 32 || char === '<' || char === '>')
  if (kind === 'privacy') return (
    <div className="mx-4 my-8 max-w-[1000px] rounded-xl border border-slate-200 bg-white px-6 py-9 text-slate-800 shadow-sm sm:mx-auto sm:w-[calc(100%-2rem)] sm:px-10 sm:py-11">
      <h1 className="border-b border-slate-200 pb-5 text-2xl font-bold text-[#203569]">{t("Privacy Notice")}</h1>
      <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">{t("This is a draft privacy notice for an independently operated site. The operator has supplied a public name and contact address and reports a written law-firm engagement. Counsel must still approve the processing basis, recipients, rights-request process, backup retention and final notice before real identity documents are accepted.")}</p>
      <section className="mt-8 space-y-3"><h2 className="text-xl font-semibold">{t("Independent Operation")}</h2><p>{t("This website is independently operated by an individual project owner. It is not an official University of Technology Sarawak service and is not represented as endorsed by the university.")}</p><p>{validOperatorName ? <>{t('Public operator name')}: {operatorName}</> : t('The public legal name of the operator still needs to be provided and approved for the final notice.')}</p>{validSupportEmail && <p>{t('For privacy or account-data requests, contact')} <a href={`mailto:${supportEmail}`} className="font-semibold text-[#203569] underline">{supportEmail}</a>.</p>}</section>
      <section className="mt-8 space-y-3"><h2 className="text-xl font-semibold">{t("Information We Process")}</h2><p>{t("Account information includes your name, email address, role and any phone number you add. Student information you choose to provide may include your university, budget, lifestyle preferences and housing needs. We also process content submitted with listings, reviews and contact requests.")}</p><p>{t("For student verification, we collect your verified university email address, a Student ID photo and an offer letter file or photo. Authorized administrators can access these documents to decide your application; they are not displayed to other users.")}</p><p>{t("For landlord verification, we collect an identity photo and, where applicable, company registration and representative authorization documents. For each listing, we collect ownership, agency or subletting evidence. These private files are accessible only to authorized reviewers and are not displayed to other users.")}</p></section>
      <section className="mt-8 space-y-3"><h2 className="text-xl font-semibold">{t("External Legal Review")}</h2><p>{t("An administrator assigns pending landlord identity and property-authorization cases to a restricted legal reviewer, who can inspect only their assigned materials and record a recommendation. Approval requires an affirmative recommendation. A platform administrator makes the final website approval decision. Legal review does not guarantee document authenticity, ownership, or that a rental is safe.")}</p><p>{t("The project owner reports that an external law firm has accepted a written engagement. Its reviewers must receive restricted case access and agreed confidentiality, retention, incident and handover procedures before real identity documents are reviewed. This draft does not publicly name or endorse the firm.")}</p></section>
      <section className="mt-8 space-y-3"><h2 className="text-xl font-semibold">{t("Public Display and Privacy Controls")}</h2><p>{t("Public listings show an approximate area and, when available, a distance to the selected campus. The full address is hidden by default. The address is sent to an address lookup provider to calculate approximate straight-line distance; exact coordinates are not shown to other users. Students must opt in to roommate discovery. Verification documents are not displayed publicly.")}</p></section>
      <section className="mt-8 space-y-3"><h2 className="text-xl font-semibold">{t("Delivery and Verification Providers")}</h2><p>{t("If real email or SMS delivery is configured, the relevant provider receives your email address or phone number and the message or one-time code needed to deliver it. Local test outboxes do not send messages to your real mailbox or phone. A university enrollment result is recorded only when an authorized reviewer actually checks an approved source; uploaded documents and a university email address alone do not prove current enrollment.")}</p></section>
      <section className="mt-8 space-y-3"><h2 className="text-xl font-semibold">{t("Managing Your Account and Data")}</h2><p>{t("You can adjust available visibility and notification settings in your profile, pause roommate discovery and request account deletion. The exact process and timeframe still need project approval.")}</p></section>
      <section className="mt-8 space-y-3"><h2 className="text-xl font-semibold">{t("Document Retention")}</h2><p>{t("An approved student's verified status ends after the study end date recorded from the offer letter; continuing verified access requires a new review. The Student ID and offer-letter files become eligible for removal from active private storage one calendar year after that date. Older approved cases without a recorded date require manual review and are not automatically purged.")}</p><p>{t("Approved landlord identity and property-authorization files remain available while their approval is current, then become eligible for removal two calendar years after approval expiry. Rejected landlord and property files become eligible two calendar years after rejection; revoked files two calendar years after revocation. Account-deletion requests follow a separate reviewed process and preservation holds take priority. These rules cover document files, not case records or encrypted backups; actual scheduled removal and backup retention require separate operator approval.")}</p></section>
      <p className="mt-10"><Link to="/help" className="font-semibold text-[#203569] underline">{t("View Help")}</Link></p>
    </div>
  )

  if (kind === 'terms') return (
    <div className="mx-4 my-8 max-w-[1000px] rounded-xl border border-slate-200 bg-white px-6 py-9 text-slate-800 shadow-sm sm:mx-auto sm:w-[calc(100%-2rem)] sm:px-10 sm:py-11">
      <h1 className="border-b border-slate-200 pb-5 text-2xl font-bold text-[#203569]">{t("Terms of Use")}</h1>
      <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">{t("These draft terms describe current local functionality but are not approved legal terms. The operator has provided a public name and reports a written law-firm engagement; counsel must still approve the complaint and dispute process, applicable law and final terms before launch.")}</p>
      <p className="mt-4 text-sm text-slate-700">{t("This is an independently operated student-housing project, not an official UTS service or university endorsement.")}</p>
      <section className="mt-8 space-y-3"><h2 className="text-xl font-semibold">{t("Accounts and Listings")}</h2><p>{t("Members should provide accurate information and protect their accounts. Listing owners must confirm their right to list or sublet a property and provide accurate rent, availability and property details. Listings are reviewed before public display.")}</p></section>
      <section className="mt-8 space-y-3"><h2 className="text-xl font-semibold">{t("Landlord Review")}</h2><p>{t("A landlord submits identity and property-authorization evidence, with company and representative documents where applicable. An assigned legal reviewer records a recommendation, and a platform administrator makes the final website decision. Approval requires the reviewer's affirmative recommendation and does not certify title, ownership, identity, or legal suitability of a tenancy.")}</p></section>
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
        <section><h2 className="text-xl font-semibold">{t("Who checks landlord documents?")}</h2><p className="mt-2">{t("An assigned legal reviewer checks the landlord identity or property-authorization case and records a recommendation. A platform administrator makes the final website decision; approval requires an affirmative recommendation and the required checks. Ask the support contact about the review process before sending real documents.")}</p></section>
        <section><h2 className="text-xl font-semibold">{t("Having trouble with your account?")}</h2><p className="mt-2">{t("You can")}{' '}<Link to="/forgot-password" className="font-semibold text-[#203569] underline">{t("reset your password")}</Link>{validSupportEmail ? '.' : t(". Support channels and the formal feedback process still need to be configured by the project owner.")}</p>
          {validSupportEmail && <p className="mt-3 text-sm text-slate-700">{t('For help, email')} <a href={`mailto:${supportEmail}`} className="font-semibold text-[#203569] underline">{supportEmail}</a>.</p>}
        </section>
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
