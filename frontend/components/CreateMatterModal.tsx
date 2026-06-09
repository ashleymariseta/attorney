'use client';

import {
  Briefcase,
  Check,
  ChevronDown,
  FileText,
  GraduationCap,
  Mail,
  Phone,
  Search,
  UserPlus,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, matters as mattersApi, type LawyerClient } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { useEscape } from '@/lib/useEscape';

export default function CreateMatterModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  useEscape(onClose);
  const [clients, setClients] = useState<LawyerClient[]>([]);
  const [loadingClients, setLoadingClients] = useState(true);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [practiceArea, setPracticeArea] = useState('');
  const [selectedClient, setSelectedClient] = useState<LawyerClient | null>(null);
  const [newContact, setNewContact] = useState<null | {
    first_name: string;
    last_name: string;
    email: string;
    phone_number: string;
  }>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const r = await mattersApi.lawyerClients();
        setClients(r.results);
      } catch {}
      setLoadingClients(false);
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!title.trim()) return setError('Give the matter a short title.');
    if (!selectedClient && !newContact) return setError('Pick a client or enter contact details.');
    if (newContact) {
      if (!newContact.first_name.trim() || !newContact.last_name.trim()) {
        return setError('New client needs both first and last name.');
      }
      if (!newContact.email.trim() && !newContact.phone_number.trim()) {
        return setError('Enter at least an email or phone number for the new client.');
      }
    }

    setBusy(true);
    try {
      const created = await mattersApi.createForClient({
        title: title.trim(),
        description: description.trim() || undefined,
        practice_area: practiceArea.trim() || undefined,
        client_id: selectedClient?.id,
        contact: newContact
          ? {
              first_name: newContact.first_name.trim(),
              last_name: newContact.last_name.trim(),
              email: newContact.email.trim() || undefined,
              phone_number: newContact.phone_number.trim() || undefined,
            }
          : undefined,
      });
      onCreated?.();
      onClose();
      if (created.invited && created.client_email) {
        toast.success(`Matter opened. We've notified ${created.client_email}.`, {
          title: 'New client invited',
          major: true,
        });
      } else {
        toast.success(`Matter "${created.title}" opened.`, { major: true });
      }
      router.push(`/matters/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create matter.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-brand-darker/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-line">
        <div className="flex items-center justify-between bg-brand px-5 py-4 text-white">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-white/15">
              <Briefcase size={18} />
            </span>
            <h2 className="text-base font-bold">New matter</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-white/80 transition hover:bg-white/15 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="max-h-[75vh] space-y-4 overflow-y-auto p-5">
          <Field icon={FileText} label="Matter title">
            <input
              className="field"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="e.g. Lease review for 12 Stand Rd"
            />
          </Field>

          <Field icon={UserPlus} label="Client" hint="Search clients you've worked with, or invite a new one.">
            <ClientPicker
              clients={clients}
              loading={loadingClients}
              selected={selectedClient}
              onSelectClient={(c) => {
                setSelectedClient(c);
                setNewContact(null);
              }}
              newContactMode={newContact !== null}
              onStartNew={() => {
                setSelectedClient(null);
                setNewContact({ first_name: '', last_name: '', email: '', phone_number: '' });
              }}
              onCancelNew={() => setNewContact(null)}
            />
          </Field>

          {newContact && (
            <div className="space-y-3 rounded-xl border border-brand-light/40 bg-brand-light/5 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-dark">
                New client — they&apos;ll be invited
              </p>
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="field"
                  placeholder="First name"
                  value={newContact.first_name}
                  onChange={(e) => setNewContact({ ...newContact, first_name: e.target.value })}
                  required
                />
                <input
                  className="field"
                  placeholder="Last name"
                  value={newContact.last_name}
                  onChange={(e) => setNewContact({ ...newContact, last_name: e.target.value })}
                  required
                />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="flex items-center gap-2 rounded-lg border border-line bg-white px-3">
                  <Phone size={14} className="text-muted" />
                  <input
                    className="w-full bg-transparent py-2 text-sm focus:outline-none"
                    placeholder="Phone number"
                    value={newContact.phone_number}
                    onChange={(e) => setNewContact({ ...newContact, phone_number: e.target.value })}
                  />
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-line bg-white px-3">
                  <Mail size={14} className="text-muted" />
                  <input
                    className="w-full bg-transparent py-2 text-sm focus:outline-none"
                    placeholder="Email (optional)"
                    type="email"
                    value={newContact.email}
                    onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
                  />
                </div>
              </div>
              <p className="text-[11px] text-muted">
                We&apos;ll send them an invite to join the matter room. At least a phone number or email is required.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field icon={Briefcase} label="Practice area" hint="Optional.">
              <input
                className="field"
                placeholder="e.g. Conveyancing"
                value={practiceArea}
                onChange={(e) => setPracticeArea(e.target.value)}
              />
            </Field>
            <Field icon={FileText} label="Description" hint="Optional.">
              <input
                className="field"
                placeholder="One-line summary"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:border-brand hover:text-brand"
            >
              Cancel
            </button>
            <button
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-dark px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Create matter'}
              {!busy && <Check size={16} />}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  icon: Icon,
  label,
  hint,
  children,
}: {
  icon: any;
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
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

function ClientPicker({
  clients,
  loading,
  selected,
  newContactMode,
  onSelectClient,
  onStartNew,
  onCancelNew,
}: {
  clients: LawyerClient[];
  loading: boolean;
  selected: LawyerClient | null;
  newContactMode: boolean;
  onSelectClient: (c: LawyerClient) => void;
  onStartNew: () => void;
  onCancelNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) =>
      `${c.full_name} ${c.email} ${c.phone_number}`.toLowerCase().includes(q)
    );
  }, [clients, query]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    if (open) document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => setHighlight(0), [query, open]);

  function pick(c: LawyerClient) {
    onSelectClient(c);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  }

  if (newContactMode) {
    return (
      <button
        type="button"
        onClick={onCancelNew}
        className="flex w-full items-center justify-between rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-muted hover:border-brand"
      >
        <span className="flex items-center gap-2">
          <UserPlus size={14} /> Inviting a new client
        </span>
        <span className="text-[11px] text-brand">Choose existing instead</span>
      </button>
    );
  }

  const showInviteRow = !loading && filtered.length === 0 && query.trim().length > 0;

  return (
    <div ref={ref} className="relative">
      <div
        className={`flex items-center gap-1.5 rounded-lg border bg-white px-2.5 transition ${
          open ? 'border-brand ring-2 ring-brand-light/40' : 'border-line'
        }`}
      >
        <Search size={14} className="text-muted" />
        <input
          ref={inputRef}
          type="text"
          value={open ? query : selected?.full_name ?? ''}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlight((h) => Math.min(filtered.length - 1, h + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlight((h) => Math.max(0, h - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (filtered[highlight]) pick(filtered[highlight]);
            } else if (e.key === 'Escape') {
              setOpen(false);
              inputRef.current?.blur();
            }
          }}
          placeholder={selected ? selected.full_name : 'Search clients by name, email or phone'}
          className="w-full bg-transparent py-2 text-sm text-ink placeholder:text-muted focus:outline-none"
        />
        <ChevronDown size={14} className="text-muted" />
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-xl">
          {loading ? (
            <p className="px-3 py-3 text-xs text-muted">Loading clients…</p>
          ) : filtered.length === 0 && !query ? (
            <p className="px-3 py-3 text-xs text-muted">No prior clients yet.</p>
          ) : (
            filtered.map((c, i) => {
              const isHighlighted = i === highlight;
              return (
                <button
                  key={c.id}
                  type="button"
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pick(c)}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left text-xs transition ${
                    isHighlighted ? 'bg-brand-light/10' : ''
                  }`}
                >
                  <span
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                      c.relationship === 'retainer'
                        ? 'bg-brand-light/20 text-brand-dark'
                        : 'bg-line text-muted'
                    }`}
                  >
                    {(c.first_name?.[0] ?? '') + (c.last_name?.[0] ?? '') || c.email[0]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink">{c.full_name}</p>
                    <p className="truncate text-[11px] text-muted">
                      {c.email}
                      {c.phone_number && ` · ${c.phone_number}`}
                    </p>
                  </div>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                      c.relationship === 'retainer'
                        ? 'bg-brand-light/20 text-brand-dark'
                        : 'bg-line text-muted'
                    }`}
                  >
                    {c.relationship === 'retainer' ? (
                      <>
                        <GraduationCap size={9} /> Retainer
                      </>
                    ) : (
                      'Prior'
                    )}
                  </span>
                </button>
              );
            })
          )}
          <div className="border-t border-line">
            <button
              type="button"
              onClick={() => {
                onStartNew();
                setOpen(false);
                setQuery('');
              }}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold text-brand-dark hover:bg-brand-light/10"
            >
              <UserPlus size={14} />
              {showInviteRow ? `Invite "${query}" as a new client` : 'Invite a new client by contact details'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
