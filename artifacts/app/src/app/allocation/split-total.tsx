'use client';

import { useState } from 'react';

// Client island: updates the split percentage immediately; the server form remains usable without JS.
export function SplitTotal({
  initial,
  rows,
  children,
}: {
  initial: string[];
  rows: number;
  children: React.ReactNode;
}) {
  const [total, setTotal] = useState(initial.reduce((n, s) => n + (Number(s) || 0), 0));
  const [count, setCount] = useState(rows);
  return (
    <div
      onClick={(event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
          'button[data-add-target]',
        );
        if (!button) return;
        const tbody = event.currentTarget.querySelector('tbody');
        const last = tbody?.lastElementChild;
        if (!tbody || !last || count >= 6) return;
        event.preventDefault();
        const row = last.cloneNode(true) as HTMLElement;
        for (const input of row.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
          'input, select',
        )) {
          input.name = input.name.replace(/_[0-5]$/, `_${count}`);
          input.setAttribute(
            'aria-label',
            (input.getAttribute('aria-label') ?? '').replace(/\d+$/, String(count + 1)),
          );
          if (input instanceof HTMLSelectElement) input.selectedIndex = 0;
          else input.value = '';
        }
        tbody.appendChild(row);
        setCount(count + 1);
        if (count + 1 === 6) button.hidden = true;
      }}
      onInput={(event) => {
        const form = event.currentTarget.closest('form');
        if (form)
          setTotal(
            Array.from(form.querySelectorAll<HTMLInputElement>('input[name^="share_"]')).reduce(
              (n, input) => n + (Number(input.value) || 0),
              0,
            ),
          );
      }}
    >
      {children}
      {initial.length ? (
        <p className={Math.round(total * 100) === 10000 ? 'pill pill-ok' : 'pill pill-bad'}>
          Split total: {total.toFixed(2)}% — must equal 100%
        </p>
      ) : null}
    </div>
  );
}
