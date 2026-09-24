export function BatchStatusPill({ status }: { status: 'running' | 'succeeded' | 'failed' }) {
  const cls = status === 'succeeded' ? 'pill-ok' : status === 'failed' ? 'pill-bad' : 'pill-warn';
  const label = status === 'succeeded' ? 'Succeeded' : status === 'failed' ? 'Failed' : 'Running';
  return <span className={`pill ${cls}`}>{label}</span>;
}
