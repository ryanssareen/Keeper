import type { Metadata } from "next";
import { LegalPage, GrievanceOfficer } from "@/components/site/LegalPage";

export const metadata: Metadata = {
  title: "Keeper — Privacy Policy",
  description: "How Keeper collects, uses, and protects your information.",
};

export default function PrivacyPage(): React.ReactElement {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="6 June 2026"
      active="privacy"
      lede="Keeper watches the trips you ask it to — and nothing else. This policy explains what we collect, why, and the control you have over it."
    >
      <h2>1. Who we are</h2>
      <p>
        Keeper (&quot;Keeper&quot;, &quot;we&quot;, &quot;us&quot;) is a trip-state reconciliation
        service: you point it at a flight and a downstream commitment, and it tells you if and when
        the connection is about to break. This policy covers the Keeper website and app.
      </p>

      <h2>2. Information we collect</h2>
      <h3>Account information</h3>
      <p>
        When you create an account we store your <strong>email address</strong> and, optionally, your
        <strong> name</strong>. If you sign in with Google, we receive your basic Google profile
        (name, email, and profile identifier) from Google — we never receive your Google password.
        Authentication is handled by our processor, Supabase.
      </p>
      <h3>Trip data you give us</h3>
      <p>
        To watch a trip we store the <strong>flight number and date</strong>, the
        <strong> place and time of the commitment</strong> you&apos;re protecting, your arrival
        margin, whether the commitment can be moved, and any <strong>contact</strong> you choose to
        note for it. We resolve places to coordinates and a timezone so the engine can collision-check
        them.
      </p>
      <h3>Technical and device information</h3>
      <ul>
        <li>A <strong>device identifier</strong> we generate to tie a watch to the device that armed it.</li>
        <li>A <strong>push subscription</strong> (endpoint and keys) if you enable notifications, so we can deliver a catch.</li>
        <li>Your <strong>IP address</strong>, used transiently for rate-limiting and abuse prevention.</li>
        <li>Basic <strong>logs</strong> needed to operate and secure the service.</li>
      </ul>

      <h2>3. How we use your information</h2>
      <ul>
        <li>To run the reconciliation engine and detect when a commitment is at risk.</li>
        <li>To send you a catch — one notification when something actually breaks.</li>
        <li>To keep an accurate record of each watch on your dashboard, even if a push is missed.</li>
        <li>To improve prediction accuracy (our calibration corpus), using outcome data you share.</li>
        <li>To secure the service, prevent abuse, and meet legal obligations.</li>
      </ul>

      <h2>4. How your information is shared</h2>
      <p>
        We do not sell your personal information. We share it only with service providers who process
        it on our behalf, under contract:
      </p>
      <ul>
        <li><strong>Supabase</strong> — authentication and database.</li>
        <li><strong>Brevo</strong> — transactional email (e.g. when you contact us).</li>
        <li><strong>OpenStreetMap-based geocoding / routing</strong> — to resolve places and drive times.</li>
        <li><strong>Web-push services</strong> (your browser/OS push provider) — to deliver notifications.</li>
        <li><strong>Our hosting provider</strong> — to run the application.</li>
      </ul>
      <p>We may also disclose information where required by law, or to protect our rights and users&apos; safety.</p>

      <h2>5. Cookies and sessions</h2>
      <p>
        We use strictly necessary cookies to keep you signed in. We do not use advertising or
        cross-site tracking cookies.
      </p>

      <h2>6. Data retention</h2>
      <p>
        We keep watch and prediction records while your account is active, because past outcomes keep
        future predictions calibrated. Push subscriptions are pruned when they expire. You can ask us
        to delete your account and associated data at any time (see section 8).
      </p>

      <h2>7. Security and international transfers</h2>
      <p>
        Access to a watch is gated by an unguessable capability token and/or your authenticated
        account; we store only hashes of those tokens. Your data may be processed on servers outside
        your country by the providers listed above, with appropriate safeguards.
      </p>

      <h2>8. Your rights</h2>
      <p>
        Depending on where you live, you may have the right to access, correct, export, or delete your
        personal data, and to object to or restrict certain processing. To exercise any of these — or
        to raise a complaint — contact our Grievance Officer below. We respond within the timeframes
        required by applicable law.
      </p>

      <h2>9. Children</h2>
      <p>Keeper is not directed to children under 16, and we do not knowingly collect their data.</p>

      <h2>10. Changes to this policy</h2>
      <p>
        We may update this policy as the product evolves. Material changes will be reflected by the
        &quot;last updated&quot; date above and, where appropriate, an in-app notice.
      </p>

      <h2>11. Grievance Officer &amp; contact</h2>
      <p>
        In accordance with applicable law, the name and contact details of our Grievance Officer are
        published below. You can reach them for any privacy concern, data-subject request, or
        complaint about how Keeper handles your information.
      </p>
      <GrievanceOfficer />
    </LegalPage>
  );
}
