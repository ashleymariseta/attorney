'use client';

import { Star } from 'lucide-react';
import { useState } from 'react';

const ON = '#0f766e';
const OFF = '#cbd5e1';

export function StarRating({ value = 0, size = 16 }: { value?: number | null; size?: number }) {
  const v = value ?? 0;
  return (
    <span className="inline-flex" aria-label={`${v} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const filled = i <= Math.round(v);
        return <Star key={i} size={size} fill={filled ? ON : 'none'} color={filled ? ON : OFF} strokeWidth={1.5} />;
      })}
    </span>
  );
}

export function StarInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => {
        const filled = i <= (hover || value);
        return (
          <button key={i} type="button" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(0)}
            onClick={() => onChange(i)} className="p-0.5" aria-label={`${i} stars`}>
            <Star size={24} fill={filled ? ON : 'none'} color={filled ? ON : OFF} strokeWidth={1.5} />
          </button>
        );
      })}
    </span>
  );
}
