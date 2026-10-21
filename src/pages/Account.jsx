/**
 * Account — profile, language, biometric sign-in (employees in the app), module links,
 * privacy and sign-out.
 */
import { useEffect, useState } from 'react';
import { signOutWithAnimation } from '@/core/auth/signOutFlow';
import MyPhotoAvatar from '@/ui/MyPhotoAvatar';
import { useNavigate } from 'react-router-dom';
import { CircleCheck, Fingerprint, Languages, Link2, LogOut, ScrollText, Unlink } from 'lucide-react';
import { HubPage } from '@/ui/PortalShell';
import { List, ListRow, SectionLabel } from '@/ui/hub/primitives';
import LanguageSwitcher from '@/core-i18n/LanguageSwitcher';
import { useLanguage } from '@/core/i18n';
import { ROLE_LABELS, useIdentity } from '@/core/auth/identity';
import { MODULE_LABELS, disconnectModule, useModuleConnection } from '@/core/auth/bridges';
import { getBiometricPrefs, getBiometricSupport, getUnsupportedMessage } from '@/core/auth/biometric';
import BiometricLoginSettings from '@/ui/biometric/BiometricLoginSettings';
import { confirmAction } from '@/ui/native/NativeConfirm';
import { isNativeApp } from '@/core/platform';
import { paths } from '@/app/paths';

function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'A';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function ModuleLinkRow({ role, module }) {
    const { t } = useLanguage();
    const status = useModuleConnection(role, module);
    if (status === 'unavailable') return null;
    if (status === 'connected') {
        return (
            <ListRow
                icon={CircleCheck}
                tone={module}
                title={MODULE_LABELS[module]}
                hint={t('hub.account.linkedHint')}
                onClick={async () => {
                    const ok = await confirmAction({
                        title: t('hub.account.unlinkTitle', { module: MODULE_LABELS[module] }),
                        message: t('hub.account.unlinkMsg', { module: MODULE_LABELS[module] }),
                        confirmLabel: t('hub.account.unlink'),
                        destructive: true,
                    });
                    if (ok) await disconnectModule(module);
                }}
                trailing={<Unlink className="g-row__chev" aria-hidden />}
            />
        );
    }
    return (
        <ListRow
            to={status === 'not-configured' ? undefined : paths.connect(module)}
            as={status === 'not-configured' ? 'div' : undefined}
            icon={Link2}
            tone={module}
            title={MODULE_LABELS[module]}
            hint={status === 'not-configured' ? t('hub.account.notConfigured') : t('hub.account.notLinked')}
        />
    );
}

export default function Account() {
    const identity = useIdentity();
    const { t } = useLanguage();
    const navigate = useNavigate();
    const [bioOpen, setBioOpen] = useState(false);
    const [bioSupport, setBioSupport] = useState(null);
    const isWorker = identity?.role === 'worker';

    useEffect(() => {
        if (!isWorker) return;
        getBiometricSupport().then(setBioSupport);
    }, [isWorker]);

    const bioPrefs = getBiometricPrefs();
    const bioHint = !isNativeApp()
        ? getUnsupportedMessage('web')
        : bioSupport?.available
          ? bioPrefs.enabled && bioPrefs.workerId === String(identity?.id)
              ? t('hub.account.bioOn')
              : t('hub.account.bioOff')
          : getUnsupportedMessage(bioSupport?.reason);

    const signOut = async () => {
        const ok = await confirmAction({
            title: t('hub.account.signOutTitle'),
            message: t('hub.account.signOutMsg'),
            confirmLabel: t('hub.account.signOut'),
            destructive: true,
        });
        if (!ok) return;
        await signOutWithAnimation(navigate);
    };

    return (
        <HubPage title={t('hub.account.pageTitle')} eyebrow={t('hub.brand')} narrow>
            <section className="g-card g-card--pad g-rise flex items-center gap-4">
                <MyPhotoAvatar name={identity?.name} isWorker={isWorker} />
                <div className="min-w-0">
                    <p className="truncate text-lg font-bold tracking-tight text-[var(--g-ink)]">{identity?.name}</p>
                    <p className="truncate text-sm text-[var(--g-muted)]">
                        {ROLE_LABELS[identity?.role]}
                        {identity?.id ? ` · ${identity.id}` : ''}
                        {isWorker ? ` · ${identity.workerType === 'local' ? t('hub.account.local') : t('hub.account.foreign')}` : ''}
                    </p>
                </div>
            </section>

            <SectionLabel>{t('hub.account.preferences')}</SectionLabel>
            <List>
                <ListRow as="div" icon={Languages} title={t('hub.account.language')} trailing={null} hint={<span className="mt-2 block"><LanguageSwitcher /></span>} />
                {isWorker ? (
                    <ListRow
                        icon={Fingerprint}
                        title={t('hub.account.biometric')}
                        hint={bioHint}
                        onClick={isNativeApp() && bioSupport?.available ? () => setBioOpen(true) : undefined}
                        as={isNativeApp() && bioSupport?.available ? undefined : 'div'}
                        trailing={isNativeApp() && bioSupport?.available ? undefined : null}
                    />
                ) : null}
            </List>

            {identity?.role !== 'supervisor' ? (
                <>
                    <SectionLabel>{t('hub.account.linkedModules')}</SectionLabel>
                    <List>
                        <ModuleLinkRow role={identity?.role} module="materials" />
                        <ModuleLinkRow role={identity?.role} module="progress" />
                    </List>
                </>
            ) : null}

            <SectionLabel>{t('hub.account.about')}</SectionLabel>
            <List>
                <ListRow to={paths.privacy} icon={ScrollText} title={t('hub.privacyPdpa')} />
            </List>

            <button type="button" className="g-btn g-btn--secondary g-btn--block mt-6 text-[var(--g-danger)]" onClick={signOut}>
                <LogOut aria-hidden /> {t('hub.account.signOut')}
            </button>
            <p className="g-company-foot">{t('hub.account.foot')}</p>

            {isWorker ? (
                <BiometricLoginSettings
                    open={bioOpen}
                    onOpenChange={setBioOpen}
                    workerId={identity.id}
                    workerType={identity.workerType}
                    workerName={identity.name}
                />
            ) : null}
        </HubPage>
    );
}
