interface Props {
  size?: number;
  label?: string;
}

export function LoadingSpinner({ size = 32, label = 'Loading…' }: Props) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 z-10">
      <div className="dex-spinner" style={{ width: size, height: size }} />
      {label && (
        <span
          className="text-[0.6rem] uppercase tracking-widest"
          style={{ color: 'var(--color-muted)', animation: 'dex-pulse-label 2s ease-in-out infinite' }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
