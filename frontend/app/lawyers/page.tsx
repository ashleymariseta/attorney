'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BadgeCheck,
  Briefcase,
  Building2,
  ChevronDown,
  Globe2,
  GraduationCap,
  MapPin,
  Scale,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { firms as firmsApi, isAuthed, lawyers as lawyersApi, type FirmCard, type Lawyer } from '@/lib/api';
import { countryName, flagFor } from '@/lib/flag';
import PublicHeader from '@/components/PublicHeader';
import PublicFooter from '@/components/PublicFooter';
import AppShell from '@/components/AppShell';
import { StarRating } from '@/components/Stars';
import { DecoIcon } from '@/components/Banner';
import { SkeletonCard } from '@/components/Skeleton';
import BookModal from '@/components/BookModal';

function photo(id: number) {
  return `/img/law-${(id % 7) + 1}.jpg`;
}

const YEARS = [
  { label: 'Any', value: 0 },
  { label: '3+ yrs', value: 3 },
  { label: '5+ yrs', value: 5 },
  { label: '10+ yrs', value: 10 },
];

const SORTS = [
  { value: 'top', label: 'Top rated' },
  { value: 'experience', label: 'Most experience' },
];

const HERO_HIGHLIGHTS = [
  { icon: BadgeCheck, label: 'Verified credentials' },
  { icon: ShieldCheck, label: 'Trust-accounted payments' },
  { icon: Sparkles, label: 'Free 15-min discovery calls' },
];

