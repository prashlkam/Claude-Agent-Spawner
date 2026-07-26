'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/** Small, dependency-free primitives shared by every tab. */

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export function Field({
  label,
  hint,
  error,
  children,
  counter,
}: {
  label?: string;
  hint?: ReactNode;
  error?: string;
  counter?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      {(label || counter) && (
        <div className="flex items-baseline justify-between">
          {label && <span className="label">{label}</span>}
          {counter}
        </div>
      )}
      {children}
      {error ? (
        <p className="mt-1.5 text-[12px] text-danger-600">{error}</p>
      ) : hint ? (
        <div className="hint">{hint}</div>
      ) : null}
    </div>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx('field', props.className)} />;
}

export function TextArea({
  autoGrow = true,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { autoGrow?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!autoGrow || !ref.current) return;
    ref.current.style.height = 'auto';
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  }, [props.value, autoGrow]);

  return <textarea ref={ref} {...props} className={cx('field resize-y', props.className)} />;
}

export function Select({
  options,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select {...props} className={cx('field cursor-pointer', props.className)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
  disabledReason,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <label
      title={disabled ? disabledReason : undefined}
      className={cx(
        'flex items-start gap-3',
        disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer',
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={cx(
          'mt-0.5 h-5 w-9 shrink-0 rounded-full p-0.5 transition',
          checked ? 'bg-accent-600' : 'bg-ink-200',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        )}
      >
        <span
          className={cx(
            'block h-4 w-4 rounded-full bg-white shadow-sm transition',
            checked && 'translate-x-4',
          )}
        />
      </button>
      <span>
        <span className="block text-[13px] font-medium text-ink-800">{label}</span>
        {hint && <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-600">{hint}</span>}
      </span>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; title?: string }>;
}) {
  return (
    <div className="inline-flex rounded-md border border-ink-200 bg-white p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          onClick={() => onChange(option.value)}
          className={cx(
            'cursor-pointer rounded px-2.5 py-1 text-[12.5px] font-medium transition',
            value === option.value ? 'bg-ink-900 text-white' : 'text-ink-600 hover:text-ink-900',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Repeatable list of single-line strings — success criteria, keywords, steps. */
export function ListEditor({
  items,
  onChange,
  placeholder,
  addLabel = 'Add',
  mono,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  addLabel?: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <input
            value={item}
            placeholder={placeholder}
            onChange={(event) => {
              const next = [...items];
              next[index] = event.target.value;
              onChange(next);
            }}
            className={mono ? 'field-mono' : 'field'}
          />
          <button
            type="button"
            aria-label="Remove"
            onClick={() => onChange(items.filter((_, i) => i !== index))}
            className="btn-ghost px-2 text-ink-400 hover:text-danger-600"
          >
            ✕
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, ''])} className="btn-secondary">
        + {addLabel}
      </button>
    </div>
  );
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'accent' | 'warn' | 'danger' | 'ok';
  children: ReactNode;
}) {
  const tones = {
    neutral: 'bg-ink-100 text-ink-700',
    accent: 'bg-accent-100 text-accent-600',
    warn: 'bg-warn-100 text-warn-600',
    danger: 'bg-danger-100 text-danger-600',
    ok: 'bg-ok-600/10 text-ok-600',
  };
  return (
    <span className={cx('rounded px-1.5 py-0.5 text-[11px] font-medium', tones[tone])}>{children}</span>
  );
}

export function SlideOver({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'max-w-2xl',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-ink-950/25" onClick={onClose} />
      <div className={cx('flex w-full flex-col bg-white shadow-2xl', width)}>
        <header className="flex items-start justify-between border-b border-ink-200 px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-ink-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[12.5px] text-ink-600">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="btn-ghost px-2" aria-label="Close">
            ✕
          </button>
        </header>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <footer className="border-t border-ink-200 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
      <h3 className="text-[15px] font-semibold text-ink-900">{title}</h3>
      <p className="max-w-md text-[13px] leading-relaxed text-ink-600">{body}</p>
      {action}
    </div>
  );
}

export function Accordion({
  title,
  description,
  defaultOpen = false,
  children,
  right,
}: {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: ReactNode;
  right?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center justify-between px-4 py-3 text-left hover:bg-ink-50"
      >
        <span>
          <span className="section-title">{title}</span>
          {description && <span className="mt-0.5 block text-[12.5px] text-ink-600">{description}</span>}
        </span>
        <span className="flex items-center gap-3">
          {right}
          <span className={cx('text-ink-400 transition', open && 'rotate-90')}>›</span>
        </span>
      </button>
      {open && <div className="space-y-5 border-t border-ink-200 px-4 py-5">{children}</div>}
    </section>
  );
}

/** Character counter that turns red past a hard limit. */
export function Counter({ value, limit }: { value: number; limit: number }) {
  const over = value > limit;
  return (
    <span
      className={cx(
        'text-[11px] tabular-nums',
        over ? 'font-medium text-danger-600' : value > limit * 0.85 ? 'text-warn-600' : 'text-ink-400',
      )}
    >
      {value.toLocaleString()} / {limit.toLocaleString()}
    </span>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn-secondary"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

/** Multi-select rendered as toggleable chips — used for tools, agents, workflows. */
export function ChipSelect({
  options,
  selected,
  onChange,
  emptyLabel = 'Nothing to choose from yet.',
}: {
  options: Array<{ value: string; label: string; title?: string; disabled?: boolean }>;
  selected: string[];
  onChange: (values: string[]) => void;
  emptyLabel?: string;
}) {
  if (options.length === 0) return <p className="text-[12.5px] text-ink-600">{emptyLabel}</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const on = selected.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            title={option.title}
            disabled={option.disabled}
            onClick={() =>
              onChange(on ? selected.filter((v) => v !== option.value) : [...selected, option.value])
            }
            className={cx(
              'cursor-pointer rounded-full border px-2.5 py-1 text-[12px] transition disabled:cursor-not-allowed disabled:opacity-50',
              on
                ? 'border-accent-600 bg-accent-600 text-white'
                : 'border-ink-200 bg-white text-ink-700 hover:border-ink-400',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
