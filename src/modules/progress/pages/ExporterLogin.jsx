import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { FileDown, User, Lock } from 'lucide-react';
import LoginForm from '@/ui/auth/LoginForm';
import {
  isExporterAuthenticated,
  verifyExporterSession,
  signInExporter,
  consumeExporterSessionExpiredMessage,
} from '@/core/auth/progress/exporterSession';
import { useSheetDismiss } from '@/modules/progress/hooks/useSheetDismiss';
import { isNativeApp, useSheetLayout } from '@/core/platform';
import { createPageUrl } from '@/modules/progress/lib/utils';

/**
 * Standalone Export Only / client login (SPT ExporterLogin).
 * Public route — no hub Timesheet identity required.
 */
export default function ExporterLogin() {
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const sheetLayout = useSheetLayout();
  const { sheetOpen, dismissSheetThen, runPendingFinish } = useSheetDismiss(sheetLayout);
  const native = isNativeApp();
  const [loginError, setLoginError] = useState('');
  const showLoginError = (message) => (native ? setLoginError(message) : toast.error(message));

  useEffect(() => {
    const expired = consumeExporterSessionExpiredMessage();
    if (expired) toast.error(expired);
    let cancelled = false;
    (async () => {
      if (!isExporterAuthenticated()) return;
      const session = await verifyExporterSession();
      if (!cancelled && session) {
        navigate(createPageUrl('ExporterDashboard'), { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setIsLoading(true);
    try {
      const result = await signInExporter({ displayName, password });
      if (!result.ok) {
        showLoginError(result.error);
        setIsLoading(false);
        return;
      }
      if (!native) {
        toast.success(`Welcome back, ${result.profile.name}!`);
      }
      setIsLoading(false);
      dismissSheetThen(() => {
        if (native) {
          navigate(createPageUrl('ExporterDashboard'), {
            replace: true,
            state: {
              welcomeName: result.profile.name || '',
              welcomeAt: Date.now(),
            },
          });
          return;
        }
        navigate(createPageUrl('ExporterDashboard'), { replace: true });
      });
    } catch (error) {
      console.error('Export Only login error:', error);
      showLoginError('Could not reach the server. Check your connection and try again.');
      setIsLoading(false);
    }
  };

  return (
    <LoginForm
      formError={loginError}
      theme="green"
      title="Export Only Portal"
      description="View packages sent for export and download PDF or Excel reports"
      backTo="/"
      submitLabel="Login to Export"
      submitIcon={FileDown}
      isLoading={isLoading}
      isSubmitDisabled={!displayName.trim() || !password.trim()}
      onSubmit={handleLogin}
      sheetOpen={sheetOpen}
      onSheetExitComplete={runPendingFinish}
      onRequestClose={() => {
        dismissSheetThen(() => navigate('/'));
      }}
      fields={[
        {
          id: 'exporterName',
          label: 'Name',
          icon: User,
          value: displayName,
          onChange: (e) => {
            setDisplayName(e.target.value);
            setLoginError('');
          },
          placeholder: 'Your name',
          autoComplete: 'username',
        },
        {
          id: 'password',
          label: 'Password',
          icon: Lock,
          type: 'password',
          value: password,
          onChange: (e) => {
            setPassword(e.target.value);
            setLoginError('');
          },
          placeholder: 'Enter your password',
          autoComplete: 'current-password',
        },
      ]}
    />
  );
}
