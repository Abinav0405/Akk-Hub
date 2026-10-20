import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Card } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { upsertCatalogItem, removeCatalogItem } from '@/modules/progress/lib/jsr';
import { Money } from '@/modules/progress/components/jsr/shared';

export default function CatalogPanel({ lookups, onChanged }) {
  const rows = useMemo(
    () => [...(lookups.catalog || [])].sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true })),
    [lookups.catalog]
  );
  const [editing, setEditing] = useState(null);

  const save = async () => {
    const code = (editing.code || '').trim();
    const description = (editing.description || '').trim();
    const unit = (editing.unit || '').trim();
    const rate = Number(editing.rate);
    if (!code || !description || !unit || !(rate >= 0)) {
      toast.error('All fields are required');
      return;
    }
    try {
      await upsertCatalogItem(editing.id || null, {
        code,
        description,
        unit,
        rate,
        group_name: editing.group_name || '',
      });
      toast.success('Saved');
      setEditing(null);
      onChanged?.();
    } catch (e) {
      toast.error(e.message || 'Could not save item');
    }
  };

  const del = async (it) => {
    if (!window.confirm(`Delete item ${it.code}?`)) return;
    try {
      await removeCatalogItem(it.id);
      toast.success('Removed');
      onChanged?.();
    } catch (e) {
      toast.error(e.message || 'Could not delete');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">JSR items & rates</h2>
          <p className="text-sm text-muted-foreground">LTA-style catalog used when building JSRs.</p>
        </div>
        <Button onClick={() => setEditing({ code: '', group_name: '', description: '', unit: 'no.', rate: 0 })}>
          <Plus className="mr-1.5 h-4 w-4" /> Add item
        </Button>
      </div>
      <Card className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item no.</TableHead>
              <TableHead>Group</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Rate (S$)</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((it) => (
              <TableRow key={it.id} className={it.is_active === false ? 'opacity-50' : undefined}>
                <TableCell className="font-medium">{it.code}</TableCell>
                <TableCell>{it.group_name}</TableCell>
                <TableCell>{it.description}</TableCell>
                <TableCell>{it.unit}</TableCell>
                <TableCell><Money value={it.rate} /></TableCell>
                <TableCell className="whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(it)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => del(it)}>Delete</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Dialog open={Boolean(editing)} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? `Edit item ${editing.code}` : 'Add JSR item'}</DialogTitle>
          </DialogHeader>
          {editing ? (
            <div className="grid gap-3">
              <div><Label>Item no.</Label><Input className="mt-1" value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })} /></div>
              <div><Label>Group</Label><Input className="mt-1" value={editing.group_name || ''} onChange={(e) => setEditing({ ...editing, group_name: e.target.value })} /></div>
              <div><Label>Description</Label><Input className="mt-1" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></div>
              <div><Label>Unit</Label><Input className="mt-1" value={editing.unit} onChange={(e) => setEditing({ ...editing, unit: e.target.value })} /></div>
              <div><Label>Rate (S$)</Label><Input className="mt-1" type="number" step="any" min="0" value={editing.rate} onChange={(e) => setEditing({ ...editing, rate: e.target.value })} /></div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
