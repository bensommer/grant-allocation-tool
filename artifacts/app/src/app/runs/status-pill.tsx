import type { RunStatus } from '@/generated/prisma/client';

export function RunStatusPill({ status }: { status: RunStatus }) {
  const cls =
    status === 'succeeded'
      ? 'pill-ok'
      : status === 'failed'
        ? 'pill-bad'
        : status === 'superseded'
          ? 'pill-muted'
          : 'pill-warn';
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return <span className={`pill ${cls}`}>{label}</span>;
}
