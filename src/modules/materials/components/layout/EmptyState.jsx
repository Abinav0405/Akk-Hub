// LEGACY-PAGES port — session redirects → /connect/materials or /login
import React from 'react';
import { Package } from 'lucide-react';
import { Card, CardContent } from '@/ui/card';
import { cn } from '@/modules/materials/lib/utils';

export default function EmptyState({
  icon: Icon = Package,
  title = 'Nothing here yet',
  description,
  className,
}) {
  return (
    <Card className={cn('border-dashed shadow-none', className)}>
      <CardContent className="py-16 px-6 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
          <Icon className="h-7 w-7 text-slate-400" />
        </div>
        <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
        {description && (
          <p className="mt-1.5 text-sm text-muted-foreground max-w-sm mx-auto">
            {description}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
