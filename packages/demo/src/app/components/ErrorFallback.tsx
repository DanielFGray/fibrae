/**
 * ErrorFallback component - displays errors from ErrorBoundary
 */

import type { VElement } from "fibrae";

// =============================================================================
// ErrorFallback
// =============================================================================

export interface ErrorFallbackProps {
  error: Error;
  resetError?: () => void;
}

/**
 * ErrorFallback - displayed when an error is caught by ErrorBoundary.
 */
export function ErrorFallback(props: ErrorFallbackProps): VElement {
  const { error, resetError } = props;

  return (
    <div class="error-fallback" data-cy="error-fallback">
      <h2>Something went wrong</h2>
      <p data-cy="error-message">{error.message}</p>
      {resetError && (
        <button onclick={resetError} data-cy="retry-btn">
          Try Again
        </button>
      )}
      <details>
        <summary>Error Details</summary>
        <pre data-cy="error-stack">{error.stack}</pre>
      </details>
    </div>
  );
}

// =============================================================================
// NotFound
// =============================================================================

/**
 * NotFound - 404 page component
 */
export function NotFound(): VElement {
  return (
    <div class="not-found" data-cy="not-found">
      <h1>404 - Page Not Found</h1>
      <p>The page you're looking for doesn't exist.</p>
      <a href="/" data-cy="home-link">Go Home</a>
    </div>
  );
}

// =============================================================================
// Loading
// =============================================================================

/**
 * Loading - generic loading indicator
 */
export function Loading(props: { message?: string }): VElement {
  return (
    <div class="loading" data-cy="loading">
      <div class="spinner" />
      <p>{props.message ?? "Loading..."}</p>
    </div>
  );
}
