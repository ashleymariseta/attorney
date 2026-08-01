'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, ScrollText, ShieldCheck } from 'lucide-react';
import { auth, lawyerProfile, userMe, ApiError, type User } from '@/lib/api';
import { useToast } from '@/components/Toast';
import TagSelect from '@/components/TagSelect';
import { PRACTICE_AREA_OPTIONS, JURISDICTION_OPTIONS } from '@/lib/lawyerOptions';

function initials(u: User) {
  const fromName = `${u.first_name?.[0] ?? ''}${u.last_name?.[0] ?? ''}`.trim();
  return (fromName || u.email?.[0] || '').toUpperCase();
}

/**
 * Blocking verification modal for lawyers. Shown to any practitioner account
 * that hasn't submitted its practising credentials yet — it cannot be
 * dismissed (no backdrop close, no X). The only ways out are submitting the
 * practising certificate or logging out. Non-lawyer roles and lawyers who have
 * already submitted never see it.
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
  const avatarRef = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(me?.avatar_url ?? null);
  const [barNumber, setBarNumber] = useState(me?.lawyer_profile?.bar_number ?? '');
  const [certNumber, setCertNumber] = useState(me?.lawyer_profile?.practising_certificate_number ?? '');
  const [issued, setIssued] = useState(me?.lawyer_profile?.practising_certificate_issued ?? '');
  const [expires, setExpires] = useState(me?.lawyer_profile?.practising_certificate_expires ?? '');
  const [areas, setAreas] = useState<string[]>(me?.lawyer_profile?.practice_areas ?? []);
  const [jurisdictions, setJurisdictions] = useState<string[]>(me?.lawyer_profile?.jurisdictions ?? []);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);

  const isLawyer = me?.role === 'lawyer';
  // Only gate lawyer accounts that haven't submitted credentials yet. A missing
  // lawyer_profile counts as "not submitted", NOT as "nothing to do" — accounts
  // converted to lawyer after signup have no profile row until they touch the
  // profile endpoint, and skipping them let them straight past the gate.
  if (!me || !isLawyer || me.lawyer_profile?.credentials_submitted) return null;

  async function onAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const updated = await userMe.uploadAvatar(file);
      setAvatarUrl(updated.avatar_url ?? null);
      await reloadMe();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not upload photo.');
    }
  }

  async function submit() {
    const file = fileRef.current?.files?.[0];
    if (!certNumber.trim()) {
      toast.error('Enter your practising certificate number.');
      return;
    }
    if (!issued) {
      toast.error('Enter the date your certificate was issued.');
      return;
    }
    if (!file) {
      toast.error('Upload a copy of your practising certificate.');
      return;
    }
    setBusy(true);
    try {
      // Practice areas / jurisdictions are JSON fields — send them as a JSON
      // PATCH, separate from the multipart certificate upload below.
      if (areas.length || jurisdictions.length) {
        await lawyerProfile.update({ practice_areas: areas, jurisdictions });
      }
      const form = new FormData();
      form.append('bar_number', barNumber.trim());
      form.append('practising_certificate_number', certNumber.trim());
      form.append('practising_certificate_issued', issued);
      if (expires) form.append('practising_certificate_expires', expires);
      form.append('practising_certificate_file', file);
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/60 p-3 sm:p-4">
      <div className="my-auto w-full max-w-md overflow-x-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-line px-5 py-4 sm:px-6 sm:py-5">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-light/25 text-brand-dark">
            <ShieldCheck size={20} />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-ink">Verify your credentials</h2>
            <p className="text-xs text-muted">Required before you can practise on Attorney.</p>
          </div>
        </div>

        <div className="space-y-4 px-5 py-5 sm:px-6">
          <p className="text-sm text-muted">
            To protect clients, every practitioner is verified before taking on work. Add your photo,
            confirm your practice details and upload your practising certificate.
          </p>

          {/* Profile photo */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-full border border-line bg-canvas text-lg font-bold text-brand-dark">
                {avatarUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span>{initials(me)}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => avatarRef.current?.click()}
                aria-label="Add profile photo"
                className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full border border-line bg-white text-brand-dark shadow-card hover:border-brand hover:text-brand"
              >
                <Camera size={14} />
              </button>
              <input ref={avatarRef} type="file" accept="image/*" className="hidden" onChange={onAvatarPick} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">Profile photo</p>
              <p className="text-xs text-muted">Clients see this on your profile. Optional.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Practising certificate no.</label>
              <input className="field w-full" value={certNumber} onChange={(e) => setCertNumber(e.target.value)} />
            </div>
            <div>
              <label className="label">Bar / roll number (optional)</label>
              <input className="field w-full" value={barNumber} onChange={(e) => setBarNumber(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Issued / admitted on</label>
              <input
                type="date"
                className="field w-full min-w-0"
                value={issued ?? ''}
                onChange={(e) => setIssued(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-muted">Used to calculate your years of experience.</p>
            </div>
            <div>
              <label className="label">Expiry (optional)</label>
              <input
                type="date"
                className="field w-full min-w-0"
                value={expires ?? ''}
                onChange={(e) => setExpires(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="label">Practice areas</label>
            <TagSelect
              value={areas}
              onChange={setAreas}
              options={PRACTICE_AREA_OPTIONS}
              placeholder="Search or add areas of law…"
            />
          </div>

          <div>
            <label className="label">Jurisdictions</label>
            <TagSelect
              value={jurisdictions}
              onChange={setJurisdictions}
              options={JURISDICTION_OPTIONS}
              placeholder="Search or add jurisdictions…"
            />
          </div>

          <div>
            <label className="label">Upload practising certificate</label>
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-line bg-white px-3 py-3 text-sm">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="rounded-md bg-brand-dark px-3 py-1 text-xs font-semibold text-white hover:bg-brand"
              >
                {fileName ? 'Replace file' : 'Choose file'}
              </button>
              {fileName ? (
                <span className="flex min-w-0 items-center gap-1 truncate text-xs text-ink">
                  <ScrollText size={13} className="shrink-0 text-brand" />
                  <span className="truncate">{fileName}</span>
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
