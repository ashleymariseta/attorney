import {
  Scale,
  Gavel,
  BookOpen,
  FileText,
  Stamp,
  Briefcase,
  Landmark,
  GraduationCap,
  PenLine,
  Scroll,
  ShieldCheck,
  FileSignature,
  Paperclip,
  Building2,
  Banknote,
  Mail,
} from 'lucide-react';

const ICONS = [
  Scale, Gavel, BookOpen, FileText, Stamp, Briefcase, Landmark, GraduationCap,
  PenLine, Scroll, ShieldCheck, FileSignature, Paperclip, Building2, Banknote, Mail,
];

// Deterministic PRNG so the layout is identical on server + client (no hydration
// mismatch) and stable across renders.
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COUNT = 600;
const rand = mulberry32(20240607);

const SPOTS = Array.from({ length: COUNT }, () => ({
  top: rand() * 100,
  left: rand() * 100,
  size: 14 + Math.floor(rand() * 26), // 14–40px
  rot: Math.floor(rand() * 60 - 30), // -30°..30°
  op: 0.035 + rand() * 0.03, // very faint
  icon: Math.floor(rand() * ICONS.length),
}));

export default function ChatDoodles() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {SPOTS.map((s, i) => {
        const Icon = ICONS[s.icon];
        return (
          <Icon
            key={i}
            size={s.size}
            strokeWidth={1.25}
            className="absolute text-brand-dark"
            style={{ top: `${s.top}%`, left: `${s.left}%`, transform: `rotate(${s.rot}deg)`, opacity: s.op }}
          />
        );
      })}
    </div>
  );
}
