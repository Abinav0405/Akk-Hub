// LEGACY-PAGES port — session redirects → /connect/materials or /login
import React from 'react';
import { Card, CardContent } from '@/ui/card';
import { cn } from '@/modules/materials/lib/utils';
import { isNativeApp } from '@/core/platform';

export default function FilterToolbar({ search, filters, actions, className }) {
  const native = isNativeApp();
  return (
    <Card className={cn('akk-toolbar shadow-sm', native && 'akk-toolbar--native', className)}>
      <CardContent className="p-0 space-y-3">
        {search && <div className="w-full">{search}</div>}
        {(filters || actions) && (
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            {filters && (
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                {filters}
              </div>
            )}
            {actions && (
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {actions}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
