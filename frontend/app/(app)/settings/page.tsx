'use client';

import { useEffect, useState } from 'react';
import { lawyerProfile, ApiError, type LawyerProfileEdit } from '@/lib/api';
import { useApp } from '@/components/AppShell';

export default function SettingsPage() {
  const { me } = useApp();
  const isLawyer = me?.role === 'lawyer';
  const [form, setForm] = useState<LawyerProfileEdit | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isLawyer) return;
    lawyerProfile.get().then(setForm).catch(() => setError('Could not load profile.'));
  }, [isLawyer]);

  if (!isLawyer) {
    return <div className="mx-auto max-w-2xl px-4 py-8"><p className="text-sm text-muted">Settings are available for lawyer accounts.</p></div>;
  }
  if (!form) return <p className="p-8 text-sm text-muted">Loading…</p>;

  function set<K extends keyof LawyerProfileEdit>(k: K, v: LawyerProfileEdit[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setSaved(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setError('');
    try {
      const updated = await lawyerProfile.update({
        hourly_rate: form.hourly_rate,
        consultation_price: form.consultation_price,
        practice_areas: form.practice_areas,
        jurisdictions: form.jurisdictions,
        languages: form.languages,
        years_experience: form.years_experience,
        bio: form.bio,
        bar_number: form.bar_number,
      });
      setForm(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  const list = (arr: string[]) => arr.join(', ');
  const parse = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold">Settings & Rate</h1>
      <p className="text-sm text-muted">This is what clients see on your directory card.</p>

      <form onSubmit={save} className="mt-6 space-y-5">
        <div className="card space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted">Your rate</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Hourly rate (USD)</label>
              <input className="field" type="number" min="0" step="1" value={form.hourly_rate ?? ''}
                onChange={(e) => set('hourly_rate', e.target.value)} />
              <p className="mt-1 text-xs text-muted">Bookings are priced as rate × minutes.</p>
            </div>
            <div>
              <label className="label">Consultation base (USD)</label>
              <input className="field" type="number" min="0" step="1" value={form.consultation_price ?? ''}
                onChange={(e) => set('consultation_price', e.target.value)} />
            </div>
          </div>
        </div>

        <div className="card space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted">Profile</h2>
          <div>
            <label className="label">Practice areas (comma separated)</label>
            <input className="field" value={list(form.practice_areas)} onChange={(e) => set('practice_areas', parse(e.target.value))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Jurisdictions</label>
              <input className="field" value={list(form.jurisdictions)} onChange={(e) => set('jurisdictions', parse(e.target.value))} />
            </div>
            <div>
              <label className="label">Languages</label>
              <input className="field" value={list(form.languages)} onChange={(e) => set('languages', parse(e.target.value))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Years experience</label>
              <input className="field" type="number" min="0" value={form.years_experience}
                onChange={(e) => set('years_experience', Number(e.target.value))} />
            </div>
            <div>
              <label className="label">Bar number</label>
              <input className="field" value={form.bar_number} onChange={(e) => set('bar_number', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Bio</label>
            <textarea className="field" rows={3} value={form.bio} onChange={(e) => set('bio', e.target.value)} />
          </div>
        </div>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
          {saved && <span className="text-sm text-brand">✓ Saved</span>}
        </div>
      </form>
    </div>
  );
}
