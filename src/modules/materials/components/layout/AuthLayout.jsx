// LEGACY-PAGES port — session redirects → /connect/materials or /login
import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/ui/button';
import PageFooter from './PageFooter';
import { cn } from '@/modules/materials/lib/utils';

const COMPANY = 'AKK ENGINEERING PTE. LTD.';
const ADDRESS = '15 Kaki Bukit Rd 4, #01-50, Singapore 417808';

export default function AuthLayout({
  children,
  backTo,
  backLabel = 'Back to Home',
  className,
}) {
  return (
    <div className={cn('akk-app min-h-dvh-safe flex flex-col bg-background overflow-x-hidden overflow-y-visible', className)}>
      <div className="flex-1 flex flex-col items-center justify-center px-safe py-8 pb-safe-bottom">
        <div className="w-full max-w-md">
          {backTo && (
            <Button asChild variant="ghost" className="mb-4 -ml-2 text-slate-600 hover:text-slate-900">
              <Link to={backTo}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                {backLabel}
              </Link>
            </Button>
          )}
          {children}
          <div className="mt-6 text-center">
            <p className="akk-company text-sm font-semibold text-slate-700">{COMPANY}</p>
            <p className="text-xs text-muted-foreground mt-1">{ADDRESS}</p>
          </div>
        </div>
      </div>
      <PageFooter compact />
    </div>
  );
}
