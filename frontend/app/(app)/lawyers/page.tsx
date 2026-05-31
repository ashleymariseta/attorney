'use client';

import Image from 'next/image';
import {
  BadgeCheck,
  Briefcase,
  Building2,
  ChevronDown,
  GraduationCap,
  MapPin,
  Scale,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { firms as firmsApi, lawyers as lawyersApi, type FirmCard, type Lawyer } from '@/lib/api';
import BookModal from '@/components/BookModal';
import { StarRating } from '@/components/Stars';
import { DecoIcon } from '@/components/Banner';

function photo(id: number) {
  return `/img/law-${(id % 7) + 1}.jpg`;
}

const YEARS = [
  { label: 'Any', value: 0 },
  { label: '3+ yrs', value: 3 },
  { label: '5+ yrs', value: 5 },
  { label: '10+ yrs', value: 10 },
];

export default function LawyersPage() {
  const [list, setList] = useState<Lawyer[]>([]);
  const [firmList, setFirmList] = useState<FirmCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Lawyer | null>(null);
  const [tab, setTab] = useState<'lawyers' | 'firms'>('lawyers');

  // filters
  const [q, setQ] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [areas, setAreas] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [minYears, setMinYears] = useState(0);
  const [retainerOnly, setRetainerOnly] = useState(false);
  const [firmFilter, setFirmFilter] = useState<number | null>(null);

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

  const toggle = (setter: React.Dispatch<React.SetStateAction<string[]>>, v: string) =>
    setter((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));

  const activeCount =
    areas.length + locations.length + (minYears > 0 ? 1 : 0) + (retainerOnly ? 1 : 0);

  function clearAll() {
    setAreas([]);
    setLocations([]);
    setMinYears(0);
    setRetainerOnly(false);
  }

  const firmName = useMemo(() => {
    if (firmFilter == null) return null;
    return firmList.find((f) => f.id === firmFilter)?.name ?? null;
  }, [firmFilter, firmList]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return list.filter((l) => {
      if (term && !l.full_name.toLowerCase().includes(term)) return false;
      if (retainerOnly && !l.on_retainer) return false;
      if (minYears && (l.profile?.years_experience ?? 0) < minYears) return false;
      if (areas.length && !(l.profile?.practice_areas ?? []).some((a) => areas.includes(a))) return false;
      if (locations.length && !(l.profile?.jurisdictions ?? []).some((j) => locations.includes(j))) return false;
      if (firmFilter != null && (l.profile as any)?.firm !== firmFilter) return false;
      return true;
    });
  }, [q, list, areas, locations, minYears, retainerOnly, firmFilter]);

  const filteredFirms = useMemo(() => {
    const term = q.trim().toLowerCase();
    return firmList.filter((f) => {
      if (term && !f.name.toLowerCase().includes(term)) return false;
      if (areas.length && !(f.practice_areas ?? []).some((a) => areas.includes(a))) return false;
      if (locations.length && !(f.jurisdictions ?? []).some((j) => locations.includes(j))) return false;
      return true;
    });
  }, [q, firmList, areas, locations]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Find a Lawyer</h1>
        <p className="text-sm text-muted">
          Choose a verified practitioner or firm. Engagements start with a consultation — unless they&rsquo;re on your legal team.
        </p>
      </div>

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
          <button onClick={() => setFirmFilter(null)} className="rounded-full p-0.5 hover:bg-white/40" aria-label="Clear firm filter">
            <X size={12} />
          </button>
        </div>
      )}

      {/* search + filter toggle */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="field pl-9"
            placeholder="Search by name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <button
          onClick={() => setShowFilters((s) => !s)}
          className={`btn-outline gap-2 ${showFilters ? 'border-brand text-brand' : ''}`}
        >
          <SlidersHorizontal size={16} />
          Filters
          {activeCount > 0 && (
            <span className="rounded-full bg-brand-dark px-1.5 text-[10px] font-bold text-white">{activeCount}</span>
          )}
          <ChevronDown size={14} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* collapsible filter pane */}
      <div className={`grid transition-all duration-300 ${showFilters ? 'mt-3 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          <div className="card space-y-5">
            <FilterGroup icon={Briefcase} title="Practice area">
              {allAreas.map((a) => (
                <Chip key={a} active={areas.includes(a)} onClick={() => toggle(setAreas, a)}>{a}</Chip>
              ))}
            </FilterGroup>

            <FilterGroup icon={MapPin} title="Location">
              {allLocations.map((loc) => (
                <Chip key={loc} active={locations.includes(loc)} onClick={() => toggle(setLocations, loc)}>{loc}</Chip>
              ))}
            </FilterGroup>

            <FilterGroup icon={GraduationCap} title="Experience">
              {YEARS.map((y) => (
                <Chip key={y.value} active={minYears === y.value} onClick={() => setMinYears(y.value)}>{y.label}</Chip>
              ))}
            </FilterGroup>

            <div className="flex items-center justify-between border-t border-line pt-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={retainerOnly} onChange={(e) => setRetainerOnly(e.target.checked)}
                  className="h-4 w-4 accent-[#0f766e]" />
                On my legal team only
              </label>
              {activeCount > 0 && (
                <button onClick={clearAll} className="flex items-center gap-1 text-xs font-semibold text-muted hover:text-ink">
                  <X size={14} /> Clear all
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <p className="mb-4 mt-5 text-xs text-muted">
        {tab === 'lawyers'
          ? `${filtered.length} lawyer${filtered.length === 1 ? '' : 's'}`
          : `${filteredFirms.length} firm${filteredFirms.length === 1 ? '' : 's'}`}
      </p>

      {tab === 'firms' && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {loading && <p className="text-sm text-muted">Loading firms…</p>}
          {filteredFirms.map((f) => (
            <div key={f.id} className="card relative flex flex-col overflow-hidden">
              <DecoIcon icon={Building2} />
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
              <div className="relative z-10 mt-4 flex items-center justify-between border-t border-line pt-3">
                <p className="text-sm">
                  {f.starting_rate ? (
                    <>
                      <span className="text-xs text-muted">from </span>
                      <span className="font-semibold">${f.starting_rate}</span>
                      <span className="text-xs text-muted"> / hour</span>
                    </>
                  ) : (
                    <span className="text-xs text-muted">Contact for rates</span>
                  )}
                </p>
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

      {tab === 'lawyers' && loading ? (
        <p className="text-sm text-muted">Loading lawyers…</p>
      ) : tab === 'lawyers' ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((l) => (
            <div key={l.id} className="card relative flex flex-col overflow-hidden">
              <DecoIcon icon={Scale} />
              <div className="relative z-10 flex items-center gap-3">
                <Image src={photo(l.id)} alt={l.full_name} width={56} height={56}
                  className="h-14 w-14 rounded-full object-cover" />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h3 className="truncate font-semibold">{l.full_name}</h3>
                    {l.is_verified && <BadgeCheck size={15} className="shrink-0 text-brand" />}
                  </div>
                  <p className="text-xs text-muted">
                    {l.profile?.years_experience ?? 0} yrs · {(l.profile?.jurisdictions ?? []).join(', ') || '—'}
                  </p>
                  <div className="mt-1 flex items-center gap-1">
                    <StarRating value={l.avg_rating} size={13} />
                    <span className="text-xs text-muted">
                      {l.avg_rating ? `${l.avg_rating} (${l.review_count})` : 'No reviews'}
                    </span>
                  </div>
                </div>
              </div>

              {l.on_retainer && (
                <span className="badge-teal relative z-10 mt-3 flex w-fit items-center gap-1">
                  <GraduationCap size={12} /> On your legal team
                </span>
              )}

              <p className="relative z-10 mt-3 line-clamp-2 text-sm text-ink/70">{l.profile?.bio}</p>

              <div className="relative z-10 mt-3 flex flex-wrap gap-1.5">
                {(l.profile?.practice_areas ?? []).slice(0, 3).map((a) => (
                  <span key={a} className="badge-muted">{a}</span>
                ))}
              </div>

              <div className="relative z-10 mt-4 flex items-center justify-between border-t border-line pt-3">
                <p className="text-sm">
                  <span className="font-semibold">${l.hourly_rate ?? '—'}</span>
                  <span className="text-xs text-muted"> / hour</span>
                </p>
                <button className={l.on_retainer ? 'btn-light' : 'btn-primary'} onClick={() => setSelected(l)}>
                  {l.on_retainer ? 'Open workspace' : 'Book consultation'}
                </button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="text-sm text-muted">No lawyers match your filters.</p>
          )}
        </div>
      ) : null}

      {selected && <BookModal lawyer={selected} onClose={() => setSelected(null)} />}
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
