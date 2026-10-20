/**
 * One-time "connect this module" form. The hub signs the user in to the Material Tracker /
 * Site Progress backend with their account there (often the same ID/email + password).
 * Disappears once all three backends are merged into the AKK Hub project.
 */
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Boxes, Camera, Loader2, PlugZap } from 'lucide-react';
import { useIdentity } from '@/core/auth/identity';
import { MODULE_LABELS, connectModule, moduleRoleFor } from '@/core/auth/bridges';
import { signInExporter } from '@/core/auth/progress/exporterSession';
import { Banner, Field, PasswordField } from '@/ui/hub/primitives';
import { useLanguage } from '@/core/i18n';

const ICONS = { materials: Boxes, progress: Camera };

export default function ConnectForm({ module, onConnected }) {
    const identity = useIdentity();
    const { t } = useLanguage();
    const navigate = useNavigate();
    const location = useLocation();
    const asParam = new URLSearchParams(location.search).get('as');
    const exporterMode = module === 'progress' && asParam === 'exporter';
    const role = exporterMode ? 'exporter' : moduleRoleFor(identity?.role, module);
    const label = MODULE_LABELS[module];
    const Icon = ICONS[module] || PlugZap;

    const [id, setId] = useState(() => (exporterMode ? '' : identity?.email || identity?.id || ''));
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const idLabelKey = `hub.connect.id.${module}.${role}`;
    const idLabel = t(idLabelKey);
    const resolvedIdLabel = idLabel === idLabelKey ? t('hub.connect.loginId') : idLabel;

    const submit = async (e) => {
        e.preventDefault();
        if (!identity?.role && !exporterMode) {
            setError(t('hub.connect.fail'));
            return;
        }
        if (!id.trim() || !password) {
            setError(t('hub.connect.bothFields'));
            return;
        }
        setBusy(true);
        setError('');
        let result;
        try {
            if (exporterMode) {
                result = await signInExporter({ displayName: id, password });
            } else {
                result = await connectModule({
                    hubRole: identity.role,
                    module,
                    id: id.trim(),
                    email: id.trim(),
                    password,
                });
            }
        } catch (err) {
            result = { ok: false, error: err?.message || t('hub.connect.fail') };
        }
        setBusy(false);
        if (!result?.ok) {
            setError(result?.error || t('hub.connect.fail'));
            return;
        }
        setPassword('');
        setError('');
        if (onConnected) onConnected();
        else if (location.state?.from) navigate(location.state.from, { replace: true });
    };

    return (
        <form onSubmit={submit} className="g-card g-card--pad g-auth__form" noValidate>
            <div className="flex items-start gap-3">
                <span className="g-tile__icon shrink-0" data-tone={module}>
                    <Icon aria-hidden />
                </span>
                <div>
                    <h2 className="text-base font-bold text-[var(--g-ink)]">
                        {exporterMode ? t('hub.connect.clientTitle') : t('hub.connect.linkTitle', { module: label })}
                    </h2>
                    <p className="mt-0.5 text-sm text-[var(--g-muted)]">
                        {exporterMode
                            ? t('hub.connect.clientHint')
                            : t('hub.connect.linkHint', { module: label })}
                    </p>
                </div>
            </div>
            <Field
                id="connect-id"
                label={resolvedIdLabel}
                value={id}
                onChange={(e) => setId(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                error={error}
            />
            <PasswordField
                id="connect-password"
                label={t('hub.connect.password')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                error={error}
            />
            {error ? <Banner tone="danger">{error}</Banner> : null}
            <button
                type="submit"
                className="g-btn g-btn--primary g-btn--block min-h-11"
                disabled={busy}
                aria-busy={busy || undefined}
            >
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {busy ? t('hub.connect.connecting') : t('hub.connect.connect', { module: label })}
            </button>
        </form>
    );
}
