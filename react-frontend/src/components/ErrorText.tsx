import type { ShownError } from '../utils/shownError';

/** Renders an operator message with an expandable "Technical details" section. */
export function ErrorText({ error, className = '' }: { error: ShownError; className?: string }) {
  const hasDetails = Boolean(error.detail || error.ref || error.code);
  return (
    <span className={`flex flex-col gap-0.5 ${className}`}>
      <span className="text-red wrap-break-word">{error.message}</span>
      {hasDetails && (
        <details className="text-[0.65rem] text-muted">
          <summary className="cursor-pointer select-none hover:text-text">Technical details</summary>
          <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5">
            {error.code && (<><dt>Code</dt><dd className="font-mono break-all">{error.code}</dd></>)}
            {error.detail && (<><dt>Cause</dt><dd className="font-mono break-all">{error.detail}</dd></>)}
            {error.ref && (<><dt>Log reference</dt><dd className="font-mono">{error.ref}</dd></>)}
          </dl>
        </details>
      )}
    </span>
  );
}
