'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ScrollText, ShieldCheck } from 'lucide-react';
import { auth, lawyerProfile, ApiError, type User } from '@/lib/api';
import { useToast } from '@/components/Toast';

/**
 * Blocking verification modal for lawyers. Shown to any practitioner account
 * that hasn't submitted its practising credentials yet — it cannot be
 * dismissed (no backdrop close, no X). The only ways out are submitting the
 * bar number + practising certificate or logging out. Non-lawyer roles and
 * lawyers who have already submitted never see it.
 */
export default function VerificationGateModal({
  me,
  reloadMe,
}: {
  me: User | null;
  reloadMe: () => Promise<void>;
}) {
  const toast = useToast();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [barNumber, setBarNumber] = useState(me?.lawyer_profile?.bar_number ?? '');
  const [certNumber, setCertNumber] = useState(me?.lawyer_profile?.practising_certificate_number ?? '');
  const [expires, setExpires] = useState(me?.lawyer_profile?.practising_certificate_expires ?? '');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);

  const isLawyer = me?.role === 'lawyer';
  // Only gate lawyer accounts that haven't submitted credentials yet.
  if (!me || !isLawyer || !me.lawyer_profile || me.lawyer_profile.credentials_submitted) return null;

  async function submit() {
    const file = fileRef.current?.files?.[0];
    if (!barNumber.trim()) {
      toast.error('Enter your bar / roll number.');
      return;
    }
    if (!certNumber.trim()) {
      toast.error('Enter your practising certificate number.');
      return;
    }
    if (!file) {
      toast.error('Upload a copy of your practising certificate.');
      return;
    }
    setBusy(true);
    const form = new FormData();
    form.append('bar_number', barNumber.trim());
    form.append('practising_certificate_number', certNumber.trim());
    if (expires) form.append('practising_certificate_expires', expires);
    form.append('practising_certificate_file', file);
    try {
      await lawyerProfile.submitVerification(form);
      await reloadMe();
      toast.success('Credentials submitted — we’ll verify them against the bar registry shortly.', {
        major: true,
      });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not submit. Please try again.');
      setBusy(false);
    }
  }

  async function logout() {
    await auth.logout();
    router.push('/login');
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-line px-6 py-5">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-light/25 text-brand-dark">
            <ShieldCheck size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-ink">Verify your credentials</h2>
            <p className="text-xs text-muted">Required before you can practise on Attorney.</p>
          </div>
        </div>

        <div className="space-y-4 px-6 py-5">
          <p className="text-sm text-muted">
            To protect clients, every practitioner is verified before taking on work. Enter your bar
            details and upload your practising certificate — we check both against the bar registry.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Bar / roll number</label>
              <input className="field" value={barNumber} onChange={(e) => setBarNumber(e.target.value)} />
            </div>
            <div>
              <label className="label">Practising certificate no.</label>
              <input className="field" value={certNumber} onChange={(e) => setCertNumber(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="label">Certificate expiry (optional)</label>
            <input
              type="date"
              className="field"
              value={expires ?? ''}
              onChange={(e) => setExpires(e.target.value)}
            />
          </div>

          <div>
            <label className="label">Upload practising certificate</label>
            <div className="flex items-center gap-3 rounded-lg border border-dashed border-line bg-white px-3 py-3 text-sm">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="rounded-md bg-brand-dark px-3 py-1 text-xs font-semibold text-white hover:bg-brand"
              >
                {fileName ? 'Replace file' : 'Choose file'}
              </button>
              {fileName ? (
                <span className="flex items-center gap-1 truncate text-xs text-ink">
                  <ScrollText size={13} className="shrink-0 text-brand" />
                  {fileName}
                </span>
              ) : (
                <span className="text-xs text-muted">PDF or image, no larger than 5MB.</span>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,image/*"
                className="hidden"
                onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')}
              />
            </div>
          </div>

          <button
            onClick={submit}
            disabled={busy}
            className="w-full rounded-lg bg-brand-dark px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand disabled:opacity-50"
          >
            {busy ? 'Submitting…' : 'Submit for verification'}
          </button>
          <button
            type="button"
            onClick={logout}
            className="w-full text-center text-xs text-muted hover:text-ink"
          >
            Log out instead
          </button>
        </div>
      </div>
    </div>
  );
}
