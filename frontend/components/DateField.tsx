'use client';

import { DatePicker } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { useEffect, useState } from 'react';

/** Thin date picker exposing a string-in / string-out API so callers don't
 * have to import dayjs or handle nulls.
 *
 * Antd's popup overflows on phones, so we fall back to the platform's
 * native picker on small viewports — well-designed for touch, no overflow,
 * zero JS. Desktop keeps the prettier antd picker.
 *
 *  - mode "datetime" -> picker with showTime; value is an ISO 8601 string.
 *  - mode "date"     -> date-only picker; value is YYYY-MM-DD.
 */
export type DateFieldMode = 'datetime' | 'date';

interface DateFieldProps {
  mode?: DateFieldMode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  minuteStep?: 5 | 10 | 15 | 30;
  className?: string;
  /** Disable selecting dates before the given local-date string (YYYY-MM-DD). */
  minDate?: string;
}

const BREAKPOINT = '(max-width: 640px)';

function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(BREAKPOINT);
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return mobile;
}

function toNativeLocalValue(iso: string, mode: DateFieldMode): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (mode === 'date') return date;
  return `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function DateField({
  mode = 'datetime',
  value,
  onChange,
  placeholder,
  minuteStep = 15,
  className,
  minDate,
  required,
}: DateFieldProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <input
        type={mode === 'datetime' ? 'datetime-local' : 'date'}
        className={className ?? 'field'}
        value={toNativeLocalValue(value, mode)}
        min={minDate || undefined}
        required={required}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return onChange('');
          // datetime-local has no timezone; treat as local and emit ISO.
          if (mode === 'datetime') {
            onChange(new Date(v).toISOString());
          } else {
            onChange(v);
          }
        }}
      />
    );
  }

  const parsed: Dayjs | null = value ? dayjs(value) : null;
  const safe = parsed && parsed.isValid() ? parsed : null;
  const minBoundary = minDate ? dayjs(minDate).startOf('day') : null;

  return (
    <DatePicker
      value={safe}
      onChange={(d) => {
        if (!d) return onChange('');
        onChange(mode === 'datetime' ? d.toISOString() : d.format('YYYY-MM-DD'));
      }}
      showTime={mode === 'datetime' ? { format: 'HH:mm', minuteStep } : false}
      format={mode === 'datetime' ? 'ddd D MMM YYYY · HH:mm' : 'D MMM YYYY'}
      placeholder={placeholder ?? (mode === 'datetime' ? 'Pick a date & time' : 'Pick a date')}
      className={className ?? 'w-full'}
      size="middle"
      disabledDate={minBoundary ? (current) => current && current.isBefore(minBoundary) : undefined}
    />
  );
}
