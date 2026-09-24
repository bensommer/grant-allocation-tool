import { formatMoney } from '@/domain/format';

export function MiniBarChart({
  points,
  caption,
}: {
  points: { label: string; cents: number }[];
  caption: string;
}) {
  const max = Math.max(1, ...points.map((point) => Math.abs(point.cents)));
  const width = Math.max(320, points.length * 66 + 40);
  const zeroY = 120;
  return (
    <svg className="mini-bar-chart" viewBox={`0 0 ${width} 190`} role="img" aria-label={caption}>
      <title>{caption}</title>
      <desc>
        {points
          .map((p) => `${p.label}: ${formatMoney(p.cents, { dollar: true, zero: 'zero' })}`)
          .join('; ') || 'No data'}
      </desc>
      <line x1="30" y1={zeroY} x2={width - 10} y2={zeroY} stroke="currentColor" />
      <text x="2" y="12" fontSize="10">
        {formatMoney(max, { dollar: true })}
      </text>
      <text x="2" y={zeroY} fontSize="10">
        0
      </text>
      {points.map((point, i) => {
        const height = Math.round((Math.abs(point.cents) / max) * 88);
        const x = 38 + i * 66;
        return (
          <g key={`${point.label}-${i}`}>
            <rect
              x={x}
              y={point.cents >= 0 ? zeroY - height : zeroY}
              width="30"
              height={height}
              fill={point.cents < 0 ? 'var(--color-bad)' : 'var(--color-harbor)'}
            />
            <text
              x={x + 15}
              y={point.cents >= 0 ? zeroY - height - 5 : zeroY + height + 13}
              textAnchor="middle"
              fontSize="9"
            >
              {formatMoney(point.cents, { zero: 'zero' })}
            </text>
            <text x={x + 15} y="172" textAnchor="middle" fontSize="10">
              {point.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
