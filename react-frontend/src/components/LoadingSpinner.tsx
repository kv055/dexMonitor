import { usePreferences } from '../hooks/usePreferences';

interface Props {
  /** Target size in px; clamped down when the container is smaller. */
  size?: number;
  label?: string;
}

const LABEL_RESERVE = '1.75rem';

export function LoadingSpinner({ size = 96, label = 'Loading…' }: Props) {
  const { theme } = usePreferences();
  const src = theme === 'dark' ? '/brand/spinner-dark.svg' : '/brand/spinner-light.svg';
  const labelOffset = label ? LABEL_RESERVE : '0px';

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 z-10 p-3 box-border">
      <img
        src={src}
        alt=""
        aria-hidden
        className="min-h-0 min-w-0 shrink object-contain"
        style={{
          width: `min(${size}px, 100%)`,
          height: `min(${size}px, calc(100% - ${labelOffset}))`,
          maxWidth: '100%',
          maxHeight: label ? `calc(100% - ${labelOffset})` : '100%',
        }}
      />
      {label && (
        <span
          className="shrink-0 text-[0.6rem] uppercase tracking-widest text-center"
          style={{ color: 'var(--color-muted)', animation: 'dex-pulse-label 2s ease-in-out infinite' }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
