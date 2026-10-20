import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    console.error('[app]', error, info);
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="flex min-h-dvh-safe flex-col items-center justify-center gap-3 bg-background p-6 text-center">
          <p className="text-lg font-semibold text-navy">Something went wrong</p>
          <p className="text-sm text-muted-foreground">Reload the page to continue. You will stay signed in.</p>
          <button
            type="button"
            className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-medium text-white"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
