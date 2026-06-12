'use client';

import { useEffect, useRef, useState } from 'react';
import {
  BadgeCheck,
  Banknote,
  Briefcase,
  Building2,
  Camera,
  Coins,
  CreditCard,
  FileText,
  Globe2,
  GraduationCap,
  Languages,
  Landmark,
  Mail,
  MapPin,
  MessageCircle,
  Pencil,
  Plus,
  Receipt,
  ScrollText,
  ShieldCheck,
  Smartphone,
  Trash2,
  User as UserIcon,
  Wallet,
  WalletCards,
  WalletMinimal,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  accountActions,
  clientProfile,
  firmAdmin,
  twoFactor,
  firms as firmsApi,
  lawyerProfile,
  lawyers as lawyersApi,
  paymentAccounts as accountsApi,
  userMe,
  ApiError,
  type ClientProfileEdit,
  type FirmCard,
  type Lawyer,
  type LawyerProfileEdit,
  type PaymentAccount,
} from '@/lib/api';
import { useApp } from '@/components/AppShell';
import { useToast } from '@/components/Toast';
import { COUNTRY_OPTIONS, flagFor } from '@/lib/flag';
import DateField from '@/components/DateField';

const ACCOUNT_TYPES: Array<{ value: PaymentAccount['account_type']; label: string; icon: LucideIcon }> = [
  { value: 'ecocash', label: 'EcoCash', icon: Smartphone },
  { value: 'onemoney', label: 'OneMoney', icon: Wallet },
  { value: 'bank', label: 'Bank', icon: Landmark },
  { value: 'innbucks', label: 'InnBucks', icon: WalletCards },
  { value: 'omari', label: "O'mari", icon: WalletMinimal },
  { value: 'cash', label: 'Cash', icon: Banknote },
];

function iconForType(t: string): LucideIcon {
  return ACCOUNT_TYPES.find((a) => a.value === t)?.icon ?? CreditCard;
}

