'use client';

import React, { useState } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  reveal?: boolean;
}

export default function Input({ label, error, className = '', reveal = false, type, ...props }: InputProps) {
  const [visible, setVisible] = useState(false);
  const canReveal = reveal && type === 'password';
  const inputType = canReveal && visible ? 'text' : type;

  return (
    <div className="w-full space-y-1">
      {label && (
        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          type={inputType}
          className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition ${
            canReveal ? 'pr-16' : ''
          } ${error ? 'border-rose-500 focus:border-rose-500' : ''} ${className}`}
          {...props}
        />
        {canReveal && (
          <button
            type="button"
            onClick={() => setVisible((current) => !current)}
            aria-pressed={visible}
            aria-label={visible ? 'Hide password' : 'Show password'}
            className="absolute inset-y-0 right-2 flex items-center text-xs font-medium text-slate-400 hover:text-slate-200"
          >
            {visible ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-rose-400 mt-1">{error}</p>}
    </div>
  );
}