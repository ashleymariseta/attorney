'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { GraduationCap } from 'lucide-react';
import { lawyers as lawyersApi, type Lawyer } from '@/lib/api';
import { useApp } from '@/components/AppShell';
import BookModal from '@/components/BookModal';
import { DecoIcon } from '@/components/Banner';

function photo(id: number) {
  return `/img/law-${(id % 7) + 1}.jpg`;
}

export default function MyLawyersPage() {
  const { retainers } = useApp();
  const [selected, setSelected] = useState<Lawyer | null>(null);

  async function openWorkspace(lawyerId: number) {
    const lawyer = await lawyersApi.get(lawyerId);
    setSelected(lawyer);
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">My Legal Team</h1>
        <p className="text-sm text-muted">
          Lawyers you keep on retainer. Open a workspace with them anytime — no consultation needed.
        </p>
      </div>

      {retainers.length === 0 ? (
        <div className="card text-sm text-muted">
          You don&rsquo;t have anyone on your legal team yet.{' '}
          <Link href="/lawyers" className="font-semibold text-brand underline">Find a lawyer →</Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {retainers.map((r) => (
            <div key={r.id} className="card relative overflow-hidden">
              <DecoIcon icon={GraduationCap} />
              <div className="relative z-10 flex items-center gap-3">
                <Image src={photo(r.lawyer_detail.id)} alt={r.lawyer_detail.full_name}
                  width={52} height={52} className="h-13 w-13 rounded-full object-cover" />
                <div>
                  <h3 className="font-semibold">{r.lawyer_detail.full_name}</h3>
                  <span className="badge-teal mt-1">{r.status}</span>
                </div>
              </div>
              <dl className="relative z-10 mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs uppercase text-muted">Plan</dt>
                  <dd className="font-medium">{r.plan_name}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted">Cycle</dt>
                  <dd className="font-medium capitalize">{r.cycle}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted">Monthly fee</dt>
                  <dd className="font-medium">{r.monthly_fee ? `$${r.monthly_fee}` : '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted">Included hours</dt>
                  <dd className="font-medium">{r.included_hours}</dd>
                </div>
              </dl>
              <button className="btn-primary relative z-10 mt-4 w-full" onClick={() => openWorkspace(r.lawyer_detail.id)}>
                Open workspace
              </button>
            </div>
          ))}
        </div>
      )}

      {selected && <BookModal lawyer={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
