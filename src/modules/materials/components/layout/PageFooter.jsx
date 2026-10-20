// LEGACY-PAGES port — session redirects → /connect/materials or /login
import React from 'react';
import { cn } from '@/modules/materials/lib/utils';

const COMPANY = 'AKK ENGINEERING PTE. LTD.';
const ADDRESS = '15 Kaki Bukit Rd 4, #01-50, Singapore 417808';

export default function PageFooter({ className, compact = false }) {
  return (
    <footer
      className={cn(
        'mt-auto border-t border-border bg-card/90 backdrop-blur-sm px-safe py-3 pb-safe-bottom',
        className
      )}
    >
      <p className="text-center text-xs sm:text-sm text-muted-foreground">
        <span className="akk-company font-semibold text-slate-600">
          © {new Date().getFullYear()} {COMPANY}
        </span>
        {!compact && (
          <>
            <span className="hidden sm:inline"> · Material Tracking System</span>
            <span className="block sm:inline sm:before:content-['·'] sm:before:mx-1.5 text-[11px] sm:text-xs mt-0.5 sm:mt-0">
              {ADDRESS}
            </span>
          </>
        )}
      </p>
    </footer>
  );
}
