import { Component, type ReactNode } from 'react';

/**
 * Keeps a failing part of a page (e.g. a chart) from blanking the whole page: shows `fallback`
 * instead and logs the error. React still needs a class component for this.
 */
export class ErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    console.error(error);
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
