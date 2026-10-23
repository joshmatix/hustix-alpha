'use client';

import { useEffect, useId, useRef, useState } from 'react';

export type ClientAccountOption = {
  id: string;
  label: string;
};

interface ClientAccountSelectProps {
  id?: string;
  accounts: ClientAccountOption[];
  excludedIds: Set<string>;
  onToggle: (accountId: string) => void;
  onToggleAll: () => void;
}

export function clientAccountKey(accountNumber?: string | null) {
  return (accountNumber || '').trim();
}

export function clientAccountLabel(accountNumber: string) {
  return accountNumber || 'No Client Master ID';
}

function selectionLabel(accounts: ClientAccountOption[], excludedIds: Set<string>) {
  if (accounts.length === 0) return 'All clients';
  const selected = accounts.filter((account) => !excludedIds.has(account.id));
  if (selected.length === accounts.length) return 'All clients';
  if (selected.length === 0) return 'No clients';
  if (selected.length === 1) return selected[0].label;
  return `${selected.length} clients`;
}

export default function ClientAccountSelect({
  id,
  accounts,
  excludedIds,
  onToggle,
  onToggleAll,
}: ClientAccountSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const allRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const selectedCount = accounts.filter((account) => !excludedIds.has(account.id)).length;
  const allSelected = accounts.length === 0 || selectedCount === accounts.length;
  const noneSelected = accounts.length > 0 && selectedCount === 0;
  const label = selectionLabel(accounts, excludedIds);

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = !allSelected && !noneSelected;
  }, [allSelected, noneSelected, open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative w-full max-w-xs">
      <button
        id={id}
        type="button"
        aria-label={`Client, ${label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-left text-sm focus:border-indigo-500 focus:outline-none"
      >
        <span className="truncate text-slate-100">{label}</span>
        <span aria-hidden="true" className="ml-3 text-slate-500">▾</span>
      </button>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          aria-label="Clients by Client Master ID"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border border-slate-700 bg-slate-950 py-1 shadow-lg"
        >
          <li role="option" aria-selected={allSelected}>
            <label
              className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${
                allSelected ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <input
                ref={allRef}
                type="checkbox"
                checked={allSelected}
                onChange={onToggleAll}
                className="h-4 w-4 accent-indigo-500"
              />
              All clients
            </label>
          </li>
          {accounts.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500">No Client Master IDs yet.</li>
          ) : (
            accounts.map((account) => {
              const checked = !excludedIds.has(account.id);
              return (
                <li key={account.id || 'unassigned'} role="option" aria-selected={checked}>
                  <label
                    className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${
                      checked ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(account.id)}
                      className="h-4 w-4 accent-indigo-500"
                    />
                    <span className="truncate">{account.label}</span>
                  </label>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
