import { type ReactNode } from 'react';

const iconBtnCls =
  'inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted transition hover:border-border hover:bg-bg hover:text-text disabled:cursor-not-allowed disabled:opacity-50';

export function EyeIcon({ off = false }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.75" />
      {off ? <line x1="4" y1="4" x2="20" y2="20" /> : null}
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function SecretField({
  value,
  hasValue = true,
  visible,
  revealing = false,
  onToggle,
  copyable = false,
}: {
  value?: string | null;
  hasValue?: boolean;
  visible: boolean;
  revealing?: boolean;
  onToggle: () => void;
  copyable?: boolean;
}) {
  if (!hasValue) {
    return <span className="font-mono text-muted">—</span>;
  }
  const shown = visible ? value ?? '…' : '••••••••';
  const copy = () => {
    if (value) void navigator.clipboard?.writeText(value);
  };
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span className="min-w-0 break-all text-right font-mono text-text">{shown}</span>
      {copyable ? (
        <button
          type="button"
          className={iconBtnCls}
          title={visible ? 'Copy value' : 'Reveal to copy'}
          aria-label={visible ? 'Copy value' : 'Reveal to copy'}
          disabled={!visible || !value}
          onClick={copy}
        >
          <CopyIcon />
        </button>
      ) : null}
      <button
        type="button"
        className={iconBtnCls}
        title={visible ? 'Hide value' : 'Show value'}
        aria-label={visible ? 'Hide value' : 'Show value'}
        onClick={onToggle}
        disabled={revealing}
      >
        <EyeIcon off={visible} />
      </button>
    </span>
  );
}

export function StatTile({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  tone?: 'default' | 'good' | 'bad';
}) {
  const toneCls = tone === 'good' ? 'text-green' : tone === 'bad' ? 'text-red' : 'text-text';
  return (
    <div className="rounded-lg border border-border bg-surface px-2.5 py-2">
      <div className="text-[0.6rem] font-medium uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 break-words text-sm font-semibold leading-snug ${toneCls}`}>{value}</div>
    </div>
  );
}

export function InfoRowList({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-border bg-surface px-3 py-1">{children}</div>;
}

export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/40 py-2 last:border-b-0">
      <span className="shrink-0 text-[0.68rem] text-muted">{label}</span>
      <span className="min-w-0 text-xs text-text">{children}</span>
    </div>
  );
}

export type DetailTab = {
  id: string;
  label: string;
  content: ReactNode;
};

export function DetailTabsBar({
  tabs,
  activeId,
  onSelect,
}: {
  tabs: DetailTab[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex shrink-0 gap-0.5 overflow-x-auto rounded-lg border border-border bg-bg p-0.5">
      {tabs.map(tab => {
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            data-testid={`account-detail-tab-${tab.id}`}
            aria-current={active ? 'page' : undefined}
            className={`min-w-0 shrink-0 rounded-md px-2.5 py-1 text-[0.7rem] font-medium transition ${
              active ? 'bg-accent/10 text-accent shadow-sm' : 'text-muted hover:bg-surface hover:text-text'
            }`}
            onClick={() => onSelect(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

const sectionStateActionCls =
  'rounded-md border border-border bg-bg px-2 py-0.5 text-[0.68rem] font-medium text-muted transition hover:bg-surface hover:text-text disabled:cursor-not-allowed disabled:opacity-50';

export function SectionState({
  loading,
  error,
  emptyMessage,
  hasData,
  onRetry,
}: {
  loading: boolean;
  error?: string | null;
  emptyMessage: string;
  hasData: boolean;
  onRetry?: () => void;
}) {
  if (loading && !hasData) {
    return (
      <div className="flex items-center gap-2 px-1 py-1 text-xs text-muted" role="status">
        <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-border border-t-accent" aria-hidden="true" />
        Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-wrap items-center gap-2 px-1 py-1">
        <span className="min-w-0 break-words text-xs text-red">{error}</span>
        {onRetry ? (
          <button type="button" className={sectionStateActionCls} onClick={onRetry}>
            Retry
          </button>
        ) : null}
      </div>
    );
  }
  if (!hasData) {
    return (
      <div className="flex flex-wrap items-center gap-2 px-1 py-1">
        <span className="text-xs text-muted">{emptyMessage}</span>
        {onRetry ? (
          <button type="button" className={sectionStateActionCls} onClick={onRetry}>
            Refresh
          </button>
        ) : null}
      </div>
    );
  }
  return null;
}

export function CollapsibleSection({
  title,
  count,
  summary,
  warn = false,
  open,
  onToggle,
  actions,
  children,
}: {
  title: string;
  count?: number;
  summary?: string;
  warn?: boolean;
  open: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left transition hover:bg-bg/60"
          onClick={onToggle}
          aria-expanded={open}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`h-3 w-3 shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`}
            aria-hidden="true"
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
          <span className="truncate text-xs font-semibold text-text">{title}</span>
          {count != null ? (
            <span className="rounded-full border border-border px-1.5 py-0 text-[0.6rem] text-muted">{count}</span>
          ) : null}
          {warn ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red" aria-label="Attention needed" /> : null}
          {!open && summary ? (
            <span className="ml-auto min-w-0 truncate pl-2 text-[0.65rem] text-muted">{summary}</span>
          ) : null}
        </button>
        {actions ? <div className="flex shrink-0 items-center gap-1 pr-2">{actions}</div> : null}
      </div>
      {open ? <div className="grid gap-2 border-t border-border px-3 py-2.5">{children}</div> : null}
    </div>
  );
}
