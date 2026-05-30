'use client';

import { GraduationCap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { matters, payments, ApiError, type Lawyer } from '@/lib/api';
import { useApp } from '@/components/AppShell';

const DURATIONS = [15, 30, 45, 60, 90, 120];
const METHODS = [
  ['video', 'Video call'],
  ['phone', 'Phone call'],
  ['in_person', 'In person'],
];

type Step = 'form' | 'pop' | 'done';

export default function BookModal({ lawyer, onClose }: { lawyer: Lawyer; onClose: () => void }) {
  const router = useRouter();
  const { reloadMatters, reloadConsultations } = useApp();
  const onRetainer = lawyer.on_retainer;
  const rate = lawyer.hourly_rate ? Number(lawyer.hourly_rate) : 0;

  const [step, setStep] = useState<Step>('form');
  const [title, setTitle] = useState('');
  const [areas, setAreas] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [duration, setDuration] = useState(30);
  const [method, setMethod] = useState('video');
  const [payMethod, setPayMethod] = useState('online');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [matterId, setMatterId] = useState<number | null>(null);
  const [paymentId, setPaymentId] = useState<number | null>(null);

  const availableAreas = lawyer.profile?.practice_areas ?? [];
  const price = useMemo(() => (rate * duration) / 60, [rate, duration]);

  function toggleArea(a: string) {
    setAreas((cur) => (cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const m = await matters.create({
        title,
        lawyer: lawyer.id,
        description,
        practice_areas: areas,
        duration_minutes: duration,
        consult_method: method,
        payment_method: payMethod,
        scheduled_time: scheduledTime ? new Date(scheduledTime).toISOString() : null,
      });
      await Promise.all([reloadMatters(), reloadConsultations()]);
      setMatterId(m.id);

      if (onRetainer) {
        router.push(`/matters/${m.id}`);
        return;
      }
      if (payMethod === 'online' && m.payment_id) {
        setPaymentId(m.payment_id);
        setStep('pop');
      } else {
        setStep('done'); // cash → straight to awaiting confirmation
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the engagement.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-brand-darker/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl bg-surface shadow-2xl">
        <div className="flex items-start justify-between border-b border-line p-5">
          <div>
            <h2 className="text-lg font-bold">
              {onRetainer ? 'Open a workspace' : 'Book a consultation'}
            </h2>
            <p className="text-sm text-muted">
              with {lawyer.full_name} · ${lawyer.hourly_rate ?? '—'}/hr
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost px-2 py-1 text-xl leading-none">×</button>
        </div>

        {step === 'form' && (
          <form onSubmit={onSubmit} className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
            {onRetainer && (
              <p className="flex items-center gap-2 rounded-lg bg-brand-light/15 px-3 py-2 text-sm text-brand">
                <GraduationCap size={16} /> On your legal team — no consultation or payment needed.
              </p>
            )}
            <div>
              <label className="label">What do you need help with?</label>
              <input className="field" required value={title} placeholder="e.g. Review my commercial lease"
                onChange={(e) => setTitle(e.target.value)} />
            </div>

            {availableAreas.length > 0 && (
              <div>
                <label className="label">Practice area(s)</label>
                <div className="flex flex-wrap gap-2">
                  {availableAreas.map((a) => {
                    const on = areas.includes(a);
                    return (
                      <button type="button" key={a} onClick={() => toggleArea(a)}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          on ? 'border-brand bg-brand text-white' : 'border-line text-muted hover:border-brand'
                        }`}>
                        {a}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {!onRetainer && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Preferred time</label>
                    <input className="field" type="datetime-local" value={scheduledTime}
                      onChange={(e) => setScheduledTime(e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Duration</label>
                    <select className="field" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                      {DURATIONS.map((d) => <option key={d} value={d}>{d} min</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="label">How would you like to consult?</label>
                  <div className="grid grid-cols-3 gap-2">
                    {METHODS.map(([v, l]) => (
                      <button type="button" key={v} onClick={() => setMethod(v)}
                        className={`rounded-lg border px-2 py-2 text-xs font-medium ${
                          method === v ? 'border-brand bg-brand/10 text-brand' : 'border-line text-muted'
                        }`}>{l}</button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="label">Payment</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[['online', 'Online / EFT (upload POP)'], ['cash', 'Cash (pay in person)']].map(([v, l]) => (
                      <button type="button" key={v} onClick={() => setPayMethod(v)}
                        className={`rounded-lg border px-2 py-2 text-xs font-medium ${
                          payMethod === v ? 'border-brand bg-brand/10 text-brand' : 'border-line text-muted'
                        }`}>{l}</button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-lg bg-canvas px-4 py-3">
                  <span className="text-sm text-muted">{duration} min × ${lawyer.hourly_rate ?? 0}/hr</span>
                  <span className="text-lg font-bold">${price.toFixed(2)}</span>
                </div>
              </>
            )}

            <div>
              <label className="label">Details (optional)</label>
              <textarea className="field" rows={2} value={description}
                onChange={(e) => setDescription(e.target.value)} />
            </div>

            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="btn-outline">Cancel</button>
              <button className="btn-primary" disabled={busy}>
                {busy ? 'Starting…' : onRetainer ? 'Open workspace' : 'Continue'}
              </button>
            </div>
          </form>
        )}

        {step === 'pop' && paymentId && matterId && (
          <PopStep
            paymentId={paymentId}
            amount={price}
            onDone={() => setStep('done')}
          />
        )}

        {step === 'done' && (
          <div className="space-y-4 p-6 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand-light/20 text-2xl">⏳</div>
            <h3 className="text-lg font-bold">Booking submitted</h3>
            <p className="text-sm text-muted">
              {payMethod === 'cash'
                ? 'You chose to pay cash in person. '
                : 'Your proof of payment is in review. '}
              We&rsquo;ve notified {lawyer.full_name}. You&rsquo;ll see the status update once they confirm.
            </p>
            <button className="btn-primary w-full" onClick={() => matterId && router.push(`/matters/${matterId}`)}>
              Go to matter room
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PopStep({ paymentId, amount, onDone }: { paymentId: number; amount: number; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return setError('Choose your proof of payment file.');
    setBusy(true);
    setError('');
    try {
      await payments.uploadProof(paymentId, file, reference, '');
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={upload} className="space-y-4 p-5">
      <div className="rounded-lg bg-canvas px-4 py-3">
        <p className="text-sm text-muted">Amount due</p>
        <p className="text-2xl font-bold">${amount.toFixed(2)}</p>
      </div>
      <p className="text-sm text-muted">
        Upload your proof of payment to submit this booking. Bookings only go through once a POP is
        attached (or you chose to pay cash).
      </p>
      <div>
        <label className="label">Proof of payment</label>
        <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp"
          className="block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-white" />
      </div>
      <div>
        <label className="label">Bank reference (optional)</label>
        <input className="field" value={reference} onChange={(e) => setReference(e.target.value)} />
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? 'Uploading…' : 'Submit proof of payment'}
      </button>
    </form>
  );
}
