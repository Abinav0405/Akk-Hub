// LEGACY-PAGES port — session redirects → /connect/materials or /login
import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/ui/button';
import { cn } from '@/modules/materials/lib/utils';
import { isNativeApp } from '@/core/platform';
import NativeNavBar from '@/modules/materials/components/mobile/NativeNavBar';

const COMPANY = 'AKK ENGINEERING PTE. LTD.';
const ADDRESS = '15 Kaki Bukit Rd 4, #01-50, Singapore 417808';

export default function PageHeader({
  title,
  description,
  backTo,
  backLabel = 'Back',
  actions,
  // Native app only: back handler, bar actions and large-title eyebrow.
  onBack,
  nativeActions,
  eyebrow,
  showCompany = true,
  showAddress = false,
  variant = 'default',
  className,
}) {
  const native = isNativeApp();

  if (native) {
    return (
      <NativeNavBar
        title={title}
        subtitle={description}
        eyebrow={eyebrow}
        backTo={backTo}
        backLabel={backLabel}
        onBack={onBack}
        actions={nativeActions !== undefined ? nativeActions : actions}
        tone={variant}
      />
    );
  }

  const accent =
    variant === 'admin'
      ? 'bg-slate-800'
      : variant === 'worker'
        ? 'bg-brand'
        : 'bg-brand';

  return (
    <header
      className={cn(
        'sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur-md pt-safe-header',
        native && 'pt-[max(0.75rem,env(safe-area-inset-top,0px))]',
        className
      )}
    >
      <div className={cn('h-0.5 w-full', accent)} />
      <div className="max-w-6xl mx-auto px-safe py-3 sm:py-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {backTo && (
              <Button
                asChild
                variant="ghost"
                size="icon"
                className={cn(
                  'shrink-0 text-slate-600 hover:bg-slate-100',
                  native ? 'h-11 w-11' : 'h-10 w-10'
                )}
                aria-label={backLabel}
              >
                <Link to={backTo}>
                  <ArrowLeft className="w-5 h-5" />
                </Link>
              </Button>
            )}
            <img
              src="/Akk-logo.jpg"
              alt="AKK Engineering Logo"
              className="h-10 w-10 sm:h-11 sm:w-11 shrink-0 object-contain rounded-lg bg-white border border-border"
            />
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-semibold tracking-tight text-slate-900 truncate">
                {title}
              </h1>
              {description && (
                <p className="text-xs sm:text-sm text-muted-foreground truncate">
                  {description}
                </p>
              )}
              {showCompany && !description && (
                <p className="akk-company text-[11px] sm:text-xs font-semibold text-slate-500 truncate">
                  {COMPANY}
                  {showAddress && (
                    <span className="hidden md:inline font-normal text-slate-400">
                      {' '}· {ADDRESS}
                    </span>
                  )}
                </p>
              )}
            </div>
          </div>
          {actions && (
            <div className="flex shrink-0 items-center gap-2">
              {actions}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
