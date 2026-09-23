export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="muted mt-1">{subtitle}</p> : null}
      </div>
      {actions ? <div className="no-print flex gap-2">{actions}</div> : null}
    </div>
  );
}
