import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog';
import NativeActionRow from '@/modules/materials/components/mobile/NativeActionRow';

/**
 * iOS-style action sheet for secondary/overflow actions (native only).
 * actions: [{ id, icon, label, hint, tone, destructive, disabled, onSelect }]
 */
export default function NativeActionSheet({ open, onOpenChange, title, description, actions = [] }) {
  const items = actions.filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="n-sheet__head">
          <DialogTitle className="n-sheet__title">{title}</DialogTitle>
          {description ? (
            <DialogDescription className="n-sheet__text">{description}</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">{title}</DialogDescription>
          )}
        </div>
        <div className="n-group">
          {items.map((action) => (
            <NativeActionRow
              key={action.id || action.label}
              icon={action.icon}
              tone={action.tone}
              title={action.label}
              hint={action.hint}
              destructive={action.destructive}
              disabled={action.disabled}
              compact
              onClick={() => {
                onOpenChange(false);
                // Let this sheet start closing before the next one opens.
                window.setTimeout(action.onSelect, 0);
              }}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
