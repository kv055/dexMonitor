import { Component, Suspense, type ReactNode } from 'react';
import { LoadingSpinner } from './LoadingSpinner';
import { isChunkLoadError, shouldReloadForChunkError } from '../utils/chunkErrors';

interface ErrorBoundaryProps {
  viewName: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// ErrorBoundary keeps one failing lazy view from unmounting the whole
// dashboard. Chunk-load failures (stale tab + new deploy) offer a reload;
// anything else offers a retry.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error): void {
    console.error(`[${this.props.viewName}] view error`, error);
    if (isChunkLoadError(error) && shouldReloadForChunkError()) {
      window.location.reload();
    }
  }

  private handleRetry = (): void => {
    this.setState({ error: null });
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;

    const chunkError = isChunkLoadError(error);
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface p-6 text-center">
        <h2 className="text-sm font-semibold text-text">
          {chunkError ? 'A new version was deployed' : `Couldn't load the ${this.props.viewName} view`}
        </h2>
        <p className="max-w-md text-xs text-muted">
          {chunkError
            ? 'This tab is running an older build whose files are no longer on the server. Reload to pick up the latest version.'
            : error.message}
        </p>
        {chunkError ? (
          <button
            type="button"
            onClick={this.handleReload}
            className="mt-1 rounded-md border border-border bg-bg px-3 py-1.5 text-xs font-medium text-text hover:bg-surface"
          >
            Reload
          </button>
        ) : (
          <button
            type="button"
            onClick={this.handleRetry}
            className="mt-1 rounded-md border border-border bg-bg px-3 py-1.5 text-xs font-medium text-text hover:bg-surface"
          >
            Try again
          </button>
        )}
      </div>
    );
  }
}

// LazyView pairs a React.Suspense loading state with an ErrorBoundary so every
// code-split view degrades to a reload/retry card instead of a blank page.
export function LazyView({ view, label, children }: { view: string; label: string; children: ReactNode }) {
  return (
    <ErrorBoundary viewName={view}>
      <Suspense
        fallback={
          <div className="relative min-h-40 flex-1">
            <LoadingSpinner label={label} />
          </div>
        }
      >
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}
