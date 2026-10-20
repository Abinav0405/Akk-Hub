import { useState } from 'react';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Card } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import {
  autoScWorkForGroup,
  formatScheduleGroup,
  removeCompany,
  removeContract,
  removeScheduleGroup,
  scheduleGroupsFrom,
  setCompanySettingsLogo,
  upsertCompany,
  upsertContract,
  upsertScheduleGroup,
} from '@/modules/progress/lib/jsr';
import { Money } from '@/modules/progress/components/jsr/shared';

export default function CompaniesPanel({ lookups, onChanged }) {
  const companies = lookups.companies || [];
  const contracts = lookups.contracts || [];
  const groups = scheduleGroupsFrom(lookups);
  const [co, setCo] = useState(null);
  const [ct, setCt] = useState(null);
  const [sg, setSg] = useState(null);
  const [logoUrl, setLogoUrl] = useState(lookups.settings?.logo_url || '');

  const defaultSchedule = groups.find((g) => g.code === 'C')?.code || groups[0]?.code || 'C';
  const knownAutoSc = new Set([
    'Schedule B1 - Maintenance Work for Street Lighting',
    'Schedule C - Provision Sum (Modification and New Works)',
    ...groups.map(autoScWorkForGroup),
  ]);

  const saveCo = async () => {
    if (!co.name?.trim()) { toast.error('Company name is required'); return; }
    try {
      await upsertCompany(co.id || null, co);
      toast.success('Company saved');
      setCo(null);
      onChanged?.();
    } catch (e) {
      toast.error(e.message || 'Could not save company');
    }
  };

  const saveCt = async () => {
    if (!ct.code?.trim() || !ct.description?.trim()) { toast.error('Schedule code and description are required'); return; }
    if (!ct.schedule) { toast.error('Pick a schedule group'); return; }
    try {
      await upsertContract(ct.id || null, ct);
      toast.success('Contract saved');
      setCt(null);
      onChanged?.();
    } catch (e) {
      toast.error(e.message || 'Could not save contract');
    }
  };

  const saveSg = async () => {
    const code = (sg.code || '').trim();
    const label = (sg.label || '').trim();
    if (!code || !label) { toast.error('Code and label are required'); return; }
    try {
      await upsertScheduleGroup(sg.id || null, { code, label, sort_order: sg.sort_order });
      toast.success('Schedule group saved');
      setSg(null);
      onChanged?.();
    } catch (e) {
      toast.error(e.message || 'Could not save schedule group');
    }
  };

  const deleteSg = async (g) => {
    const used = Number(g.used_count || 0);
    if (used > 0) {
      toast.error(`This schedule group is used by ${used} contract${used === 1 ? '' : 's'} and cannot be deleted`);
      return;
    }
    if (groups.length <= 1) {
      toast.error('At least one schedule group is required');
      return;
    }
    if (!window.confirm(`Delete schedule group ${g.code}?`)) return;
    try {
      await removeScheduleGroup(g.id);
      toast.success('Schedule group deleted');
      onChanged?.();
    } catch (e) {
      toast.error(e.message || 'Could not delete schedule group');
    }
  };

  const saveLogo = async () => {
    try {
      await setCompanySettingsLogo(logoUrl);
      toast.success('Logo URL saved');
      onChanged?.();
    } catch (e) {
      toast.error(e.message || 'Could not save logo URL');
    }
  };

  const onScheduleChange = (schedule) => {
    const g = groups.find((row) => row.code === schedule);
    const nextAuto = autoScWorkForGroup(g);
    const replace = !ct.sc_work || knownAutoSc.has(ct.sc_work);
    setCt({ ...ct, schedule, sc_work: replace && nextAuto ? nextAuto : ct.sc_work });
  };

  const openNewContract = () => {
    const g = groups.find((row) => row.code === defaultSchedule) || groups[0];
    setCt({
      code: '',
      schedule: g?.code || defaultSchedule,
      company_id: companies[0]?.id,
      description: '',
      contract_title: '',
      sc_works: '',
      sc_work: autoScWorkForGroup(g),
      loa: '',
      jsr_prefix: 'AKK/GUTHRIE/JSR',
      pc_no: 1,
      price: 0,
      prev_cert: 0,
      rate: 0,
      client_name: '',
      client_attn: 'Engineer In-charge',
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Companies & contracts</h2>
        <p className="text-sm text-muted-foreground">Each contract belongs to a schedule group. Company details are the letterhead on JSR, claim and invoice PDFs.</p>
      </div>
      <Card className="p-4">
        <Label>Fallback letterhead logo URL</Label>
        <div className="mt-1 flex gap-2">
          <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://… or leave blank to use Admin branding" />
          <Button variant="outline" onClick={saveLogo}>Save</Button>
        </div>
      </Card>
      <Card className="p-0">
        <div className="flex items-center justify-between p-4">
          <h3 className="font-semibold">Companies ({companies.length})</h3>
          <Button size="sm" onClick={() => setCo({ name: '', addr: '', reg: '', email: '', web: '', phone: '', sub_by: '', logo_path: '' })}>
            <Plus className="mr-1 h-4 w-4" /> Add company
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Reg No</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {companies.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell>{c.reg || '—'}</TableCell>
                <TableCell className="text-xs">{[c.email, c.phone].filter(Boolean).join(' · ') || '—'}</TableCell>
                <TableCell>
                  <Button size="sm" variant="ghost" onClick={() => setCo(c)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={async () => {
                    if (!window.confirm(`Delete ${c.name}?`)) return;
                    try { await removeCompany(c.id); onChanged?.(); } catch (e) { toast.error(e.message); }
                  }}>Delete</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 p-4">
          <div>
            <h3 className="font-semibold">Schedule groups ({groups.length})</h3>
            <p className="text-sm text-muted-foreground">Contracts and claims pick from this list. Delete is blocked while a group is in use.</p>
          </div>
          <Button size="sm" onClick={() => setSg({ code: '', label: '' })}>
            <Plus className="mr-1 h-4 w-4" /> Add group
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>In use</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((g) => (
              <TableRow key={g.id || g.code}>
                <TableCell className="font-medium">{g.code}</TableCell>
                <TableCell>{g.label}</TableCell>
                <TableCell>{Number(g.used_count || 0)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {g.id ? (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setSg(g)}>Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteSg(g)}>Delete</Button>
                    </>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card className="p-0">
        <div className="flex items-center justify-between p-4">
          <h3 className="font-semibold">Contracts ({contracts.length})</h3>
          <Button size="sm" onClick={openNewContract}>
            <Plus className="mr-1 h-4 w-4" /> Add contract
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Group</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>PC No</TableHead>
              <TableHead>Price</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contracts.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">Schedule {c.code}</TableCell>
                <TableCell>{formatScheduleGroup(groups.find((g) => g.code === c.schedule) || { code: c.schedule })}</TableCell>
                <TableCell>{c.description}</TableCell>
                <TableCell>{c.pc_no}</TableCell>
                <TableCell><Money value={c.price} /></TableCell>
                <TableCell>
                  <Button size="sm" variant="ghost" onClick={() => setCt(c)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={async () => {
                    if (!window.confirm(`Delete Schedule ${c.code}?`)) return;
                    try { await removeContract(c.id); onChanged?.(); } catch (e) { toast.error(e.message); }
                  }}>Delete</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={Boolean(co)} onOpenChange={(v) => !v && setCo(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{co?.id ? 'Edit company' : 'Add company'}</DialogTitle></DialogHeader>
          {co ? (
            <div className="grid gap-3">
              {['name', 'addr', 'reg', 'sub_by', 'email', 'web', 'phone', 'logo_path'].map((k) => (
                <div key={k}>
                  <Label>{k === 'logo_path' ? 'Logo URL' : k.replace('_', ' ')}</Label>
                  <Input className="mt-1" value={co[k] || ''} onChange={(e) => setCo({ ...co, [k]: e.target.value })} />
                </div>
              ))}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCo(null)}>Cancel</Button>
            <Button onClick={saveCo}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(sg)} onOpenChange={(v) => !v && setSg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{sg?.id ? 'Edit schedule group' : 'Add schedule group'}</DialogTitle></DialogHeader>
          {sg ? (
            <div className="grid gap-3">
              <div>
                <Label>Code</Label>
                <Input className="mt-1" value={sg.code || ''} onChange={(e) => setSg({ ...sg, code: e.target.value })} placeholder="e.g. D" />
              </div>
              <div>
                <Label>Label</Label>
                <Input className="mt-1" value={sg.label || ''} onChange={(e) => setSg({ ...sg, label: e.target.value })} placeholder="e.g. emergency works" />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSg(null)}>Cancel</Button>
            <Button onClick={saveSg}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(ct)} onOpenChange={(v) => !v && setCt(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{ct?.id ? 'Edit contract' : 'Add contract'}</DialogTitle></DialogHeader>
          {ct ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>Schedule code</Label><Input className="mt-1" value={ct.code} onChange={(e) => setCt({ ...ct, code: e.target.value })} /></div>
              <div>
                <Label>Schedule group</Label>
                <select className="mt-1 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm" value={ct.schedule} onChange={(e) => onScheduleChange(e.target.value)}>
                  {groups.map((g) => (
                    <option key={g.id || g.code} value={g.code}>{formatScheduleGroup(g)}</option>
                  ))}
                  {ct.schedule && !groups.some((g) => g.code === ct.schedule) ? (
                    <option value={ct.schedule}>{ct.schedule}</option>
                  ) : null}
                </select>
              </div>
              <div className="sm:col-span-2"><Label>Description</Label><Input className="mt-1" value={ct.description} onChange={(e) => setCt({ ...ct, description: e.target.value })} /></div>
              <div className="sm:col-span-2">
                <Label>Company</Label>
                <select className="mt-1 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm" value={ct.company_id} onChange={(e) => setCt({ ...ct, company_id: e.target.value })}>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2"><Label>Contract title</Label><Input className="mt-1" value={ct.contract_title || ''} onChange={(e) => setCt({ ...ct, contract_title: e.target.value })} /></div>
              <div><Label>LOA Ref</Label><Input className="mt-1" value={ct.loa || ''} onChange={(e) => setCt({ ...ct, loa: e.target.value })} /></div>
              <div><Label>JSR prefix</Label><Input className="mt-1" value={ct.jsr_prefix || ''} onChange={(e) => setCt({ ...ct, jsr_prefix: e.target.value })} /></div>
              <div><Label>PC No</Label><Input className="mt-1" type="number" value={ct.pc_no} onChange={(e) => setCt({ ...ct, pc_no: e.target.value })} /></div>
              <div><Label>Contract price</Label><Input className="mt-1" type="number" step="any" value={ct.price} onChange={(e) => setCt({ ...ct, price: e.target.value })} /></div>
              <div><Label>Prev certified</Label><Input className="mt-1" type="number" step="any" value={ct.prev_cert} onChange={(e) => setCt({ ...ct, prev_cert: e.target.value })} /></div>
              <div><Label>Monthly rate</Label><Input className="mt-1" type="number" step="any" value={ct.rate} onChange={(e) => setCt({ ...ct, rate: e.target.value })} /></div>
              <div><Label>Client company</Label><Input className="mt-1" value={ct.client_name || ''} onChange={(e) => setCt({ ...ct, client_name: e.target.value })} /></div>
              <div><Label>Client attention</Label><Input className="mt-1" value={ct.client_attn || ''} onChange={(e) => setCt({ ...ct, client_attn: e.target.value })} /></div>
              <div className="sm:col-span-2"><Label>SC Work label</Label><Input className="mt-1" value={ct.sc_work || ''} onChange={(e) => setCt({ ...ct, sc_work: e.target.value })} /></div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCt(null)}>Cancel</Button>
            <Button onClick={saveCt}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
