'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { formatCents, parseMoneyToCents } from '@/domain/money';

/**
 * Client island for the budget lines editor (JPH-25 A9). The server renders the whole form;
 * this only (1) marks rows whose inputs differ from what was loaded (dot + tint) and counts
 * them next to the sticky Save button, (2) keeps the working total and the award chip live
 * as budgets are typed, and (3) writes integer cents into each row's hidden `budgetCents`
 * on submit. Without JS the form still posts the decimal text and the server parses it.
 */
export function BudgetLinesIsland({
  formId,
  awardCents,
  children,
}: {
  formId: string;
  awardCents: number;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    const form = document.getElementById(formId);
    if (!el || !(form instanceof HTMLFormElement)) return;
    const rows = () => [...el.querySelectorAll<HTMLTableRowElement>('tr[data-line-id]')];
    const fields = (row: HTMLElement) =>
      [...row.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')].filter(
        (f) => f.type !== 'hidden',
      );
    const initial = (f: HTMLInputElement | HTMLSelectElement) =>
      f instanceof HTMLSelectElement
        ? ([...f.options].find((o) => o.defaultSelected) ?? f.options[0])?.value
        : f.defaultValue;
    const centsOf = (input: HTMLInputElement) => {
      try {
        return parseMoneyToCents(input.value);
      } catch {
        return null;
      }
    };

    const total = el.querySelector<HTMLElement>('[data-testid="working-total"]');
    const chip = el.querySelector<HTMLElement>('[data-testid="award-chip"]');
    const counter = el.querySelector<HTMLElement>('[data-dirty-count]');
    const baseTotal = Number(total?.dataset.cents ?? 'NaN');

    const refresh = () => {
      let dirty = 0;
      let delta = 0;
      for (const row of rows()) {
        const changed = fields(row).some((f) => f.value !== initial(f));
        row.toggleAttribute('data-dirty', changed);
        if (changed) dirty++;
        const budget = row.querySelector<HTMLInputElement>('input[name="budget"]');
        if (budget && row.dataset.kind !== 'funder_category') {
          const cents = centsOf(budget);
          const original = Number(budget.dataset.originalCents ?? '0');
          if (cents !== null) delta += cents - original;
        }
      }
      if (counter)
        counter.textContent =
          dirty === 0 ? 'No unsaved changes' : `${dirty} unsaved row${dirty === 1 ? '' : 's'}`;
      el.toggleAttribute('data-has-dirty', dirty > 0);
      if (total && chip && Number.isFinite(baseTotal)) {
        const live = baseTotal + delta;
        total.textContent = formatCents(live);
        total.dataset.cents = String(live);
        const diff = live - awardCents;
        chip.className = `pill ${diff === 0 ? 'pill-ok' : 'pill-warn'} ml-2`;
        chip.textContent =
          diff === 0
            ? 'matches award'
            : `${diff > 0 ? 'over' : 'under'} award by ${formatCents(Math.abs(diff))}`;
      }
    };

    const onSubmit = () => {
      for (const row of rows()) {
        const budget = row.querySelector<HTMLInputElement>('input[name="budget"]');
        const hidden = row.querySelector<HTMLInputElement>('input[name="budgetCents"]');
        if (!budget || !hidden) continue;
        const cents = centsOf(budget);
        hidden.value = cents === null ? '' : String(cents);
      }
    };

    el.addEventListener('input', refresh);
    el.addEventListener('change', refresh);
    form.addEventListener('submit', onSubmit);
    refresh();
    return () => {
      el.removeEventListener('input', refresh);
      el.removeEventListener('change', refresh);
      form.removeEventListener('submit', onSubmit);
    };
  }, [formId, awardCents]);

  return <div ref={root}>{children}</div>;
}
