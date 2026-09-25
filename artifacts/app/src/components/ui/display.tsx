import type { ReactNode } from 'react';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatMonth,
  formatPct,
  formatPeriod,
  type YearMonth,
} from '@/domain/format';

export function Money({
  cents,
  dollar,
  zero,
  className = '',
  'data-testid': testId,
}: {
  cents: number;
  dollar?: boolean;
  zero?: 'dash' | 'zero';
  className?: string;
  'data-testid'?: string;
}) {
  return (
    <span
      className={`num${cents < 0 ? ' negative' : ''} ${className}`}
      data-cents={cents}
      data-testid={testId}
    >
      {formatMoney(cents, { dollar, zero })}
    </span>
  );
}

export function Period({ from, to }: { from: Date; to: Date }) {
  return <span>{formatPeriod(from, to)}</span>;
}

export function Month({
  ym,
  year,
  context,
}: {
  ym: YearMonth;
  year?: 'auto' | 'always' | 'never';
  context?: YearMonth[];
}) {
  return <span>{formatMonth(ym, { year }, context)}</span>;
}

/** basisPoints: 10000 = 100%; for ratio input use formatPct1 first. */
export function Pct({ basisPoints }: { basisPoints: number }) {
  return <span className="num">{formatPct(basisPoints)}</span>;
}

export function DateText({ date, time = false }: { date: Date; time?: boolean }) {
  return (
    <time dateTime={date.toISOString()} data-volatile={time ? true : undefined}>
      {time ? formatDateTime(date) : formatDate(date)}
    </time>
  );
}

export type Tone = 'ok' | 'warn' | 'bad' | 'muted' | 'info';
const glyphs: Record<Tone, string> = { ok: '✓', warn: '!', bad: '×', muted: '•', info: 'i' };
export function StatusPill({
  tone,
  children,
  icon,
}: {
  tone: Tone;
  children: ReactNode;
  icon?: string;
}) {
  return (
    <span className={`pill pill-${tone}`}>
      <span aria-hidden="true">{icon ?? glyphs[tone]}</span> {children}
    </span>
  );
}

export function ProgressBar({
  used,
  budget,
  label = 'Budget used',
}: {
  used: number;
  budget: number;
  label?: string;
}) {
  const pct = budget > 0 ? (used / budget) * 100 : 0;
  const display = Math.round(pct);
  return (
    <div className={`progress ${pct > 100 ? 'progress-over' : ''}`}>
      <div
        className="progress-track"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.max(100, display)}
        aria-valuenow={Math.max(0, display)}
        aria-valuetext={`${display}% of budget used`}
      >
        <div className="progress-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
      <span className="num">{display}%</span>
      <span className="sr-only">
        {formatMoney(used, { dollar: true, zero: 'zero' })} used of{' '}
        {formatMoney(budget, { dollar: true, zero: 'zero' })} budget
        {pct > 100 ? '; over budget' : ''}
      </span>
    </div>
  );
}

export function Legend({ items }: { items: { tone: Tone; label: string }[] }) {
  return (
    <div className="legend" aria-label="Legend">
      {items.map((item) => (
        <StatusPill key={`${item.tone}-${item.label}`} tone={item.tone}>
          {item.label}
        </StatusPill>
      ))}
    </div>
  );
}

/** Superscript marker pointing at a `Footnote` under the table. */
export function FootnoteMark({ id, mark = '¹' }: { id: string; mark?: string }) {
  return (
    <sup className="footnote-mark">
      <a href={`#${id}`} aria-label={`Footnote ${mark}`}>
        {mark}
      </a>
    </sup>
  );
}

export function Footnote({
  id,
  mark = '¹',
  children,
}: {
  id: string;
  mark?: string;
  children: ReactNode;
}) {
  return (
    <p id={id} className="footnote muted">
      <sup>{mark}</sup> {children}
    </p>
  );
}

/**
 * Two thin bars on one scale — time elapsed and share spent — so pace reads at a
 * glance without a colour alarm. Percentages are basis points.
 */
export function PairedBar({
  rows,
  tone = 'neutral',
}: {
  rows: Array<{ label: string; bps: number }>;
  tone?: 'neutral' | 'warn';
}) {
  return (
    <div className={`paired-bar paired-bar-${tone}`} aria-hidden="true">
      {rows.map((r) => (
        <div key={r.label} className="paired-bar-row">
          <span className="paired-bar-label">{r.label}</span>
          <span className="paired-bar-track">
            <span
              className="paired-bar-fill"
              style={{ width: `${Math.max(0, Math.min(100, r.bps / 100))}%` }}
            />
          </span>
        </div>
      ))}
    </div>
  );
}
