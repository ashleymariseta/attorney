'use client';

import Image from 'next/image';
import { useRef, useState } from 'react';
import { Clock, FileUp, ShieldCheck } from 'lucide-react';
import { auth, subscription, ApiError, type User } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { useRouter } from 'next/navigation';

/**
 * Blocking gate for lawyers whose monthly subscription isn't active. Shown when
 * `me.subscription.enforced` and state !== 'active'. Cannot be dismissed — the
 * only ways out are a verified payment or logging out.
 */
export default function SubscriptionGate({ me, reloadMe }: { me: User | null; reloadMe: () => Promise<void> }) {
  const toast = useToast();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState('');

  const sub = me?.subscription;
  if (!sub || !sub.enforced || sub.state === 'active') return null;

  const pending = sub.state === 'pending';

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setBusy(true);
    try {
      await subscription.uploadPop(file);
      await reloadMe();
      toast.success('Proof uploaded — awaiting verification.', { major: true });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not upload. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await auth.logout();
    router.push('/login');
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/60 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center gap-3 bg-gradient-to-br from-brand-dark to-brand px-6 py-5">
          <Image
            src="/img/logos/logo-horizontal-white.png"
            alt="Legal Online"
            width={120}
            height={40}
            className="h-7 w-auto object-contain"
          />
        </div>

        <div className="space-y-4 p-6">
          {pending ? (
            <>
              <div className="flex items-center gap-2 text-brand-dark">
                <Clock size={18} />
                <h2 className="text-lg font-bold">Awaiting verification</h2>
              </div>
              <p className="text-sm text-ink/80">
                We&rsquo;ve received your proof of payment. Verification usually takes about{' '}
                <span className="font-semibold">30 minutes</span>. You&rsquo;ll get full access as
                soon as it&rsquo;s confirmed — you can check back shortly.
              </p>
              <button
                onClick={reloadMe}
                className="w-full rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-canvas"
              >
                I&rsquo;ve waited — check again
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 text-brand-dark">
                <ShieldCheck size={18} />
                <h2 className="text-lg font-bold">Monthly subscription required</h2>
              </div>
              {sub.state === 'rejected' && sub.review_note && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{sub.review_note}</p>
              )}
              <div className="rounded-xl border border-line bg-canvas px-4 py-4 text-center">
                <p className="text-xs uppercase tracking-wide text-muted">This month</p>
                <p className="mt-1 text-3xl font-extrabold text-brand-dark">
                  ${sub.amount}
                  <span className="text-base font-semibold text-muted">/month</span>
                </p>
              </div>
              <p className="text-sm text-ink/80">
                Pay this month&rsquo;s subscription, then upload your proof of payment below.
                We&rsquo;ll verify it (usually within <span className="font-semibold">30 minutes</span>)
                and restore full access.
              </p>
              <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={onFile} />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-50"
              >
                <FileUp size={16} /> {busy ? 'Uploading…' : fileName ? 'Upload another' : 'Upload proof of payment'}
              </button>
            </>
          )}

          <button onClick={logout} className="w-full text-center text-xs font-medium text-muted hover:text-ink">
            Log out instead
          </button>
        </div>
      </div>
    </div>
  );
}
