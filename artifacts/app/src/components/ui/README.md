# Shared UI kit

Import from `@/components/ui`. All exports are server components except none of this kit require client JS. Native GET/POST forms and links work without JavaScript. Use `PageHeader` from this kit for new pages; the old `@/components/page-header` import still accepts `actions` and maps it to `secondaryActions`.

| Export                 | Props                                                                                                                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Money`                | `cents: number`, `dollar?: boolean`, `zero?: 'dash' \| 'zero'`, `className?: string`. Span with `.num`, `data-cents`, and `.negative` when negative. Default zero is `—`.                                                                     |
| `Period`               | `from: Date`, `to: Date` (UTC).                                                                                                                                                                                                               |
| `Month`                | `ym: YearMonth`, `year?: 'auto' \| 'always' \| 'never'`, `context?: YearMonth[]`. `auto` adds the year when context spans years.                                                                                                              |
| `Pct`                  | `basisPoints: number` (10,000 = 100%).                                                                                                                                                                                                        |
| `DateText`             | `date: Date`, `time?: boolean` for UTC timestamp.                                                                                                                                                                                             |
| `StatusPill`           | `tone: Tone`, `children: ReactNode`, `icon?: string`. Every pill includes an icon and text. `Tone = 'ok' \| 'warn' \| 'bad' \| 'muted' \| 'info'`.                                                                                            |
| `Button`, `ButtonLink` | Native button / Next link props, `variant?: ButtonVariant = 'primary'` (`primary`, `secondary`, `ghost`, `danger`), `size?: ButtonSize = 'md'` (`sm`, `md`). Buttons default to `type="submit"`. ButtonLink requires `href`.                  |
| `Card`                 | `title?: ReactNode`, `action?: ReactNode`, `children: ReactNode`.                                                                                                                                                                             |
| `KeyFigure`            | `label: string`, `value: ReactNode`, `hint?: ReactNode`, `tone?: Tone`.                                                                                                                                                                       |
| `PageHeader`           | `title: string`, `subtitle?: ReactNode`, `primaryAction?: ReactNode`, `secondaryActions?: ReactNode`, `breadcrumb?: ReactNode`. Destructive controls do **not** belong here.                                                                  |
| `DataTable`            | `caption?: string`, `stickyFirstColumn?: boolean`, `children: ReactNode`. Wraps table in horizontal scroll and keeps header sticky.                                                                                                           |
| `Th`                   | Standard `<th>` props plus `num?: boolean`. Requires visible children or `aria-label`; do not emit empty headers.                                                                                                                             |
| `Td`                   | Standard `<td>` props.                                                                                                                                                                                                                        |
| `NumTd`                | Standard `<td>` props and **either** `cents: number` (with optional `dollar?: boolean`) **or** `children: ReactNode`. `cents` renders `Money` and carries `data-cents` on the cell.                                                           |
| `TotalRow`             | Standard `<tr>` props; distinct top border and bold text. Pass `dollar` to total-row `NumTd`.                                                                                                                                                 |
| `LinkCell`             | Next Link props with `href: string`, `children: ReactNode`; consistent underlined drill link.                                                                                                                                                 |
| `FilterBar`            | `children: ReactNode`, `action?: string`, `submitLabel?: string = 'Apply'`. GET form; pass hidden inputs as children.                                                                                                                         |
| `ProgressBar`          | `used: number`, `budget: number`, `label?: string`; accepts cents and announces both amounts for screen readers.                                                                                                                              |
| `EmptyState`           | `title: string`, `hint?: ReactNode`, `action?: ReactNode`.                                                                                                                                                                                    |
| `Legend`               | `items: { tone: Tone; label: string }[]`.                                                                                                                                                                                                     |
| `Banner`               | `tone: Tone`, `children: ReactNode`.                                                                                                                                                                                                          |
| `Toolbar`              | `children: ReactNode`; above tables for export/save actions.                                                                                                                                                                                  |
| `DangerZone`           | `title?: string = 'Danger zone'`, `children: ReactNode`; place last on a detail page.                                                                                                                                                         |
| `ConfirmPage`          | `entityName: string`, `description: string`, `cancelHref: string`, `action: (formData: FormData) => void \| Promise<void>`, `submitLabel?: string`, `children?: ReactNode`. Server-rendered GET page with native POST action and Cancel link. |
| `MiniBarChart`         | `points: { label: string; cents: number }[]`, `caption: string`. Accessible, server-rendered monthly SVG; pass ordered months.                                                                                                                |

Formatter signatures (`@/domain/format`):

```ts
formatMoney(cents: number, opts?: { dollar?: boolean; zero?: 'dash' | 'zero' }): string
formatPeriod(from: Date, to: Date): string
formatMonth(ym: YearMonth, opts?: { year?: 'auto' | 'always' | 'never' }, context?: YearMonth[]): string
formatPct(basisPoints: number): string // 10,000 bps = 100%; one decimal, half away from zero
formatDate(d: Date): string
formatDateTime(d: Date): string
```

`formatPct1(numerator, denominator)` in `@/domain/money` remains available for ratios and returns `–` on a zero denominator. `formatCents` remains available for non-UI legacy use, but use `Money` for rendered money so values retain `data-cents`. Dates use UTC. Monetary values are cents; formatting fractional cent inputs rounds ties away from zero.

```tsx
import { Button, ButtonLink, Card, DataTable, FilterBar, Money, NumTd, PageHeader, StatusPill, Th, TotalRow, DangerZone } from '@/components/ui';

<PageHeader title="Grants" primaryAction={<ButtonLink href="/grants/new">New grant</ButtonLink>} />
<FilterBar action="/grants"><input name="q" aria-label="Search grants" /><Button variant="secondary" type="reset">Clear</Button></FilterBar>
<Card title="Award" action={<StatusPill tone="ok">On track</StatusPill>}><Money cents={123456} dollar /></Card>
<DataTable caption="Spending" stickyFirstColumn><thead><tr><Th>Grant</Th><Th num>Actual ($)</Th></tr></thead><tbody><TotalRow><Th scope="row">Total</Th><NumTd cents={123456} dollar /></TotalRow></tbody></DataTable>
<DangerZone><ButtonLink href="/grants/123/delete" variant="danger">Delete / archive…</ButtonLink></DangerZone>
```

Confirm pattern: a detail page links from its bottom `DangerZone` to `/entity/[id]/delete`. That GET route checks the entity belongs to the org, then renders `ConfirmPage` with an existing server delete/archive action bound to the ID. Only the POST form executes the action. Grants and programs are implemented as examples. Keep destructive controls out of headers. `FilterBar` includes exactly one Apply submit button: do not add other submit controls inside it.
