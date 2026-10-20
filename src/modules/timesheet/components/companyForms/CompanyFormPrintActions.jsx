import React, { useState } from 'react';
import { FileDown, Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/ui/button';
import { printCompanyForms } from '@/modules/timesheet/lib/companyForms';
import { isNativeApp } from '@/core/platform';

const NATIVE_APP = isNativeApp();

export default function CompanyFormPrintActions({
    submissions,
    disabled = false,
    compact = false,
}) {
    const [busy, setBusy] = useState(null);
    const count = submissions?.length || 0;
    const locked = disabled || !count || Boolean(busy);

    const run = async (mode, event) => {
        event.stopPropagation();
        if (locked) return;
        setBusy(mode);
        try {
            const result = await printCompanyForms(submissions, { mode });
            if (!result.stored) {
                toast.message('Opened a copy. Apply the form-document database update so this original is saved and reused.');
            } else if (result.mode === 'pdf') {
                toast.success(
                    NATIVE_APP
                        ? 'Choose an app to save, print, or share the PDF'
                        : 'PDF downloaded'
                );
            } else {
                toast.success('Print dialog opened');
            }
        } catch (error) {
            toast.error(error?.message || 'Could not prepare the form');
        } finally {
            setBusy(null);
        }
    };

    const size = compact ? 'h-9 w-9 px-0' : 'h-9 rounded-xl';

    if (NATIVE_APP) {
        return (
            <Button
                type="button"
                variant="outline"
                className={size}
                disabled={locked}
                onClick={(event) => run('pdf', event)}
                aria-label={count > 1 ? `Save ${count} forms as PDF` : 'Save form as PDF'}
            >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                {compact ? null : <span className="ml-1.5">{count > 1 ? `PDF (${count})` : 'PDF'}</span>}
            </Button>
        );
    }

    return (
        <div className="flex shrink-0 items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
            <Button
                type="button"
                variant="outline"
                className={size}
                disabled={locked}
                onClick={(event) => run('print', event)}
                aria-label={count > 1 ? `Print ${count} forms` : 'Print form'}
            >
                {busy === 'print' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                    <Printer className="h-4 w-4" />
                )}
                {compact ? null : <span className="ml-1.5">{count > 1 ? `Print (${count})` : 'Print'}</span>}
            </Button>
            <Button
                type="button"
                variant="outline"
                className={size}
                disabled={locked}
                onClick={(event) => run('pdf', event)}
                aria-label={count > 1 ? `Download ${count} forms as PDF` : 'Download form as PDF'}
            >
                {busy === 'pdf' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                    <FileDown className="h-4 w-4" />
                )}
                {compact ? null : <span className="ml-1.5">{count > 1 ? `PDF (${count})` : 'PDF'}</span>}
            </Button>
        </div>
    );
}
