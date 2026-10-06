/** Atoms from docs/design/components.md, rendered with the approved prototype's CSS classes. */
import type { ReactNode } from 'react';
import type { Grade, SparkType, TrainMode } from '@uma/schema';
import { initials } from '../lib/format.ts';

const GLYPH: Record<SparkType, string> = { blue: '●', pink: '♥', green: '▲', white: '◇' };
const TYPEWORD: Record<SparkType, string> = {
  blue: 'Blue (stat)',
  pink: 'Pink (aptitude)',
  green: 'Green (unique)',
  white: 'White (skill/race)',
};

export function Stars({ n }: { n: number }) {
  return (
    <span className="stars" role="img" aria-label={`${n} of 3 stars`}>
      {'★'.repeat(n)}
      <span className="off">{'★'.repeat(Math.max(0, 3 - n))}</span>
    </span>
  );
}

export function SparkPill({ type, name, stars, extra }: { type: SparkType; name: string; stars: number; extra?: ReactNode }) {
  return (
    <span className={`spark ${type}`} title={TYPEWORD[type]}>
      <span className="g" aria-hidden="true">
        {GLYPH[type]}
      </span>
      <span className="sr">{type} spark: </span>
      <span className="nm">{name}</span>
      {extra} <Stars n={stars} />
    </span>
  );
}

export function GradeBadge({ g, lg, ghost }: { g: Grade; lg?: boolean; ghost?: boolean }) {
  return (
    <span className={`grade g-${g}${lg ? ' lg' : ''}${ghost ? ' ghost' : ''}`} title={`Grade ${g}`}>
      {g}
    </span>
  );
}

export function LbDiamonds({ n }: { n: number }) {
  return (
    <span className="lb" role="img" aria-label={`Limit break ${n} of 4`}>
      {'◆'.repeat(n)}
      <span className="off">{'◆'.repeat(Math.max(0, 4 - n))}</span>
      <small>LB{n}</small>
    </span>
  );
}

export function ModeBadge({ mode, override }: { mode: TrainMode; override: boolean }) {
  return (
    <span className={`mode ${mode}`}>
      {mode === 'independent' ? 'Independent' : 'Manual'}
      {override && (
        <>
          {' '}
          <span className="ov" role="img" aria-label="Manually overridden" title="Overridden by you (not from epithet)">
            ✎
          </span>
        </>
      )}
    </span>
  );
}

export function Avatar({ name, lg }: { name: string; lg?: boolean }) {
  return (
    <span className={`avatar${lg ? ' lg' : ''}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function Tag({ kind, children }: { kind: 'ok' | 'warn' | 'err' | 'neutral'; children: ReactNode }) {
  return <span className={`tag ${kind}`}>{children}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

const TYPE_CODE: Record<string, string> = {
  speed: 'SPD',
  stamina: 'STA',
  power: 'POW',
  guts: 'GUT',
  wit: 'WIT',
  friend: 'FRD',
  group: 'GRP',
};
export function TypeChip({ type }: { type: string }) {
  const word = type[0]!.toUpperCase() + type.slice(1);
  return (
    <span className="type-chip" title={`${word} card`}>
      {TYPE_CODE[type] ?? type.toUpperCase()} {word}
    </span>
  );
}

export function Banner({
  kind,
  children,
  role,
}: {
  kind: 'warn' | 'err' | 'info';
  children: ReactNode;
  role?: 'status' | 'alert';
}) {
  return (
    <div className={`banner ${kind}`} role={role ?? (kind === 'err' ? 'alert' : 'status')}>
      {children}
    </div>
  );
}

export function ErrorBanner({ text, onRetry }: { text: ReactNode; onRetry?: () => void }) {
  return (
    <Banner kind="err">
      <span>{text}</span>
      <span className="sp" />
      {onRetry && (
        <button type="button" className="btn sm" onClick={onRetry}>
          Retry
        </button>
      )}
    </Banner>
  );
}

export function Loading({ label = 'Loading…', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr">{label}</span>
      <div className="grid" aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <span key={i} className="skel" style={{ width: `${90 - i * 12}%` }} />
        ))}
      </div>
      <p className="muted">{label}</p>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function ProbBar({ p, n, lowData }: { p: number; n?: number; lowData?: boolean }) {
  return (
    <span className="pmeet">
      <span className="bar" aria-hidden="true">
        <i style={{ width: `${Math.round(p * 100)}%` }} />
      </span>
      <b>{(p * 100).toFixed(0)}%</b>
      {n !== undefined && <small className="muted">n={n}</small>}
      {lowData && <Tag kind="warn">low data (n &lt; 10)</Tag>}
    </span>
  );
}

/** p10–p90 range bar with mean and dashed target line (positions in % of the axis). */
export function RangeBar({ lo, mean, hi, tgt }: { lo: number; mean: number; hi: number; tgt: number | null }) {
  const style = {
    '--lo': `${lo}%`,
    '--mean': `${mean}%`,
    '--hi': `${hi}%`,
    ...(tgt !== null ? { '--tgt': `${tgt}%` } : {}),
  } as React.CSSProperties;
  return (
    <div className="rb" style={style} aria-hidden="true">
      {tgt !== null && <i className="tgt" />}
      <i className="rng" />
      <i className="mean" />
    </div>
  );
}
