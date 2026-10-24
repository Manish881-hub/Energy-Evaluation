import { AlertIcon, RefreshIcon } from "./Icons.jsx";

export function LoadingState({ label = "Loading data", compact = false }) {
  if (compact) {
    return (
      <div className="loading-inline" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        {label}
      </div>
    );
  }
  return (
    <div className="skeleton-grid" role="status" aria-live="polite" aria-label={label}>
      {[0, 1, 2, 3].map((item) => (
        <div className="skeleton-card" key={item}>
          <span className="skeleton-line short" />
          <span className="skeleton-line" />
          <span className="skeleton-line faint" />
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="notice error" role="alert">
      <div className="notice-icon">
        <AlertIcon />
      </div>
      <div>
        <strong>Could not load the snapshot</strong>
        <p>{error?.message || "Unknown error"}</p>
        {onRetry && (
          <button className="button small" type="button" onClick={onRetry}>
            <RefreshIcon width={16} height={16} /> Retry
          </button>
        )}
      </div>
    </div>
  );
}

export default function Status({ state, compact = false, onRetry }) {
  if (state.error) return <ErrorState error={state.error} onRetry={onRetry || state.reload} />;
  if (state.loading && !state.data) return <LoadingState compact={compact} />;
  return null;
}
