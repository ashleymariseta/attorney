import Link from 'next/link';

export const metadata = { title: 'Terms of Service · Attorney' };

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/" className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">
        ← Back home
      </Link>
      <h1 className="mt-4 text-3xl font-bold tracking-tight">Terms of Service</h1>
      <p className="mt-2 text-sm text-muted">Last updated · {new Date().toLocaleDateString()}</p>

      <div className="prose prose-sm mt-8 max-w-none text-ink/85">
        <h2>1. Acceptance of terms</h2>
        <p>
          By creating an Attorney account or using the platform you agree to these terms. If you do not agree,
          do not use the service.
        </p>

        <h2>2. Who we are</h2>
        <p>
          Attorney is a workspace that introduces clients to verified lawyers and supports their engagement
          (consultations, document sharing, trust-accounted payments). We are not a law firm and do not
          provide legal advice.
        </p>

        <h2>3. Accounts</h2>
        <p>
          You must provide accurate information when registering. You are responsible for everything that
          happens under your account, and you must keep your credentials confidential.
        </p>

        <h2>4. Lawyer verification &amp; KYC</h2>
        <p>
          Lawyers must submit a valid practising certificate and bar number. Clients may be asked to provide
          a government-issued ID. We may suspend accounts that fail verification.
        </p>

        <h2>5. Payments &amp; trust accounting</h2>
        <p>
          Client funds are tracked on an internal trust ledger until released to the assigned lawyer.
          Refunds and chargebacks follow each payment method&apos;s rules. We do not advance funds.
        </p>

        <h2>6. Acceptable use</h2>
        <p>
          You may not use the platform for unlawful activity, to harass others, or to circumvent our fees by
          taking engagements off-platform that originated here.
        </p>

        <h2>7. Termination</h2>
        <p>
          We may suspend or terminate accounts that violate these terms. You can delete your account at any
          time by contacting support.
        </p>

        <h2>8. Disclaimers</h2>
        <p>
          The platform is provided &ldquo;as is&rdquo;. We make no warranty about outcomes of any legal matter
          and disclaim liability to the extent allowed by law.
        </p>

        <h2>9. Changes</h2>
        <p>We may update these terms; we&apos;ll notify users of material changes by email.</p>

        <h2>10. Contact</h2>
        <p>
          Questions? Reach us at <a href="mailto:hello@attorney.local">hello@attorney.local</a>.
        </p>
      </div>
    </main>
  );
}
