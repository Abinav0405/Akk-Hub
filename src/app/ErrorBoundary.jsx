import { Component } from 'react';
import { TriangleAlert } from 'lucide-react';

/**
 * Keeps one broken screen from blanking the whole app. Shows what failed and a reload button;
 * a stale lazy chunk after a deploy is retried once with a full reload.
 */
export default class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ''}]`, error, info?.componentStack);
        const msg = String(error?.message || '');
        if (/Failed to fetch dynamically imported module|Importing a module script failed/i.test(msg)) {
            try {
                if (!sessionStorage.getItem('akk.hub.chunkReload')) {
                    sessionStorage.setItem('akk.hub.chunkReload', '1');
                    window.location.reload();
                }
            } catch {
                /* ignore */
            }
        }
    }

    render() {
        if (!this.state.error) return this.props.children;
        return (
            <div className="g-main">
                <div className="g-card g-card--pad">
                    <div className="g-empty" style={{ '--tone': 'var(--g-danger)', '--tone-soft': 'var(--g-danger-soft)' }}>
                        <span className="g-empty__icon">
                            <TriangleAlert aria-hidden />
                        </span>
                        <p className="g-empty__title">This screen hit a problem</p>
                        <p className="g-empty__text">
                            {this.props.label ? `${this.props.label}: ` : ''}
                            {String(this.state.error?.message || this.state.error)}
                        </p>
                        <div className="mt-2 flex gap-2">
                            <button type="button" className="g-btn g-btn--secondary g-btn--sm" onClick={() => window.history.back()}>
                                Go back
                            </button>
                            <button type="button" className="g-btn g-btn--primary g-btn--sm" onClick={() => window.location.reload()}>
                                Reload
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}
