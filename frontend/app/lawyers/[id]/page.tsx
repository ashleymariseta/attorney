'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Briefcase,
  CalendarPlus,
  Globe2,
  GraduationCap,
  Languages,
  Mail,
  MapPin,
  ShieldCheck,
  Sparkles,
  Star,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  ApiError,
  auth,
  clearTokens,
  isAuthed,
  lawyers as lawyersApi,
  retainers as retainersApi,
  type Lawyer,
  type Review,
} from '@/lib/api';
import { useToast } from '@/components/Toast';
import { countryName, flagFor } from '@/lib/flag';
import PublicHeader from '@/components/PublicHeader';
import PublicFooter from '@/components/PublicFooter';
import AppShell from '@/components/AppShell';
import { StarRating } from '@/components/Stars';
import { SkeletonCard } from '@/components/Skeleton';
import BookModal from '@/components/BookModal';

function photo(id: number) {
  return `/img/law-${(id % 7) + 1}.jpg`;
}

export default function PublicLawyerProfile({ params }: { params: { id: string } }) {
  const lawyerId = Number(params.id);
  const router = useRouter();
  const [lawyer, setLawyer] = useState<Lawyer | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [open, setOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'pending' | 'authed' | 'public'>('pending');
  const [meRole, setMeRole] = useState<string | null>(null);
  const [addingTeam, setAddingTeam] = useState(false);
  const [confirmRetainer, setConfirmRetainer] = useState(false);
  const toast = useToast();

  useEffect(() => {
    (async () => {
      if (!isAuthed()) {
        setAuthMode('public');
        return;
      }
      try {
        const me = await auth.me();
        setMeRole(me.role);
        setAuthMode('authed');
      } catch {
        clearTokens();
        setAuthMode('public');
      }
    })();
  }, []);

  const isClient = meRole?.startsWith('client') ?? false;

  async function addToTeam() {
    if (!lawyer || !isClient) return;
    setAddingTeam(true);
    try {
      await retainersApi.add(lawyer.id);
      setLawyer({ ...lawyer, on_retainer: true });
      setConfirmRetainer(false);
      toast.success(`${lawyer.full_name} added to your legal team.`, { major: true });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not add to team.');
    } finally {
      setAddingTeam(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const l = await lawyersApi.get(lawyerId);
        setLawyer(l);
        try {
          const rs = await lawyersApi.reviews(lawyerId);
          setReviews(rs);
        } catch {}
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [lawyerId]);

  function book() {
    if (isAuthed()) {
      setOpen(true);
    } else {
      router.push(`/login?next=${encodeURIComponent(`/book/${lawyerId}`)}`);
    }
  }

  function Shell({ children }: { children: React.ReactNode }) {
    if (authMode === 'authed') {
      return <AppShell>{children}</AppShell>;
    }
    return (
      <div className="min-h-screen bg-white text-ink">
        <PublicHeader />
        {children}
        <PublicFooter />
      </div>
    );
  }

  if (authMode === 'pending') {
    return <div className="min-h-screen bg-white" />;
  }

  if (loading) {
    return (
      <Shell>
        <div className="mx-auto max-w-4xl px-6 py-12">
          <SkeletonCard className="h-32" />
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <SkeletonCard className="sm:col-span-2 h-64" />
            <SkeletonCard className="h-64" />
          </div>
        </div>
      </Shell>
    );
  }

  if (notFound || !lawyer) {
    return (
      <Shell>
        <div className="mx-auto max-w-xl px-6 py-20 text-center">
          <h1 className="text-2xl font-bold">Lawyer not found</h1>
          <p className="mt-2 text-sm text-muted">This profile may have been removed or is no longer accepting new matters.</p>
          <Link href="/lawyers" className="mt-6 inline-flex items-center gap-1.5 rounded-lg bg-brand-dark px-4 py-2 text-sm font-semibold text-white hover:bg-brand">
            <ArrowLeft size={14} /> Back to directory
          </Link>
        </div>
      </Shell>
    );
  }

  const profile = lawyer.profile;
  const ratingLabel = lawyer.avg_rating
    ? `${lawyer.avg_rating} · ${lawyer.review_count} review${lawyer.review_count === 1 ? '' : 's'}`
    : 'No reviews yet';

  return (
    <Shell>
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <Link
          href="/lawyers"
          className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.18em] text-brand-dark hover:underline"
        >
          <ArrowLeft size={12} /> All lawyers
        </Link>

        {/* Header card */}
        <div className="relative mt-4 overflow-hidden rounded-3xl border border-line bg-gradient-to-br from-brand-light/15 via-white to-white shadow-sm">
          {lawyer.country && (
            <span
              className="absolute right-4 top-4 z-10 inline-flex items-center gap-1.5 rounded-full border border-line bg-white/95 px-3 py-1.5 text-sm font-semibold text-ink shadow-sm"
              title={countryName(lawyer.country)}
            >
              <span className="text-lg leading-none">{flagFor(lawyer.country)}</span>
              {countryName(lawyer.country)}
            </span>
          )}
          <div className="grid gap-6 p-6 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-8 sm:p-8">
            <Image
              src={lawyer.avatar_url || photo(lawyer.id)}
              alt={`Headshot of ${lawyer.full_name}`}
              width={120}
              height={120}
              className="h-28 w-28 rounded-2xl object-cover shadow-md ring-4 ring-white sm:h-32 sm:w-32"
            />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold sm:text-3xl">{lawyer.full_name}</h1>
                {lawyer.is_verified && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-dark/10 px-2 py-0.5 text-[11px] font-semibold text-brand-dark">
                    <BadgeCheck size={12} /> Verified
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-ink/70">
                {profile?.years_experience ?? 0} years of practice
                {(profile?.jurisdictions?.length ?? 0) > 0 && (
                  <>
                    {' '} · <MapPin size={12} className="-mt-0.5 inline" /> {profile?.jurisdictions?.join(', ')}
                  </>
                )}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <StarRating value={lawyer.avg_rating} size={15} />
                <span className="text-xs text-muted">{ratingLabel}</span>
              </div>
            </div>
            <div className="sm:text-right">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Fees discussed at consultation</p>
              <button
                onClick={book}
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-brand-dark px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand"
              >
                <CalendarPlus size={16} /> Book consultation
              </button>
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* Main column */}
          <div className="space-y-6">
            {profile?.bio && (
              <section className="card">
                <h2 className="text-base font-bold">About</h2>
                <p className="mt-2 whitespace-pre-wrap text-sm text-ink/80">{profile.bio}</p>
              </section>
            )}

            {profile && (
              <section className="card">
                <h2 className="text-base font-bold">Practice</h2>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <Detail icon={Briefcase} label="Practice areas">
                    {(profile.practice_areas ?? []).length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {profile.practice_areas.map((a) => <span key={a} className="badge-muted">{a}</span>)}
                      </div>
                    ) : <span className="text-muted">—</span>}
                  </Detail>
                  <Detail icon={MapPin} label="Jurisdictions">
                    {(profile.jurisdictions ?? []).length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {profile.jurisdictions.map((j) => <span key={j} className="badge-muted">{j}</span>)}
                      </div>
                    ) : <span className="text-muted">—</span>}
                  </Detail>
                  <Detail icon={Languages} label="Languages">
                    {(profile.languages ?? []).length ? profile.languages.join(', ') : <span className="text-muted">—</span>}
                  </Detail>
                  <Detail icon={GraduationCap} label="Bar / practising cert. no.">
                    {[profile.bar_number, profile.practising_certificate_number]
                      .filter(Boolean)
                      .filter((v, i, a) => a.indexOf(v) === i)
                      .join(' / ') || <span className="text-muted">—</span>}
                  </Detail>
                </div>
              </section>
            )}

            <section className="card">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold">Reviews</h2>
                {lawyer.avg_rating && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
                    <Star size={12} className="fill-amber-500 stroke-amber-500" /> {lawyer.avg_rating} avg
                  </span>
                )}
              </div>
              {reviews.length === 0 ? (
                <p className="mt-3 text-sm text-muted">No reviews yet — be the first to work with them.</p>
              ) : (
                <ul className="mt-4 space-y-4">
                  {reviews.slice(0, 6).map((r) => (
                    <li key={r.id} className="border-t border-line/60 pt-4 first:border-0 first:pt-0">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-light/30 text-xs font-bold text-brand-dark">
                            {(r.author_detail?.full_name || '?').slice(0, 1).toUpperCase()}
                          </span>
                          <div>
                            <p className="text-sm font-semibold">{r.author_detail?.full_name ?? 'Anonymous'}</p>
                            <p className="text-[11px] text-muted">{new Date(r.created_at).toLocaleDateString()}</p>
                          </div>
                        </div>
                        <StarRating value={r.rating} size={13} />
                      </div>
                      <p className="mt-2 text-sm text-ink/85">{r.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* Sidebar */}
          <aside className="space-y-4">
            <div className="card sticky top-24">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Ready to start?</p>
              <p className="mt-1 text-sm text-ink">
                Tell {lawyer.first_name} what you need help with. They&rsquo;ll confirm and meet you in your secure matter room.
              </p>
              <button
                onClick={book}
                className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand-dark px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand"
              >
                <CalendarPlus size={16} /> Book consultation
                <ArrowRight size={14} />
              </button>
              {isClient && (
                lawyer.on_retainer ? (
                  <div className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                    <UserCheck size={14} /> On your legal team
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmRetainer(true)}
                    disabled={addingTeam}
                    className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink shadow-sm transition hover:border-brand hover:text-brand disabled:opacity-50"
                  >
                    <UserPlus size={14} /> Add to my legal team
                  </button>
                )
              )}
              <ul className="mt-5 space-y-2.5 text-xs text-ink/75">
                <li className="flex items-start gap-2">
                  <ShieldCheck size={14} className="mt-0.5 shrink-0 text-brand-dark" />
                  Payments held in trust until your lawyer confirms.
                </li>
                <li className="flex items-start gap-2">
                  <Sparkles size={14} className="mt-0.5 shrink-0 text-brand-dark" />
                  Free 15-min discovery slots available.
                </li>
                <li className="flex items-start gap-2">
                  <Globe2 size={14} className="mt-0.5 shrink-0 text-brand-dark" />
                  Video, phone, or in-person.
                </li>
              </ul>
            </div>

            {!isAuthed() && (
              <div className="rounded-2xl border border-dashed border-line p-4 text-xs text-muted">
                <p className="font-semibold text-ink">No account yet?</p>
                <p className="mt-1">
                  You&rsquo;ll be invited to sign up in one step on your way to the booking screen — your selection will carry over.
                </p>
                <Link href="/register" className="mt-2 inline-flex items-center gap-1 font-semibold text-brand hover:underline">
                  <Mail size={12} /> Create a free account
                </Link>
              </div>
            )}
          </aside>
        </div>
      </div>

      {open && <BookModal lawyer={lawyer} onClose={() => setOpen(false)} />}
      {confirmRetainer && (
        <RetainerConfirmModal
          lawyer={lawyer}
          busy={addingTeam}
          onConfirm={addToTeam}
          onClose={() => setConfirmRetainer(false)}
        />
      )}
    </Shell>
  );
}

function RetainerConfirmModal({
  lawyer,
  busy,
  onConfirm,
  onClose,
}: {
  lawyer: Lawyer;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const fee = lawyer.monthly_retainer_fee;
  const hasFee = fee != null && fee !== '';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-brand-darker/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="bg-gradient-to-br from-brand-dark to-brand px-6 py-5 text-white">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-white/80">
            <UserPlus size={14} /> Add to your legal team
          </div>
          <h2 className="mt-1 text-lg font-bold">{lawyer.full_name}</h2>
        </div>
        <div className="space-y-4 p-6">
          {hasFee ? (
            <>
              <div className="rounded-xl border border-line bg-canvas px-4 py-4 text-center">
                <p className="text-xs uppercase tracking-wide text-muted">Monthly retainer</p>
                <p className="mt-1 text-3xl font-extrabold text-brand-dark">
                  ${fee}
                  <span className="text-base font-semibold text-muted">/month</span>
                </p>
              </div>
              <p className="text-sm text-ink/80">
                Keeping {lawyer.first_name} on retainer means you&rsquo;ll be billed{' '}
                <span className="font-semibold">${fee} every month</span>. At the end of each
                month an invoice is raised in your matter room — pay it and upload your proof of
                payment there. You can open a workspace anytime, no per-consultation fee.
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={onClose}
                  disabled={busy}
                  className="flex-1 rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-canvas disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={onConfirm}
                  disabled={busy}
                  className="flex-1 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-50"
                >
                  {busy ? 'Adding…' : `Agree & add`}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-ink/80">
                {lawyer.first_name} hasn&rsquo;t published a monthly retainer fee yet, so they
                can&rsquo;t be added to your team right now. You can still book a one-off
                consultation.
              </p>
              <button
                onClick={onClose}
                className="w-full rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-canvas"
              >
                Close
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Detail({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Briefcase;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
        <Icon size={12} /> {label}
      </p>
      <div className="text-sm text-ink">{children}</div>
    </div>
  );
}
