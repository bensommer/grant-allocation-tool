'use client';

/**
 * The one client island of the review queue (JPH-27 C3): keyboard shortcuts and select-all.
 * Everything it touches is server-rendered and works without it — the shortcuts submit the
 * row's own forms and the group checkbox ticks the row checkboxes that already post.
 *
 *   J / K  move focus down / up the rows
 *   A      Accept the focused row's suggestion
 *   C      open Change on the focused row
 *   X      open Not grant-funded on the focused row
 */
import { useEffect } from 'react';

const ROW = 'tr[data-row-id]';
const FOCUS_CLASS = 'row-focus';

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'SELECT' ||
    tag === 'TEXTAREA' ||
    tag === 'BUTTON' ||
    target.isContentEditable
  );
}

function rows(root: HTMLElement): HTMLTableRowElement[] {
  return [...root.querySelectorAll<HTMLTableRowElement>(ROW)];
}

function focusRow(root: HTMLElement, row: HTMLTableRowElement) {
  for (const r of rows(root)) r.classList.toggle(FOCUS_CLASS, r === row);
  row.tabIndex = -1;
  row.focus({ preventScroll: false });
  row.scrollIntoView({ block: 'nearest' });
}

function focusedRow(root: HTMLElement): HTMLTableRowElement | null {
  const active = document.activeElement?.closest<HTMLTableRowElement>(ROW) ?? null;
  return active ?? root.querySelector<HTMLTableRowElement>(`${ROW}.${FOCUS_CLASS}`);
}

function openDetails(row: HTMLTableRowElement, action: string) {
  const details = row.querySelector<HTMLDetailsElement>(`details[data-action="${action}"]`);
  if (!details) return;
  details.open = true;
  details.querySelector<HTMLElement>('select, input:not([type=hidden]), textarea')?.focus();
}

function syncBulk(root: HTMLElement) {
  const boxes = [...root.querySelectorAll<HTMLInputElement>('input[name="rows"]')];
  const count = boxes.filter((b) => b.checked).length;
  for (const el of document.querySelectorAll<HTMLElement>('[data-bulk-count]'))
    el.textContent = String(count);
  for (const group of root.querySelectorAll<HTMLInputElement>('input[data-select-group]')) {
    const key = group.dataset.selectGroup!;
    const mine = boxes.filter((b) => b.dataset.group === key);
    const checked = mine.filter((b) => b.checked).length;
    // Only a fully ticked group posts as a group; a partial one posts its rows.
    group.checked = mine.length > 0 && checked === mine.length;
    group.indeterminate = checked > 0 && checked < mine.length;
  }
}

export function QueueIsland({ rootId }: { rootId: string }) {
  useEffect(() => {
    const root = document.getElementById(rootId);
    if (!root) return;
    root.dataset.island = 'ready';

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return;
      const key = e.key.toLowerCase();
      if (!['j', 'k', 'a', 'c', 'x'].includes(key)) return;
      const all = rows(root);
      if (all.length === 0) return;
      const current = focusedRow(root);
      const index = current ? all.indexOf(current) : -1;
      if (key === 'j' || key === 'k') {
        const next =
          index === -1
            ? all[0]!
            : all[Math.min(all.length - 1, Math.max(0, index + (key === 'j' ? 1 : -1)))]!;
        focusRow(root, next);
        e.preventDefault();
        return;
      }
      if (!current) return;
      e.preventDefault();
      if (key === 'a') {
        const form = current.querySelector<HTMLFormElement>('form[data-action="accept"]');
        form?.requestSubmit();
      } else if (key === 'c') openDetails(current, 'change');
      else openDetails(current, 'exclude');
    };

    const onChange = (e: Event) => {
      const target = e.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.dataset.selectGroup !== undefined) {
        const key = target.dataset.selectGroup;
        for (const box of root.querySelectorAll<HTMLInputElement>(
          `input[name="rows"][data-group="${CSS.escape(key)}"]`,
        ))
          box.checked = target.checked;
      } else if (target.name !== 'rows') return;
      syncBulk(root);
    };

    document.addEventListener('keydown', onKey);
    root.addEventListener('change', onChange);
    syncBulk(root);
    // The first row starts as the current one, so J goes to the second row and A acts on it.
    if (!focusedRow(root)) rows(root)[0]?.classList.add(FOCUS_CLASS);
    return () => {
      document.removeEventListener('keydown', onKey);
      root.removeEventListener('change', onChange);
    };
  }, [rootId]);
  return null;
}
