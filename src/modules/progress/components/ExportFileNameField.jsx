import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { cleanExportFileName } from '@/modules/progress/lib/packagePdf';

/**
 * Editable export file name (starts as the automatic one), plus a reset link
 * when the title or file name were changed.
 */
export default function ExportFileNameField({
    id,
    value,
    onChange,
    autoValue,
    extension,
    disabled,
    showReset,
    onReset,
}) {
    return (
        <div className="space-y-2">
            <Label htmlFor={id}>File name</Label>
            <div className="flex min-w-0 items-center gap-1.5">
                <Input
                    id={id}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onBlur={() => onChange(cleanExportFileName(value) || autoValue)}
                    placeholder={autoValue}
                    disabled={disabled}
                    className="min-w-0"
                />
                <span className="shrink-0 text-sm text-muted-foreground">{extension}</span>
            </div>
            {showReset ? (
                <button
                    type="button"
                    className="text-xs font-medium text-brand hover:underline disabled:opacity-50"
                    disabled={disabled}
                    onClick={onReset}
                >
                    Reset to the automatic title and file name
                </button>
            ) : null}
        </div>
    );
}
