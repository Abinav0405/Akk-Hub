// LEGACY-PAGES port — session redirects → /connect/materials or /login
import React from 'react';
import { cn } from '@/modules/materials/lib/utils';
import PageFooter from './PageFooter';
import { isNativeApp } from '@/core/platform';

const WIDTHS = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
  '6xl': 'max-w-6xl',
  full: 'max-w-none',
};

export default function AppShell({
  children,
  header,
  footer = true,
  maxWidth = '6xl',
  className,
  mainClassName,
}) {
  const native = isNativeApp();

  return (
    <div
      className={cn(
        // min-height only — never fixed height, so the document can grow and scroll on Android
        'akk-app min-h-dvh-safe flex flex-col bg-background overflow-x-hidden overflow-y-visible',
        native && 'app-native-portal',
        className
      )}
    >
      {header}
      <main
        className={cn(
          // Grow with content; do not use min-h-0 (that traps scroll when parent is viewport-tall)
          'flex-1 w-full mx-auto px-safe py-5 sm:py-6',
          native
            ? 'pb-[var(--n-tabbar-space)] pt-0'
            : 'pb-10 sm:pb-12',
          WIDTHS[maxWidth] || WIDTHS['6xl'],
          mainClassName
        )}
      >
        {children}
      </main>
      {!native && footer ? <PageFooter /> : null}
    </div>
  );
}
