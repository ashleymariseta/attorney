import Link from 'next/link';

export const metadata = { title: 'Privacy Policy · Attorney' };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/" className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">
        ← Back home
      </Link>
      <h1 className="mt-4 text-3xl font-bold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted">Last updated · {new Date().toLocaleDateString()}</p>

      <div className="prose prose-sm mt-8 max-w-none text-ink/85">
        <h2>What we collect</h2>
        <ul>
          <li>
            <strong>Account details</strong> — name, email, role, optional phone number, optional profile picture.
          </li>
          <li>
            <strong>KYC</strong> — for clients, an ID document (type, number, file). For lawyers, practising
            certificate details and file.
          </li>
          <li>
            <strong>Matter content</strong> — messages, documents you upload, drafts you sign, time entries,
            payments, consultations.
          </li>
          <li>
            <strong>Technical</strong> — IP address and basic device info in server logs.
          </li>
        </ul>

        <h2>How we use it</h2>
        <ul>
          <li>To operate the platform and connect clients with verified lawyers.</li>
          <li>To process payments and maintain a trust ledger.</li>
          <li>To send transactional emails (invites, password resets, booking and payment events).</li>
          <li>For security, fraud prevention, and to comply with legal obligations.</li>
        </ul>

        <h2>Who can see your data</h2>
        <ul>
          <li>
            <strong>Your assigned lawyer</strong> sees your matter content. If they belong to a firm, other
            lawyers in that firm can also see matters opened with any firm member.
          </li>
          <li>
            <strong>Platform admins</strong> may review proof-of-payment uploads and KYC documents.
          </li>
          <li>
            We do not sell your data and do not share it with third parties for marketing.
          </li>
        </ul>

        <h2>Where it lives</h2>
        <p>
          Data is stored on our application database and object storage. Files marked KYC are kept in a
          restricted bucket only accessible to verifiers.
        </p>

        <h2>Your rights</h2>
        <p>
          You can request a copy of your data or ask us to delete your account by contacting{' '}
          <a href="mailto:privacy@attorney.local">privacy@attorney.local</a>. Deletion may be delayed where law
          requires us to retain certain records (e.g. trust-ledger entries).
        </p>

        <h2>Cookies</h2>
        <p>
          We use essential cookies/localStorage to keep you signed in. We do not run third-party
          advertising trackers.
        </p>

        <h2>Changes</h2>
        <p>If we make material changes to this policy we&apos;ll notify users by email.</p>
      </div>
    </main>
  );
}