export default function SettingsPage() {
  const toast = useToast();
  const { me, reloadMe } = useApp();
  const isLawyer = me?.role === 'lawyer';
  const isClient = !!me?.role?.startsWith('client');

  const [form, setForm] = useState<LawyerProfileEdit | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [avatarUrl, setAvatarUrl] = useState<string | null>(me?.avatar_url ?? null);
  const avatarRef = useRef<HTMLInputElement>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);

  const [allFirms, setAllFirms] = useState<FirmCard[]>([]);
  const [firmBusy, setFirmBusy] = useState(false);
  const [firmEdit, setFirmEdit] = useState<Partial<FirmCard> | null>(null);
  const [firmDetail, setFirmDetail] = useState<FirmCard | null>(null);
  const [firmMembers, setFirmMembers] = useState<Lawyer[]>([]);

  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [acctModal, setAcctModal] = useState<{ mode: 'create' | 'edit'; record?: PaymentAccount } | null>(null);

  const [tab, setTab] = useState<'profile' | 'kyc' | 'rates' | 'payments' | 'firm' | 'security'>('profile');

  useEffect(() => {
    if (!isLawyer) return;
    lawyerProfile.get().then(setForm).catch(() => setError('Could not load profile.'));
    firmsApi.list().then((r) => setAllFirms(r.results)).catch(() => {});
    accountsApi.mine().then((r) => setAccounts(r.results)).catch(() => {});
  }, [isLawyer]);

  useEffect(() => {
    if (form?.firm) {
      firmsApi.get(form.firm).then(setFirmDetail).catch(() => setFirmDetail(null));
      lawyersApi
        .list()
        .then((r) => setFirmMembers(r.results.filter((l) => (l.profile as any)?.firm === form.firm)))
        .catch(() => setFirmMembers([]));
    } else {
      setFirmDetail(null);
      setFirmMembers([]);
    }
  }, [form?.firm]);

  async function promoteToAdmin(userId: number) {
    if (!firmDetail) return;
    const ok = await toast.confirm({
      title: 'Make this lawyer the firm admin?',
      body: 'They will be able to edit firm details, rates and firm-wide payment accounts. You will keep all member privileges.',
      confirmLabel: 'Promote',
    });
    if (!ok) return;
    try {
      const updated = await firmAdmin.promote(firmDetail.id, userId);
      setFirmDetail(updated);
      toast.success('Admin role transferred.', { major: true });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not transfer admin.');
    }
  }

  async function claimAdmin() {
    if (!firmDetail || !me) return;
    try {
      const updated = await firmAdmin.promote(firmDetail.id, me.id);
      setFirmDetail(updated);
      toast.success(`You are now an admin of ${updated.name}.`, { major: true });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not claim admin role.');
    }
  }

  useEffect(() => setAvatarUrl(me?.avatar_url ?? null), [me?.avatar_url]);

  async function onAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarBusy(true);
    try {
      const updated = await userMe.uploadAvatar(file);
      setAvatarUrl(updated.avatar_url ?? null);
      await reloadMe();
      toast.success('Profile picture updated.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Upload failed.');
    } finally {
      setAvatarBusy(false);
      if (avatarRef.current) avatarRef.current.value = '';
    }
  }

  async function removeAvatar() {
    const ok = await toast.confirm({ title: 'Remove profile picture?', confirmLabel: 'Remove', tone: 'danger' });
    if (!ok) return;
    setAvatarBusy(true);
    try {
      const updated = await userMe.removeAvatar();
      setAvatarUrl(updated.avatar_url ?? null);
      await reloadMe();
      toast.success('Profile picture removed.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not remove.');
    } finally {
      setAvatarBusy(false);
    }
  }

  async function joinFirm(firmId: number) {
    setFirmBusy(true);
    try {
      const firm = await firmsApi.join(firmId);
      const updated = await lawyerProfile.get();
      setForm(updated);
      toast.success(`You're now part of ${firm.name}.`, { title: 'Firm joined', major: true });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not join firm.');
    } finally {
      setFirmBusy(false);
    }
  }

  async function leaveFirm() {
    const ok = await toast.confirm({
      title: 'Leave this firm?',
      body: 'You and the rest of the firm will lose shared oversight on matters.',
      confirmLabel: 'Leave firm',
      tone: 'danger',
    });
    if (!ok) return;
    setFirmBusy(true);
    try {
      await firmsApi.leave();
      const updated = await lawyerProfile.get();
      setForm(updated);
      toast.success('You left the firm.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not leave firm.');
    } finally {
      setFirmBusy(false);
    }
  }

  async function saveFirm() {
    if (!firmEdit || !firmDetail) return;
    try {
      const updated = await firmsApi.update(firmDetail.id, firmEdit);
      setFirmDetail(updated);
      setFirmEdit(null);
      toast.success('Firm details updated.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save firm.');
    }
  }

  async function deleteAccount(a: PaymentAccount) {
    const ok = await toast.confirm({
      title: `Remove ${a.account_type_display} account?`,
      body: 'Clients will no longer see this account when paying you.',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await accountsApi.remove(a.id);
      setAccounts((cur) => cur.filter((x) => x.id !== a.id));
      toast.success('Payment account removed.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not remove.');
    }
  }

  if (isClient) {
    return <ClientSettings reloadMe={reloadMe} />;
  }
  if (!isLawyer) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <p className="text-sm text-muted">Settings are available for lawyer and client accounts.</p>
      </div>
    );
  }
  if (!form) return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="h-8 w-40 animate-pulse rounded bg-line/70" />
      <div className="mt-3 h-3 w-64 animate-pulse rounded bg-line/70" />
      <div className="mt-6 flex gap-2 border-b border-line">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="my-2 h-6 w-20 animate-pulse rounded bg-line/70" />
        ))}
      </div>
      <div className="mt-6 space-y-3">
        <div className="h-32 animate-pulse rounded-xl bg-line/70" />
        <div className="h-48 animate-pulse rounded-xl bg-line/70" />
      </div>
    </div>
  );

  function set<K extends keyof LawyerProfileEdit>(k: K, v: LawyerProfileEdit[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setSavedAt(null);
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setError('');
    try {
      const updated = await lawyerProfile.update({
        hourly_rate: form.hourly_rate,
        consultation_price: form.consultation_price,
        country: form.country,
        practice_areas: form.practice_areas,
        jurisdictions: form.jurisdictions,
        languages: form.languages,
        years_experience: form.years_experience,
        bio: form.bio,
        bar_number: form.bar_number,
        practising_certificate_number: form.practising_certificate_number,
        practising_certificate_expires: form.practising_certificate_expires || null,
      });
      setForm(updated);
      setSavedAt(Date.now());
      toast.success('Profile saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
      toast.error(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  const list = (arr: string[]) => arr.join(', ');
  const parse = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const isFirmAdmin = !!firmDetail && me && firmDetail.admin === me.id;

  const tabs = [
    { key: 'profile', label: 'Profile', icon: UserIcon },
    { key: 'kyc', label: 'KYC', icon: ScrollText },
    { key: 'rates', label: 'Rates', icon: Coins },
    { key: 'payments', label: 'Payments', icon: Wallet },
    { key: 'firm', label: 'Firm', icon: Building2 },
    { key: 'security', label: 'Security', icon: ShieldCheck },
  ] as const;

  function formSaveBar() {
    return (
      <div className="mt-5 flex items-center justify-end gap-3 border-t border-line pt-4">
        {savedAt && <span className="text-xs font-semibold text-emerald-600">✓ Saved</span>}
        {error && <span className="text-xs font-semibold text-red-600">{error}</span>}
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-light/15 text-brand-dark">
          <UserIcon size={18} />
        </span>
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-sm text-muted">Profile, KYC, rates, payments and firm.</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="mt-6 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
                active ? 'border-brand-dark text-brand-dark' : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              <t.icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* PROFILE TAB */}
      {tab === 'profile' && (
      <form onSubmit={saveProfile} className="mt-6 space-y-5">
        <div className="card space-y-4">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
            <UserIcon size={14} /> Profile
          </h2>
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-full border border-line bg-canvas text-2xl font-bold text-brand-dark">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span>{(me?.first_name?.[0] ?? '?') + (me?.last_name?.[0] ?? '')}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => avatarRef.current?.click()}
                disabled={avatarBusy}
                aria-label="Change profile picture"
                className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full border border-line bg-white text-brand-dark shadow-card hover:border-brand hover:text-brand"
              >
                <Camera size={14} />
              </button>
              <input ref={avatarRef} type="file" accept="image/*" className="hidden" onChange={onAvatarPick} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink">{me?.first_name} {me?.last_name}</p>
              <p className="truncate text-xs text-muted">{me?.email}</p>
              {avatarUrl && (
                <button
                  type="button"
                  onClick={removeAvatar}
                  disabled={avatarBusy}
                  className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-muted hover:text-red-600"
                >
                  <Trash2 size={11} /> Remove picture
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="label">Practice areas (comma separated)</label>
            <input className="field" value={list(form.practice_areas)} onChange={(e) => set('practice_areas', parse(e.target.value))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Country (for flag badge)</label>
              <select
                className="field"
                value={form.country ?? ''}
                onChange={(e) => set('country', e.target.value)}
              >
                <option value="">— Select —</option>
                {COUNTRY_OPTIONS.map((c) => (
                  <option key={c.code} value={c.code}>
                    {flagFor(c.code)} {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Languages</label>
              <input className="field" value={list(form.languages)} onChange={(e) => set('languages', parse(e.target.value))} />
            </div>
          </div>
          <div>
            <label className="label">Jurisdictions (countries you practise in)</label>
            <input className="field" value={list(form.jurisdictions)} onChange={(e) => set('jurisdictions', parse(e.target.value))} />
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
          {formSaveBar()}
        </div>
      </form>
      )}

      {/* KYC TAB */}
      {tab === 'kyc' && (
      <form onSubmit={saveProfile} className="mt-6 space-y-5">
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
              <ScrollText size={14} /> Practising certificate
            </h2>
            {form.practising_certificate_number && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-light/15 px-2.5 py-0.5 text-[11px] font-semibold text-brand-dark">
                <BadgeCheck size={12} /> On file
              </span>
            )}
          </div>
          <p className="text-xs text-muted">
            Required for KYC. Your certificate is checked against the bar registry — make sure both fields are accurate.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Certificate number</label>
              <input
                className="field"
                value={form.practising_certificate_number}
                onChange={(e) => set('practising_certificate_number', e.target.value)}
                placeholder="e.g. PC-2026-0184"
              />
            </div>
            <div>
              <label className="label">Expires on</label>
              <DateField
                mode="date"
                value={form.practising_certificate_expires ?? ''}
                onChange={(v) => set('practising_certificate_expires', v || null)}
              />
            </div>
          </div>
          <div>
            <label className="label">Certificate file</label>
            <CertificateFileUpload
              currentUrl={form.practising_certificate_file_url}
              onUploaded={(updated) => setForm(updated)}
              toast={toast}
            />
          </div>
          {formSaveBar()}
        </div>
      </form>
      )}

      {/* RATES TAB */}
      {tab === 'rates' && (
      <form onSubmit={saveProfile} className="mt-6 space-y-5">
        <div className="card space-y-4">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
            <Coins size={14} /> Your rates
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <RateField icon={Receipt} label="Hourly rate (USD)" hint="Bookings are priced as rate × minutes.">
              <input className="field" type="number" min="0" step="1" value={form.hourly_rate ?? ''}
                onChange={(e) => set('hourly_rate', e.target.value)} />
            </RateField>
            <RateField icon={Briefcase} label="Consultation base (USD)" hint="Charged per consultation booking.">
              <input className="field" type="number" min="0" step="1" value={form.consultation_price ?? ''}
                onChange={(e) => set('consultation_price', e.target.value)} />
            </RateField>
          </div>
          {firmDetail && (firmDetail.default_hourly_rate || firmDetail.default_consultation_price) && (
            <div className="rounded-lg border border-brand-light/30 bg-brand-light/5 p-3 text-xs">
              <p className="flex items-center gap-1.5 font-semibold text-brand-dark">
                <Building2 size={12} /> Firm defaults
              </p>
              <p className="mt-1 text-muted">
                {firmDetail.name} suggests {firmDetail.default_hourly_rate ? `$${firmDetail.default_hourly_rate}/hr` : '—'}{' '}
                · {firmDetail.default_consultation_price ? `$${firmDetail.default_consultation_price} per consult` : '—'}.
              </p>
            </div>
          )}
          {formSaveBar()}
        </div>
      </form>
      )}

      {/* PAYMENT ACCOUNTS TAB */}
      {tab === 'payments' && (
      <div className="mt-6 card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
            <Wallet size={14} /> Payment accounts
          </h2>
          <button
            onClick={() => setAcctModal({ mode: 'create' })}
            className="inline-flex items-center gap-1 rounded-lg bg-brand-dark px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand"
          >
            <Plus size={12} /> Add account
          </button>
        </div>
        <p className="text-xs text-muted">
          Clients see these accounts when they pay you. Add an entry for every method you accept.
        </p>
        {accounts.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line bg-canvas/40 px-4 py-6 text-center text-xs text-muted">
            No payment accounts yet. Add one so clients know where to send funds.
          </p>
        ) : (
          <div className="space-y-2">
            {accounts.map((a) => {
              const Icon = iconForType(a.account_type);
              return (
                <div
                  key={a.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-line bg-white p-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-light/15 text-brand-dark">
                      <Icon size={16} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">
                        {a.account_type_display}
                        {a.account_name && <span className="ml-1 text-muted">· {a.account_name}</span>}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {a.identifier}
                        {a.bank_name && ` · ${a.bank_name}`}
                        {a.branch && ` · ${a.branch}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setAcctModal({ mode: 'edit', record: a })}
                      className="rounded-md p-1.5 text-muted hover:bg-canvas hover:text-ink"
                      aria-label="Edit"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => deleteAccount(a)}
                      className="rounded-md p-1.5 text-muted hover:bg-red-50 hover:text-red-600"
                      aria-label="Remove"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}

      {/* FIRM TAB */}
      {tab === 'firm' && (
      <div className="mt-6 card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
            <Building2 size={14} /> Law firm
          </h2>
          {firmDetail && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-light/15 px-2.5 py-0.5 text-[11px] font-semibold text-brand-dark">
              <BadgeCheck size={12} /> {isFirmAdmin ? 'Admin' : 'Member'}
            </span>
          )}
        </div>

        {firmDetail ? (
          <div>
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-brand-dark text-white">
                <Building2 size={18} />
              </span>
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink">{firmDetail.name}</p>
                {firmDetail.website && (
                  <a href={firmDetail.website} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">
                    {firmDetail.website}
                  </a>
                )}
              </div>
            </div>
            <p className="mt-3 text-xs text-muted">
              You and other firm lawyers can see all matters assigned to any member of{' '}
              <span className="font-semibold text-ink">{firmDetail.name}</span>.
            </p>

            {isFirmAdmin && (
              <div className="mt-4 rounded-lg border border-line bg-canvas/40 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Manage firm</p>
                  {!firmEdit && (
                    <button
                      onClick={() =>
                        setFirmEdit({
                          name: firmDetail.name,
                          website: firmDetail.website,
                          description: firmDetail.description ?? '',
                          default_hourly_rate: firmDetail.default_hourly_rate ?? null,
                          default_consultation_price: firmDetail.default_consultation_price ?? null,
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-[11px] font-semibold text-brand-dark hover:border-brand"
                    >
                      <Pencil size={11} /> Edit
                    </button>
                  )}
                </div>
                {firmEdit ? (
                  <div className="mt-3 space-y-3">
                    <div>
                      <label className="label">Firm name</label>
                      <input className="field" value={firmEdit.name ?? ''} onChange={(e) => setFirmEdit({ ...firmEdit, name: e.target.value })} />
                    </div>
                    <div>
                      <label className="label">Website</label>
                      <input className="field" value={firmEdit.website ?? ''} onChange={(e) => setFirmEdit({ ...firmEdit, website: e.target.value })} />
                    </div>
                    <div>
                      <label className="label">Description</label>
                      <textarea className="field" rows={3} value={firmEdit.description ?? ''} onChange={(e) => setFirmEdit({ ...firmEdit, description: e.target.value })} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label">Default hourly rate</label>
                        <input className="field" type="number" min="0" step="1" value={firmEdit.default_hourly_rate ?? ''} onChange={(e) => setFirmEdit({ ...firmEdit, default_hourly_rate: e.target.value || null })} />
                      </div>
                      <div>
                        <label className="label">Default consultation</label>
                        <input className="field" type="number" min="0" step="1" value={firmEdit.default_consultation_price ?? ''} onChange={(e) => setFirmEdit({ ...firmEdit, default_consultation_price: e.target.value || null })} />
                      </div>
                    </div>
                    <div>
                      <label className="label">Country (for flag badge)</label>
                      <select
                        className="field"
                        value={firmEdit.country ?? ''}
                        onChange={(e) => setFirmEdit({ ...firmEdit, country: e.target.value })}
                      >
                        <option value="">— Select —</option>
                        {COUNTRY_OPTIONS.map((c) => (
                          <option key={c.code} value={c.code}>
                            {flagFor(c.code)} {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => setFirmEdit(null)} className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:border-brand">
                        Cancel
                      </button>
                      <button onClick={saveFirm} className="rounded-lg bg-brand-dark px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand">
                        Save firm
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted">
                    <div>
                      <p className="text-[10px] uppercase">Hourly</p>
                      <p className="text-ink">{firmDetail.default_hourly_rate ? `$${firmDetail.default_hourly_rate}` : '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase">Consultation</p>
                      <p className="text-ink">{firmDetail.default_consultation_price ? `$${firmDetail.default_consultation_price}` : '—'}</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Members + admin promotion */}
            <div className="mt-4 rounded-lg border border-line bg-canvas/40 p-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Members</p>
                {firmDetail.admin == null && (
                  <button
                    onClick={claimAdmin}
                    className="rounded-md bg-brand-dark px-2 py-1 text-[11px] font-semibold text-white hover:bg-brand"
                  >
                    Claim admin
                  </button>
                )}
              </div>
              {firmMembers.length === 0 ? (
                <p className="mt-2 text-xs text-muted">Just you so far.</p>
              ) : (
                <ul className="mt-2 divide-y divide-line/60">
                  {firmMembers.map((m) => {
                    const isAdminMember = firmDetail.admin === m.id;
                    return (
                      <li key={m.id} className="flex items-center justify-between gap-2 py-2 text-xs">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-ink">{m.full_name}</p>
                          <p className="truncate text-[10px] text-muted">{m.email}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {isAdminMember && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-brand-light/15 px-2 py-0.5 text-[10px] font-semibold text-brand-dark">
                              <BadgeCheck size={10} /> Admin
                            </span>
                          )}
                          {isFirmAdmin && !isAdminMember && (
                            <button
                              onClick={() => promoteToAdmin(m.id)}
                              className="rounded-md border border-line bg-white px-2 py-1 text-[10px] font-semibold text-brand-dark hover:border-brand hover:text-brand"
                            >
                              Make admin
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <button
              type="button"
              onClick={leaveFirm}
              disabled={firmBusy}
              className="mt-3 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:border-red-400 hover:text-red-600 disabled:opacity-50"
            >
              {firmBusy ? 'Working…' : 'Leave firm'}
            </button>
          </div>
        ) : (
          <>
            <p className="text-xs text-muted">
              Joining a firm gives every member shared oversight of all matters assigned to any lawyer in the firm.
              You can be in one firm at a time.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {allFirms.length === 0 && <p className="text-sm text-muted">No firms available yet.</p>}
              {allFirms.map((f) => (
                <div key={f.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-white px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{f.name}</p>
                    <p className="text-[11px] text-muted">{f.lawyer_count} lawyer{f.lawyer_count === 1 ? '' : 's'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => joinFirm(f.id)}
                    disabled={firmBusy}
                    className="rounded-md bg-brand-dark px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-brand disabled:opacity-50"
                  >
                    Join
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      )}

      {/* SECURITY TAB */}
      {tab === 'security' && (
        <div className="mt-6">
          <SecurityCard me={me} reloadMe={reloadMe} />
        </div>
      )}

      {acctModal && (
        <PaymentAccountModal
          mode={acctModal.mode}
          record={acctModal.record}
          onClose={() => setAcctModal(null)}
          onSaved={(saved) => {
            setAccounts((cur) => {
              const idx = cur.findIndex((x) => x.id === saved.id);
              if (idx === -1) return [...cur, saved];
              const next = [...cur];
              next[idx] = saved;
              return next;
            });
            setAcctModal(null);
          }}
        />
      )}

      <DangerZone />
    </div>
  );
}

function PaymentAccountModal({
  mode,
  record,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  record?: PaymentAccount;
  onClose: () => void;
  onSaved: (a: PaymentAccount) => void;
}) {
  const toast = useToast();
  const [accountType, setAccountType] = useState<PaymentAccount['account_type']>(
    record?.account_type ?? 'ecocash'
  );
  const [identifier, setIdentifier] = useState(record?.identifier ?? '');
  const [accountName, setAccountName] = useState(record?.account_name ?? '');
  const [bankName, setBankName] = useState(record?.bank_name ?? '');
  const [branch, setBranch] = useState(record?.branch ?? '');
  const [swiftCode, setSwiftCode] = useState(record?.swift_code ?? '');
  const [notes, setNotes] = useState(record?.notes ?? '');
  const [busy, setBusy] = useState(false);

  const isBank = accountType === 'bank';
  const identifierLabel =
    accountType === 'bank'
      ? 'Account number'
      : accountType === 'cash'
      ? 'Hand-off location'
      : 'Phone number';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        account_type: accountType,
        identifier: identifier.trim(),
        account_name: accountName.trim(),
        bank_name: isBank ? bankName.trim() : '',
        branch: isBank ? branch.trim() : '',
        swift_code: isBank ? swiftCode.trim() : '',
        notes: notes.trim(),
      };
      const saved = mode === 'create' ? await accountsApi.create(payload) : await accountsApi.update(record!.id, payload);
      toast.success(mode === 'create' ? 'Payment account added.' : 'Payment account updated.');
      onSaved(saved);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save account.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-brand-darker/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-line">
        <div className="flex items-center justify-between bg-brand px-5 py-4 text-white">
          <h3 className="text-base font-bold">{mode === 'create' ? 'Add payment account' : 'Edit payment account'}</h3>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-white/80 hover:bg-white/15 hover:text-white">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-4 p-5">
          <div>
            <label className="label">Method</label>
            <div className="grid grid-cols-3 gap-2">
              {ACCOUNT_TYPES.map((a) => {
                const active = accountType === a.value;
                return (
                  <button
                    key={a.value}
                    type="button"
                    onClick={() => setAccountType(a.value)}
                    className={`flex flex-col items-start gap-1 rounded-lg border p-2 text-left transition ${
                      active ? 'border-brand bg-brand/5 ring-1 ring-brand' : 'border-line bg-white hover:border-brand/40'
                    }`}
                  >
                    <span className={`grid h-7 w-7 place-items-center rounded-lg ${active ? 'bg-brand text-white' : 'bg-canvas text-muted'}`}>
                      <a.icon size={14} />
                    </span>
                    <span className={`text-[11px] font-semibold ${active ? 'text-brand-dark' : 'text-ink'}`}>{a.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="label">{identifierLabel}</label>
            <input className="field" required value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder={isBank ? '0000-0000-0000' : '+263 7…'} />
          </div>
          <div>
            <label className="label">Account holder</label>
            <input className="field" value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Name on the account" />
          </div>
          {isBank && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Bank</label>
                <input className="field" value={bankName} onChange={(e) => setBankName(e.target.value)} />
              </div>
              <div>
                <label className="label">Branch</label>
                <input className="field" value={branch} onChange={(e) => setBranch(e.target.value)} />
              </div>
              <div className="col-span-2">
                <label className="label">SWIFT / BIC</label>
                <input className="field" value={swiftCode} onChange={(e) => setSwiftCode(e.target.value)} />
              </div>
            </div>
          )}
          <div>
            <label className="label">Notes (optional)</label>
            <input className="field" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the payer should know" />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:border-brand">
              Cancel
            </button>
            <button disabled={busy} className="rounded-lg bg-brand-dark px-4 py-2 text-sm font-semibold text-white hover:bg-brand disabled:opacity-50">
              {busy ? 'Saving…' : mode === 'create' ? 'Add account' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


function CertificateFileUpload({
  currentUrl,
  onUploaded,
  toast,
}: {
  currentUrl: string | null;
  onUploaded: (p: LawyerProfileEdit) => void;
  toast: ReturnType<typeof useToast>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const updated = await lawyerProfile.uploadCertificate(file);
      onUploaded(updated);
      toast.success('Certificate uploaded.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }
  return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed border-line bg-white px-3 py-3 text-sm">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="rounded-md bg-brand-dark px-3 py-1 text-xs font-semibold text-white hover:bg-brand disabled:opacity-50"
      >
        {busy ? 'Uploading…' : currentUrl ? 'Replace file' : 'Upload PDF / image'}
      </button>
      {currentUrl ? (
        <a href={currentUrl} target="_blank" rel="noreferrer" className="truncate text-xs text-brand hover:underline">
          View current certificate
        </a>
      ) : (
        <span className="text-xs text-muted">No file uploaded yet.</span>
      )}
      <input ref={fileRef} type="file" accept=".pdf,image/*" className="hidden" onChange={onPick} />
    </div>
  );
}

function ClientSettings({ reloadMe }: { reloadMe: () => Promise<void> }) {
  const toast = useToast();
  const { me } = useApp();
  const [profile, setProfile] = useState<ClientProfileEdit | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(me?.avatar_url ?? null);
  const [busy, setBusy] = useState(false);
  const avatarRef = useRef<HTMLInputElement>(null);
  const idFileRef = useRef<HTMLInputElement>(null);
  const [businessName, setBusinessName] = useState('');
  const [isBusiness, setIsBusiness] = useState(false);
  const [idType, setIdType] = useState('national_id');
  const [idNumber, setIdNumber] = useState('');

  useEffect(() => {
    clientProfile.get().then((p) => {
      setProfile(p);
      setBusinessName(p.business_name);
      setIsBusiness(p.is_business);
      setIdType(p.id_document_type || 'national_id');
      setIdNumber(p.id_document_number);
    });
  }, []);
  useEffect(() => setAvatarUrl(me?.avatar_url ?? null), [me?.avatar_url]);

  async function saveProfile() {
    setBusy(true);
    const form = new FormData();
    form.append('business_name', businessName);
    form.append('is_business', isBusiness ? 'true' : 'false');
    form.append('id_document_type', idType);
    form.append('id_document_number', idNumber);
    const file = idFileRef.current?.files?.[0];
    if (file) form.append('id_document_file', file);
    try {
      const p = await clientProfile.update(form);
      setProfile(p);
      if (idFileRef.current) idFileRef.current.value = '';
      toast.success(file ? 'KYC submitted — awaiting review.' : 'Profile saved.', { major: !!file });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  async function onAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const updated = await userMe.uploadAvatar(file);
      setAvatarUrl(updated.avatar_url ?? null);
      await reloadMe();
      toast.success('Profile picture updated.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Upload failed.');
    }
  }

  if (!profile) return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <div className="h-8 w-32 animate-pulse rounded bg-line/70" />
      <div className="mt-2 h-3 w-48 animate-pulse rounded bg-line/70" />
      <div className="mt-6 h-40 animate-pulse rounded-xl bg-line/70" />
      <div className="mt-3 h-48 animate-pulse rounded-xl bg-line/70" />
    </div>
  );

  const kycTone =
    profile.kyc_status === 'verified'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : profile.kyc_status === 'pending'
      ? 'bg-amber-50 text-amber-800 ring-amber-200'
      : profile.kyc_status === 'rejected'
      ? 'bg-red-50 text-red-700 ring-red-200'
      : 'bg-line/60 text-muted ring-line';

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="text-sm text-muted">Profile and KYC.</p>

      <div className="mt-6 card space-y-4">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
          <UserIcon size={14} /> Profile
        </h2>
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-full border border-line bg-canvas text-2xl font-bold text-brand-dark">
              {avatarUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span>{(me?.first_name?.[0] ?? '?') + (me?.last_name?.[0] ?? '')}</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => avatarRef.current?.click()}
              aria-label="Change profile picture"
              className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full border border-line bg-white text-brand-dark shadow-card hover:border-brand hover:text-brand"
            >
              <Camera size={14} />
            </button>
            <input ref={avatarRef} type="file" accept="image/*" className="hidden" onChange={onAvatarPick} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink">{me?.first_name} {me?.last_name}</p>
            <p className="truncate text-xs text-muted">{me?.email}</p>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isBusiness}
            onChange={(e) => setIsBusiness(e.target.checked)}
            className="h-4 w-4 accent-[#0f766e]"
          />
          I&apos;m booking as a business
        </label>
        {isBusiness && (
          <div>
            <label className="label">Business name</label>
            <input className="field" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
          </div>
        )}
      </div>

      <div className="mt-8 card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
            <ScrollText size={14} /> KYC verification
          </h2>
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset ${kycTone}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
            {profile.kyc_status_display}
          </span>
        </div>
        <p className="text-xs text-muted">
          Upload a clear photo of a government-issued ID. Lawyers need this to open trust accounts on your behalf.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Document type</label>
            <select className="field" value={idType} onChange={(e) => setIdType(e.target.value)}>
              <option value="national_id">National ID</option>
              <option value="passport">Passport</option>
              <option value="drivers_licence">Driver&apos;s licence</option>
            </select>
          </div>
          <div>
            <label className="label">Document number</label>
            <input className="field" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Upload document</label>
          <div className="flex items-center gap-3 rounded-lg border border-dashed border-line bg-white px-3 py-3 text-sm">
            <button
              type="button"
              onClick={() => idFileRef.current?.click()}
              className="rounded-md bg-brand-dark px-3 py-1 text-xs font-semibold text-white hover:bg-brand"
            >
              {profile.id_document_file_url ? 'Replace file' : 'Choose file'}
            </button>
            {profile.id_document_file_url ? (
              <a href={profile.id_document_file_url} target="_blank" rel="noreferrer" className="truncate text-xs text-brand hover:underline">
                View uploaded ID
              </a>
            ) : (
              <span className="text-xs text-muted">PDF or image, no larger than 5MB.</span>
            )}
            <input ref={idFileRef} type="file" accept=".pdf,image/*" className="hidden" />
          </div>
        </div>
        <div className="flex items-center justify-end">
          <button
            onClick={saveProfile}
            disabled={busy}
            className="rounded-lg bg-brand-dark px-4 py-2 text-sm font-semibold text-white hover:bg-brand disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="mt-8">
        <SecurityCard me={me ?? null} reloadMe={reloadMe} />
      </div>

      <DangerZone />
    </div>
  );
}

function DangerZone() {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<'export' | 'delete' | null>(null);

  async function exportData() {
    setBusy('export');
    try {
      const data = await accountActions.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attorney-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Data export downloaded.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not export.');
    } finally {
      setBusy(null);
    }
  }

  async function deleteAccount() {
    const ok = await toast.confirm({
      title: 'Delete your account?',
      body: 'This is irreversible. Your personal details will be anonymised and your sign-in will be disabled. Matter and ledger records are retained for compliance.',
      confirmLabel: 'Delete account',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy('delete');
    try {
      await accountActions.deleteAccount();
      try { window.localStorage.removeItem('attorney.access'); window.localStorage.removeItem('attorney.refresh'); } catch {}
      toast.success('Account deleted.', { major: true });
      router.replace('/');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not delete.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-8 rounded-2xl border border-red-200 bg-red-50/40 p-5">
      <h2 className="text-sm font-bold uppercase tracking-wide text-red-700">Danger zone</h2>
      <p className="mt-1 text-xs text-muted">Export everything we hold about you, or delete your account.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={exportData}
          disabled={busy !== null}
          className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:border-brand hover:text-brand disabled:opacity-50"
        >
          {busy === 'export' ? 'Exporting…' : 'Export my data'}
        </button>
        <button
          type="button"
          onClick={deleteAccount}
          disabled={busy !== null}
          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
        >
          {busy === 'delete' ? 'Deleting…' : 'Delete my account'}
        </button>
      </div>
    </div>
  );
}

function RateField({
  icon: Icon,
  label,
  hint,
  children,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <Icon size={13} className="text-muted" />
        <label className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</label>
      </div>
      {children}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function SecurityCard({ me, reloadMe }: { me: { two_factor_method?: string; whatsapp_number?: string; phone_number?: string } | null; reloadMe: () => Promise<void> }) {
  const toast = useToast();
  const current = me?.two_factor_method ?? 'off';
  const [stage, setStage] = useState<'idle' | 'enrolling' | 'disabling'>('idle');
  const [method, setMethod] = useState<'email' | 'whatsapp'>('email');
  const [number, setNumber] = useState(me?.whatsapp_number || me?.phone_number || '');
  const [challengeToken, setChallengeToken] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function startEnroll() {
    setBusy(true);
    try {
      const r = await twoFactor.setup(method, method === 'whatsapp' ? number.trim() : undefined);
      setChallengeToken(r.challenge_token);
      setStage('enrolling');
      toast.info(`Code sent via ${method === 'email' ? 'email' : 'WhatsApp'}. Check and enter it below.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not start setup.');
    } finally {
      setBusy(false);
    }
  }

  async function finishEnroll() {
    if (code.length !== 6) return;
    setBusy(true);
    try {
      await twoFactor.confirmSetup(challengeToken, code);
      await reloadMe();
      toast.success('Two-factor authentication is on.', { major: true });
      setStage('idle');
      setCode('');
      setChallengeToken('');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not enable 2FA.');
    } finally {
      setBusy(false);
    }
  }

  async function startDisable() {
    setBusy(true);
    try {
      // Re-use setup endpoint to fire a code via the existing method.
      const r = await twoFactor.setup(current as 'email' | 'whatsapp');
      setChallengeToken(r.challenge_token);
      setStage('disabling');
      toast.info('Code sent — enter it below to disable 2FA.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not send code.');
    } finally {
      setBusy(false);
    }
  }

  async function finishDisable() {
    if (code.length !== 6) return;
    setBusy(true);
    try {
      await twoFactor.disable(challengeToken, code);
      await reloadMe();
      toast.success('Two-factor authentication disabled.');
      setStage('idle');
      setCode('');
      setChallengeToken('');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not disable 2FA.');
    } finally {
      setBusy(false);
    }
  }

  const enabled = current !== 'off';

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
          <ShieldCheck size={14} /> Two-factor authentication
        </h2>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset ${
            enabled
              ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
              : 'bg-line/60 text-muted ring-line'
          }`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
          {enabled ? `On · ${current}` : 'Off'}
        </span>
      </div>
      <p className="text-xs text-muted">
        Add a second layer to your sign-in. We&apos;ll send a 6-digit code to your email or WhatsApp every time
        you log in.
      </p>

      {stage === 'idle' && !enabled && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMethod('email')}
              className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition ${
                method === 'email' ? 'border-brand bg-brand/5 ring-1 ring-brand' : 'border-line bg-white hover:border-brand/40'
              }`}
            >
              <span className={`grid h-8 w-8 place-items-center rounded-lg ${method === 'email' ? 'bg-brand text-white' : 'bg-canvas text-muted'}`}>
                <Mail size={16} />
              </span>
              <span className="text-sm font-semibold text-ink">Email</span>
              <span className="text-[11px] text-muted">Send codes to {me?.['phone_number' as never] || 'your email'}</span>
            </button>
            <button
              type="button"
              onClick={() => setMethod('whatsapp')}
              className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition ${
                method === 'whatsapp' ? 'border-brand bg-brand/5 ring-1 ring-brand' : 'border-line bg-white hover:border-brand/40'
              }`}
            >
              <span className={`grid h-8 w-8 place-items-center rounded-lg ${method === 'whatsapp' ? 'bg-brand text-white' : 'bg-canvas text-muted'}`}>
                <MessageCircle size={16} />
              </span>
              <span className="text-sm font-semibold text-ink">WhatsApp</span>
              <span className="text-[11px] text-muted">Faster on mobile</span>
            </button>
          </div>
          {method === 'whatsapp' && (
            <div>
              <label className="label">WhatsApp number</label>
              <input
                className="field"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="+263 77…"
                required
              />
            </div>
          )}
          <div className="flex justify-end">
            <button
              onClick={startEnroll}
              disabled={busy || (method === 'whatsapp' && !number.trim())}
              className="rounded-lg bg-brand-dark px-4 py-2 text-sm font-semibold text-white hover:bg-brand disabled:opacity-50"
            >
              {busy ? 'Sending code…' : 'Enable 2FA'}
            </button>
          </div>
        </>
      )}

      {stage === 'enrolling' && (
        <div className="rounded-xl border border-brand-light/40 bg-brand-light/5 p-3">
          <p className="text-xs text-brand-dark">Enter the 6-digit code we just sent via {method}.</p>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
            inputMode="numeric"
            maxLength={6}
            className="field mt-2 text-center font-mono text-xl tracking-[0.4em]"
            placeholder="••••••"
            autoFocus
          />
          <div className="mt-3 flex items-center justify-end gap-2">
            <button onClick={() => { setStage('idle'); setCode(''); }} className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:border-brand">
              Cancel
            </button>
            <button
              onClick={finishEnroll}
              disabled={busy || code.length !== 6}
              className="rounded-lg bg-brand-dark px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand disabled:opacity-50"
            >
              {busy ? 'Verifying…' : 'Confirm'}
            </button>
          </div>
        </div>
      )}

      {stage === 'idle' && enabled && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted">
            Currently sending codes via <span className="font-semibold text-ink">{current}</span>.
          </p>
          <button
            onClick={startDisable}
            disabled={busy}
            className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:border-red-400 hover:text-red-600 disabled:opacity-50"
          >
            Disable 2FA
          </button>
        </div>
      )}

      {stage === 'disabling' && (
        <div className="rounded-xl border border-red-200 bg-red-50/60 p-3">
          <p className="text-xs text-red-800">Enter the 6-digit code we sent to confirm.</p>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
            inputMode="numeric"
            maxLength={6}
            className="field mt-2 text-center font-mono text-xl tracking-[0.4em]"
            placeholder="••••••"
            autoFocus
          />
          <div className="mt-3 flex items-center justify-end gap-2">
            <button onClick={() => { setStage('idle'); setCode(''); }} className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:border-brand">
              Cancel
            </button>
            <button
              onClick={finishDisable}
              disabled={busy || code.length !== 6}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
            >
              {busy ? 'Disabling…' : 'Disable'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
