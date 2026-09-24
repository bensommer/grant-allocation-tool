'use client';

import { useState } from 'react';

export function SplitTotal({
  initial,
  children,
}: {
  initial: string[];
  children: React.ReactNode;
}) {
  const [total, setTotal] = useState(initial.reduce((n, s) => n + (Number(s) || 0), 0));
  return (
    <div
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
      <p className={Math.round(total * 100) === 10000 ? 'pill pill-ok' : 'pill pill-bad'}>
        Split total: {total.toFixed(2)}% — must equal 100%
      </p>
    </div>
  );
}