export default function PublicLawyersPage() {
  const router = useRouter();

  const [list, setList] = useState<Lawyer[]>([]);
  const [firmList, setFirmList] = useState<FirmCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'lawyers' | 'firms'>('lawyers');

  // for in-app authed users, opening the book modal directly
  const [bookFor, setBookFor] = useState<Lawyer | null>(null);

  // shell selection — sidebar+nav when authed, marketing chrome when not
  const [authMode, setAuthMode] = useState<'pending' | 'authed' | 'public'>('pending');
  useEffect(() => {
    setAuthMode(isAuthed() ? 'authed' : 'public');
  }, []);

  // filters
  const [q, setQ] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [areas, setAreas] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [countries, setCountries] = useState<string[]>([]);
  const [minYears, setMinYears] = useState(0);
  const [firmFilter, setFirmFilter] = useState<number | null>(null);
  const [sort, setSort] = useState<string>('top');

  useEffect(() => {
    (async () => {
      try {
        const [lr, fr] = await Promise.all([lawyersApi.list(), firmsApi.list()]);
        setList(lr.results);
        setFirmList(fr.results);
      } catch {}
      setLoading(false);
    })();
  }, []);

  const allAreas = useMemo(
    () => Array.from(new Set(list.flatMap((l) => l.profile?.practice_areas ?? []))).sort(),
    [list]
  );
  const allLocations = useMemo(
    () => Array.from(new Set(list.flatMap((l) => l.profile?.jurisdictions ?? []))).sort(),
    [list]
  );

  const allCountries = useMemo(() => {
    const set = new Set<string>();
    list.forEach((l) => l.country && set.add(l.country));
    firmList.forEach((f) => f.country && set.add(f.country));
    return Array.from(set).sort();
  }, [list, firmList]);

  const toggle = (setter: React.Dispatch<React.SetStateAction<string[]>>, v: string) =>
    setter((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));

  const activeCount =
    areas.length + locations.length + countries.length + (minYears > 0 ? 1 : 0) + (firmFilter ? 1 : 0);

  function clearAll() {
    setAreas([]);
    setLocations([]);
    setCountries([]);
    setMinYears(0);
    setFirmFilter(null);
  }

  const firmName = useMemo(() => {
    if (firmFilter == null) return null;
    return firmList.find((f) => f.id === firmFilter)?.name ?? null;
  }, [firmFilter, firmList]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const out = list.filter((l) => {
      if (term) {
        const haystack = [
          l.full_name,
          ...(l.profile?.practice_areas ?? []),
          ...(l.profile?.jurisdictions ?? []),
          countryName(l.country),
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (minYears && (l.profile?.years_experience ?? 0) < minYears) return false;
      if (areas.length && !(l.profile?.practice_areas ?? []).some((a) => areas.includes(a))) return false;
      if (locations.length && !(l.profile?.jurisdictions ?? []).some((j) => locations.includes(j))) return false;
      if (countries.length && !countries.includes(l.country)) return false;
      if (firmFilter != null && (l.profile as { firm?: number } | null)?.firm !== firmFilter) return false;
      return true;
    });
    return out.sort((a, b) => {
      switch (sort) {
        case 'experience':
          return (b.profile?.years_experience ?? 0) - (a.profile?.years_experience ?? 0);
        default:
          return (b.avg_rating ?? 0) - (a.avg_rating ?? 0) || (b.review_count ?? 0) - (a.review_count ?? 0);
      }
    });
  }, [q, list, areas, locations, countries, minYears, firmFilter, sort]);

  const filteredFirms = useMemo(() => {
    const term = q.trim().toLowerCase();
    return firmList.filter((f) => {
      if (term && !f.name.toLowerCase().includes(term)) return false;
      if (areas.length && !(f.practice_areas ?? []).some((a) => areas.includes(a))) return false;
      if (locations.length && !(f.jurisdictions ?? []).some((j) => locations.includes(j))) return false;
      if (countries.length && !countries.includes(f.country)) return false;
      return true;
    });
  }, [q, firmList, areas, locations, countries]);

  function bookLawyer(l: Lawyer) {
    if (isAuthed()) {
      setBookFor(l);
    } else {
      router.push(`/login?next=${encodeURIComponent(`/book/${l.id}`)}`);
    }
  }

  const searchBar = (
    <div className="rounded-2xl border border-line bg-white/95 p-2 shadow-xl shadow-brand-dark/5 ring-1 ring-line">
      <div className="flex items-center gap-2">
        <Search size={18} className="ml-3 shrink-0 text-muted" />
        <input
          className="flex-1 border-0 bg-transparent px-1 py-2 text-sm outline-none placeholder:text-muted focus:ring-0"
          placeholder="Search by name, practice area, or city…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          onClick={() => setShowFilters((s) => !s)}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition ${
            showFilters ? 'bg-brand-dark text-white' : 'bg-canvas text-ink hover:bg-line'
          }`}
        >
          <SlidersHorizontal size={14} />
          Filters
          {activeCount > 0 && (
            <span
              className={`rounded-full px-1.5 text-[10px] font-bold ${
                showFilters ? 'bg-white/20 text-white' : 'bg-brand-dark text-white'
              }`}
            >
              {activeCount}
            </span>
          )}
        </button>
      </div>
    </div>
  );

  const directoryBody = (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {/* Tabs */}
        <div className="mb-5 flex items-center gap-1 border-b border-line">
          <TabBtn active={tab === 'lawyers'} onClick={() => setTab('lawyers')}>
            <GraduationCap size={14} /> Lawyers
            <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
              tab === 'lawyers' ? 'bg-brand-dark text-white' : 'bg-line text-muted'
            }`}>{filtered.length}</span>
          </TabBtn>
          <TabBtn active={tab === 'firms'} onClick={() => { setTab('firms'); setFirmFilter(null); }}>
            <Building2 size={14} /> Firms
            <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
              tab === 'firms' ? 'bg-brand-dark text-white' : 'bg-line text-muted'
            }`}>{filteredFirms.length}</span>
          </TabBtn>
        </div>

        {firmFilter != null && tab === 'lawyers' && (
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-brand-light/15 px-3 py-1 text-xs font-semibold text-brand-dark">
            <Building2 size={12} /> {firmName}
            <button
              onClick={() => setFirmFilter(null)}
              className="rounded-full p-0.5 hover:bg-white/40"
              aria-label="Clear firm filter"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* Filter pane */}
        <div className={`grid transition-all duration-300 ${showFilters ? 'mt-3 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
          <div className="overflow-hidden">
            <div className="card space-y-5">
              <FilterGroup icon={Briefcase} title="Practice area">
                {allAreas.map((a) => (
                  <Chip key={a} active={areas.includes(a)} onClick={() => toggle(setAreas, a)}>
                    {a}
                  </Chip>
                ))}
                {!allAreas.length && <p className="text-xs text-muted">No areas yet.</p>}
              </FilterGroup>

              <FilterGroup icon={Globe2} title="Country">
                {allCountries.map((c) => (
                  <Chip key={c} active={countries.includes(c)} onClick={() => toggle(setCountries, c)}>
                    <span className="mr-1">{flagFor(c)}</span>
                    {countryName(c)}
                  </Chip>
                ))}
                {!allCountries.length && <p className="text-xs text-muted">No countries yet.</p>}
              </FilterGroup>

              <FilterGroup icon={MapPin} title="Jurisdictions">
                {allLocations.map((loc) => (
                  <Chip key={loc} active={locations.includes(loc)} onClick={() => toggle(setLocations, loc)}>
                    {loc}
                  </Chip>
                ))}
                {!allLocations.length && <p className="text-xs text-muted">No jurisdictions yet.</p>}
              </FilterGroup>

              <FilterGroup icon={GraduationCap} title="Experience">
                {YEARS.map((y) => (
                  <Chip key={y.value} active={minYears === y.value} onClick={() => setMinYears(y.value)}>
                    {y.label}
                  </Chip>
                ))}
              </FilterGroup>

              {firmList.length > 0 && (
                <FilterGroup icon={Building2} title="Firm">
                  {firmList.map((f) => (
                    <Chip key={f.id} active={firmFilter === f.id} onClick={() => setFirmFilter(firmFilter === f.id ? null : f.id)}>
                      {f.name}
                    </Chip>
                  ))}
                </FilterGroup>
              )}

              <div className="flex items-center justify-between border-t border-line pt-4">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold uppercase tracking-wide text-muted">Sort</span>
                  <div className="relative">
                    <select
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                      className="appearance-none rounded-lg border border-line bg-white px-3 py-1.5 pr-7 font-semibold text-ink focus:border-brand focus:outline-none"
                    >
                      {SORTS.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted" />
                  </div>
                </div>
                {activeCount > 0 && (
                  <button onClick={clearAll} className="flex items-center gap-1 text-xs font-semibold text-muted hover:text-ink">
                    <X size={14} /> Clear all
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <p className="mb-4 mt-6 text-xs text-muted">
          {tab === 'lawyers'
            ? `${filtered.length} lawyer${filtered.length === 1 ? '' : 's'}`
            : `${filteredFirms.length} firm${filteredFirms.length === 1 ? '' : 's'}`}
        </p>

        {tab === 'firms' && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {loading && Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={`skf-${i}`} />)}
            {filteredFirms.map((f) => (
              <div key={f.id} className="card relative flex flex-col overflow-hidden">
                <DecoIcon icon={Building2} />
                {f.country && (
                  <span
                    className="absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded-full border border-line bg-white/95 px-2 py-1 text-xs font-semibold text-ink shadow-sm"
                    title={countryName(f.country)}
                  >
                    <span className="text-base leading-none">{flagFor(f.country)}</span>
                    {f.country}
                  </span>
                )}
                <div className="relative z-10 flex items-center gap-3">
                  <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-brand-dark text-white">
                    <Building2 size={24} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h3 className="truncate font-semibold">{f.name}</h3>
                      {f.verified && <BadgeCheck size={15} className="shrink-0 text-brand" />}
                    </div>
                    <p className="text-xs text-muted">
                      {f.lawyer_count} lawyer{f.lawyer_count === 1 ? '' : 's'} ·{' '}
                      {(f.jurisdictions ?? []).join(', ') || '—'}
                    </p>
                  </div>
                </div>
                <div className="relative z-10 mt-3 flex flex-wrap gap-1.5">
                  {(f.practice_areas ?? []).slice(0, 4).map((a) => (
                    <span key={a} className="badge-muted">{a}</span>
                  ))}
                </div>
                <div className="relative z-10 mt-4 flex items-center justify-end border-t border-line pt-3">
                  <button
                    onClick={() => {
                      setFirmFilter(f.id);
                      setTab('lawyers');
                    }}
                    className="btn-light"
                  >
                    View lawyers
                  </button>
                </div>
              </div>
            ))}
            {!loading && filteredFirms.length === 0 && (
              <p className="text-sm text-muted">No firms match your filters.</p>
            )}
          </div>
        )}

        {tab === 'lawyers' && (loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={`skl-${i}`} />)}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((l) => (
              <div key={l.id} className="card relative flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lg">
                <DecoIcon icon={Scale} />
                {l.country && (
                  <span
                    className="absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded-full border border-line bg-white/95 px-2 py-1 text-xs font-semibold text-ink shadow-sm"
                    title={countryName(l.country)}
                  >
                    <span className="text-base leading-none">{flagFor(l.country)}</span>
                    {l.country}
                  </span>
                )}
                <Link href={`/lawyers/${l.id}`} className="relative z-10 flex items-center gap-3 outline-none">
                  <Image
                    src={photo(l.id)}
                    alt={`Headshot of ${l.full_name}`}
                    width={56}
                    height={56}
                    className="h-14 w-14 rounded-full object-cover"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h3 className="truncate font-semibold group-hover:text-brand">{l.full_name}</h3>
                      {l.is_verified && <BadgeCheck size={15} className="shrink-0 text-brand" />}
                    </div>
                    <p className="text-xs text-muted">
                      {l.profile?.years_experience ?? 0} yrs · {(l.profile?.jurisdictions ?? []).join(', ') || '—'}
                    </p>
                    <div className="mt-1 flex items-center gap-1">
                      <StarRating value={l.avg_rating} size={13} />
                      <span className="text-xs text-muted">
                        {l.avg_rating ? `${l.avg_rating} (${l.review_count})` : 'No reviews yet'}
                      </span>
                    </div>
                  </div>
                </Link>

                <p className="relative z-10 mt-3 line-clamp-2 text-sm text-ink/70">{l.profile?.bio}</p>

                <div className="relative z-10 mt-3 flex flex-wrap gap-1.5">
                  {(l.profile?.practice_areas ?? []).slice(0, 3).map((a) => (
                    <span key={a} className="badge-muted">{a}</span>
                  ))}
                </div>

                <div className="relative z-10 mt-4 grid grid-cols-2 gap-2 border-t border-line pt-3">
                  <Link
                    href={`/lawyers/${l.id}`}
                    className="inline-flex items-center justify-center rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:border-brand"
                  >
                    View profile
                  </Link>
                  <button
                    onClick={() => bookLawyer(l)}
                    className="inline-flex items-center justify-center gap-1 rounded-lg bg-brand-dark px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand"
                  >
                    Book consultation
                    <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="col-span-full rounded-2xl border border-dashed border-line p-10 text-center">
                <p className="text-sm font-semibold text-ink">No lawyers match your filters.</p>
                <p className="mt-1 text-xs text-muted">Try clearing a filter or searching by a different practice area.</p>
                {activeCount > 0 && (
                  <button onClick={clearAll} className="mt-4 btn-outline">Clear filters</button>
                )}
              </div>
            )}
          </div>
        ))}

    </div>
  );

  if (authMode === 'pending') {
    return <div className="min-h-screen bg-white" />;
  }

  if (authMode === 'authed') {
    return (
      <AppShell>
        <div className="mx-auto max-w-5xl px-4 pt-8 sm:px-6">
          <h1 className="text-2xl font-bold">Find a lawyer</h1>
          <p className="mt-1 text-sm text-muted">
            Browse verified practitioners and firms — filter by practice area, country, experience and more.
          </p>
          <div className="mt-5">{searchBar}</div>
        </div>
        {directoryBody}
        {bookFor && <BookModal lawyer={bookFor} onClose={() => setBookFor(null)} />}
      </AppShell>
    );
  }

  return (
    <div className="min-h-screen bg-white text-ink">
      <PublicHeader />

      {/* HERO */}
      <section className="relative overflow-hidden border-b border-line bg-gradient-to-br from-brand-light/15 via-white to-brand-light/5">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-light/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-24 h-72 w-72 rounded-full bg-brand/10 blur-3xl" />
        <div className="relative mx-auto max-w-5xl px-6 py-12 sm:py-16">
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-dark/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-dark">
              <Scale size={12} /> The lawyer directory
            </span>
            <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
              Find the right lawyer.{' '}
              <span className="text-brand-dark">Book in minutes.</span>
            </h1>
            <p className="mt-3 text-sm text-ink/70 sm:text-base">
              Search verified attorneys by practice area, jurisdiction, experience and rate — then book a consultation directly.
              Your matter and payments stay in one secure workspace.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-muted">
              {HERO_HIGHLIGHTS.map((h) => (
                <span key={h.label} className="inline-flex items-center gap-1.5">
                  <h.icon size={14} className="text-brand-dark" /> {h.label}
                </span>
              ))}
            </div>
          </div>

          <div className="mx-auto mt-8 max-w-2xl">{searchBar}</div>
        </div>
      </section>

      {directoryBody}

      <PublicFooter />

      {bookFor && <BookModal lawyer={bookFor} onClose={() => setBookFor(null)} />}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
        active ? 'border-brand-dark text-brand-dark' : 'border-transparent text-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

function FilterGroup({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Briefcase;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        <Icon size={14} /> {title}
      </p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active ? 'border-brand-dark bg-brand-dark text-white' : 'border-line text-muted hover:border-brand'
      }`}
    >
      {children}
    </button>
  );
}
