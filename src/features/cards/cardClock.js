/**
 * Clock a worker in / out by scanning their ID card (supervisor / manager / admin). Same rules as the
 * worker's own site-QR scan in EmployeeHome: approximated times, one open shift, breaks at the same
 * site, open break closed + mandatory break time added at clock-out, hours worked out the same way.
 */
import { supabaseTimesheet as supabase } from '@/core/supabase';
import { calculateShiftHours, getAutoBreaksToCreate, getTodaySingapore, toSingaporeDateStr } from '@/modules/timesheet/lib/timeUtils';
import { approximateTime } from '@/modules/timesheet/lib/timeApproximation';
import { pendingOnCompleteFields } from '@/modules/timesheet/lib/shiftApproval';

function stamp() {
    const t = approximateTime(new Date());
    if (!t) throw new Error('Could not work out the time. Try again.');
    return t;
}

export async function openShiftOf(workerId) {
    const { data, error } = await supabase.from('shifts').select('*, sites(site_name)').eq('worker_id', workerId).eq('has_left', false).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const { data: open } = await supabase.from('breaks').select('id').eq('shift_id', data.id).is('break_end', null).maybeSingle();
    return { ...data, on_break: Boolean(open) };
}

export async function clockIn(workerId, site) {
    const existing = await openShiftOf(workerId);
    if (existing) {
        const day = toSingaporeDateStr(existing.work_date);
        throw new Error(day === getTodaySingapore() ? 'Already clocked in today.' : `Still clocked in from ${day} — clock out that shift first.`);
    }
    const now = stamp().toISOString();
    const { error } = await supabase
        .from('shifts')
        .insert([{ worker_id: workerId, site_id: site.id, work_date: getTodaySingapore(), entry_time: now, has_left: false, created_at: now }]);
    if (error) {
        if (error.code === '23505') throw new Error('Already clocked in.');
        throw new Error(error.message || 'Could not record the clock-in.');
    }
    return 'Clocked in';
}

export async function toggleBreak(workerId, site) {
    const shift = await openShiftOf(workerId);
    if (!shift) throw new Error('Not clocked in.');
    if (shift.site_id !== site.id) throw new Error(`Clocked in at ${shift.sites?.site_name || 'another site'} — breaks are recorded there.`);
    const now = stamp().toISOString();
    const { data: open, error: e1 } = await supabase.from('breaks').select('*').eq('shift_id', shift.id).is('break_end', null).maybeSingle();
    if (e1) throw e1;
    if (open) {
        const { error } = await supabase.from('breaks').update({ break_end: now }).eq('id', open.id);
        if (error) throw error;
        return 'Break ended';
    }
    const { error } = await supabase.from('breaks').insert([{ shift_id: shift.id, break_start: now }]);
    if (error) throw error;
    return 'Break started';
}

export async function clockOut(workerId, site) {
    const shift = await openShiftOf(workerId);
    if (!shift) throw new Error('Not clocked in.');
    if (shift.site_id !== site.id) throw new Error(`Clocked in at ${shift.sites?.site_name || 'another site'} — clock out there.`);
    const at = stamp();
    const now = at.toISOString();
    const { data: breaks, error: e1 } = await supabase.from('breaks').select('*').eq('shift_id', shift.id).order('break_start', { ascending: true });
    if (e1) throw e1;
    for (const b of (breaks || []).filter((x) => x.break_start && !x.break_end)) {
        const { error } = await supabase.from('breaks').update({ break_end: now }).eq('id', b.id);
        if (error) throw error;
    }
    const closed = (breaks || []).map((b) => (b.break_start && !b.break_end ? { ...b, break_end: now } : b));
    const auto = getAutoBreaksToCreate(shift.entry_time, at, closed);
    for (const b of auto) {
        const { error } = await supabase.from('breaks').insert([{ shift_id: shift.id, break_start: b.break_start, break_end: b.break_end }]);
        if (error) throw error;
    }
    const all = [...closed, ...auto.map((b) => ({ break_start: b.break_start, break_end: b.break_end }))].sort((a, b) => new Date(a.break_start) - new Date(b.break_start));
    const calc = calculateShiftHours(shift.entry_time, at, all, shift.work_date || getTodaySingapore());
    const { error } = await supabase
        .from('shifts')
        .update({
            leave_time: now,
            has_left: true,
            worked_hours: calc.basicHours,
            sunday_hours: calc.sundayHours,
            ot_hours: calc.otHours,
            ...pendingOnCompleteFields(),
        })
        .eq('id', shift.id);
    if (error) throw error;
    return 'Clocked out';
}
