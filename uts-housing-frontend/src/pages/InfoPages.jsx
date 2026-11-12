import { Link } from 'react-router-dom';
import { AuthCard } from '../components/ui';

const Section = ({ title, children }) => (
    <div className="mb-5">
        <h3 className="text-[15px] font-bold text-[#203569] mb-1.5">{title}</h3>
        <div className="text-sm text-gray-600 leading-relaxed space-y-2">{children}</div>
    </div>
);
const Back = () => <p className="mt-6 text-center text-[13px] font-bold"><Link to="/" className="text-[#203569] hover:underline">← Back to home</Link></p>;

export function NotFound() {
    return (
        <AuthCard title="Page Not Found" subtitle="The page you are looking for does not exist.">
            <div className="text-center text-5xl mb-2">🏚️</div>
            <Back />
        </AuthCard>
    );
}

export function Privacy() {
    return (
        <AuthCard title="Privacy Policy" wide>
            <Section title="What we collect">
                <p>Account details (name, e-mail, Student ID or phone), listing information, your lifestyle habit profile, messages and reviews you submit.</p>
            </Section>
            <Section title="How it is used">
                <p>Only to run the housing search, roommate matching, messaging and moderation features. Habit profiles are private until you choose “Show my profile to other students”, and you can hide them again at any time.</p>
                <p>Property addresses are only shown to logged-in users. Personal phone numbers and e-mails are never shown — students and landlords talk through in-app messages.</p>
            </Section>
            <Section title="Your choices">
                <p>You can edit your profile, pause roommate discovery, block other users and request deletion of your account from your profile page.</p>
            </Section>
            <Section title="Malaysian PDPA">
                <p>This prototype is designed with the Personal Data Protection Act 2010 in mind. A formal review is required before public launch.</p>
            </Section>
            <Back />
        </AuthCard>
    );
}

export function Terms() {
    return (
        <AuthCard title="Terms of Use" wide>
            <Section title="Information only">
                <p>The platform helps UTS students find rooms and roommates. It does not process rent or deposit payments, hold money in escrow or create tenancy agreements — those are arranged directly between you and the landlord.</p>
            </Section>
            <Section title="Accurate listings">
                <p>Landlords must post truthful, current information and mark rooms as rented once taken. Availability is reported by the owner and is not guaranteed.</p>
            </Section>
            <Section title="Respectful reviews">
                <p>Reviews must describe a genuine stay. Harassment, personal data and fabricated claims will be removed and may lead to account suspension.</p>
            </Section>
            <Back />
        </AuthCard>
    );
}

export function Help() {
    return (
        <AuthCard title="Help" wide>
            <Section title="Students">
                <p>Register with your UTS e-mail and Student ID, confirm the link we e-mail you, then use Find Housing and Find a Roommate from your dashboard.</p>
            </Section>
            <Section title="Landlords">
                <p>Create a landlord account, add your listing with at least one photo and submit it. An administrator reviews every listing before students can see it.</p>
            </Section>
            <Section title="Need more help?">
                <p>Logged-in users can message Admin Support from the Messages page.</p>
            </Section>
            <Back />
        </AuthCard>
    );
}
