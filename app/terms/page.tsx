import type { Metadata } from "next";
import { LegalPage, GrievanceOfficer } from "@/components/site/LegalPage";

export const metadata: Metadata = {
  title: "Keeper — Terms of Service",
  description: "The terms governing your use of Keeper.",
};

export default function TermsPage(): React.ReactElement {
  return (
    <LegalPage
      title="Terms of Service"
      updated="6 June 2026"
      active="terms"
      lede="Keeper helps you catch a trip falling apart — but it advises, it doesn't act for you. These terms set out what that means for both of us."
    >
      <h2>1. Acceptance</h2>
      <p>
        By creating an account or using Keeper, you agree to these Terms. If you do not agree, please
        don&apos;t use the service.
      </p>

      <h2>2. What Keeper is — and isn&apos;t</h2>
      <p>
        Keeper is a <strong>detect-and-advise</strong> tool. It monitors a flight against a downstream
        commitment and, when it predicts a collision, tells you what broke and suggests a move. It is
        <strong> advisory only</strong>: Keeper does not rebook flights, move reservations, or take any
        action on your behalf. You remain responsible for your trip and for deciding what to do.
      </p>
      <p>
        Notifications are delivered on a <strong>best-effort</strong> basis and depend on third-party
        flight data, mapping data, and push networks. Keeper may not detect every disruption, may be
        wrong, and may be delayed or unavailable. When data is unreliable, Keeper is designed to say
        &quot;can&apos;t confirm&quot; rather than guess — but you should not rely on it as your only
        safeguard for time-critical plans.
      </p>

      <h2>3. Your account</h2>
      <ul>
        <li>Provide accurate information and keep your login credentials secure.</li>
        <li>You may sign in with email and password or with Google. You&apos;re responsible for activity under your account.</li>
        <li>You must be at least 16 to use Keeper.</li>
      </ul>

      <h2>4. Acceptable use</h2>
      <p>You agree not to misuse the service — including attempting to break access controls, scrape or overload the service, reverse-engineer it, or use it to harm others.</p>

      <h2>5. Third-party data</h2>
      <p>
        Flight status, geocoding, and routing come from third parties. We don&apos;t control and
        can&apos;t guarantee their accuracy, completeness, or availability.
      </p>

      <h2>6. No warranty</h2>
      <p>
        Keeper is provided &quot;as is&quot; and &quot;as available&quot;, without warranties of any
        kind, express or implied, including fitness for a particular purpose. We do not warrant that
        Keeper will catch every cascade or that notifications will always arrive.
      </p>

      <h2>7. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, Keeper and its operators will not be liable for any
        indirect, incidental, or consequential damages, or for missed connections, reservations, or
        commitments, arising from your use of — or reliance on — the service.
      </p>

      <h2>8. Changes &amp; termination</h2>
      <p>
        We may modify or discontinue features, and may update these Terms; continued use after changes
        means you accept them. You may stop using Keeper and delete your account at any time, and we
        may suspend accounts that violate these Terms.
      </p>

      <h2>9. Governing law &amp; grievances</h2>
      <p>
        These Terms are governed by the laws of India, without regard to conflict-of-laws rules. For
        any grievance regarding the service or your data, contact our Grievance Officer, who will
        acknowledge and address complaints within the timeframes required by applicable law.
      </p>
      <GrievanceOfficer />
    </LegalPage>
  );
}
