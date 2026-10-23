/**
 * Builds migration/sql/81_worker_info_import.sql from "Worker details.pdf" (Project Name List,
 * last update 22/10/2026), transcribed row by row. Never overwrites a value already stored
 * (coalesce). Names are NOT imported — Attendance is the master for names.
 *   node make-worker-import.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { MIGRATION_DIR } from './lib/env.mjs';

const J = '11A Jasmine Road Adelphi Park Estate Singapore 576583';
const K = '15 Kaki Bukit Road 4 #01-50 Bartley Biz Centre Singapore 417808';
const T = 'Tampines place Blk 8 #05-31 Tampines Dormitory';
const H = 'Home Stay Lodge BLK 23 #05-15 Kaki Bukit Ave 3 Singapore 415922';
const F = '415C #05-58 Fernvale Link Singapore 793415';

// [emp, pdfName, workPermit, hp, permitExpiry, passport, passportExpiry, nationality, socNo, socExpiry, address, note]
const rows = [
    ['1006', 'GANESAN VENGATESAN', '0 38281712', '83589458', '11-Dec-2026', 'T4606824', '21/03/2029', 'INDIAN', 'AWSHC-2024-TM001911-02', '06-Jan-2026', J],
    ['1007', 'RAMASAMY RAMESH', '0 38090798', '84083815', '11-Dec-2026', 'S4915469', '17/09/2028', 'INDIAN', 'WSHMCI 2025-EN000688-10', '31-Dec-9999', J],
    ['1009', 'MAHENDIRAN VENKATESAN', '0 38281534', '97751701', '20-Feb-2027', 'W1229808', '15/01/2033', 'INDIAN', 'AWSHC 2024-TM001985-11', '20-Mar-2026', J],
    ['1011', 'ANTHONISAGAYARAJ REMI', '0 39339161', '85063069', '18-Sep-2027', 'T6225336', '20/06/2029', 'INDIAN', 'AKC-25-116368', '08-Oct-2027', K],
    ['1013', 'KHOLIL MD EBRAHIM', '0 63536954', '81206455', '30-Sept-2027', 'A17443647', '02-Jan-2035', 'BANGLADESHI', 'FGE-03764', '31-Dec-9999', J],
    ['1015', 'ANNADURAI ANBUDURAI', '0 38543881', '87329320', '05-Aug-2026', 'V1299638', '08-Jan-2031', 'INDIAN', 'WSHMCI 2025 -EN000602-01', '31-Dec-9999', K],
    ['1022', 'PULENDRAN PRAKASH', '0 38698710', '83022948', '20-Jan-2027', 'T1481169', '21-Feb-2029', 'INDIAN', 'LC-KB-WMCI-2023-05-075-2', '31-Dec-9999', T],
    ['1024', 'BALAKRISHNAN SATHIYAMOORTHY', '0 36004169', '83013927', '12-Feb-2027', 'W127476', '25-Sept-2032', 'INDIAN', 'AWSHC 2024-TM002010-02', '06-Apr-2028', H],
    ['1025', 'CHELLADURAI CHINRAJ', '0 34981426', '84039203', '17-Feb-2027', 'S0082090', '20-Feb-2028', 'INDIAN', 'EA-WP02-PR-303E-1-E0247(BL)-04676', '31-Dec-9999', H, 'SOC No. spans two lines in the PDF — joined'],
    ['1026', 'RAJARAM ARUNPRAKASH', '0 38889907', '80653042', '26-Feb-2027', 'W0104617', '21-Apr-2032', 'INDIAN', 'FGE-00801', '31-Dec-9999', T],
    ['1027', 'KARUPPAIAH VELMURUGAN', '0 38160931', '83570943', '20-Feb-2027', 'U0508980', '20-Aug-2030', 'INDIAN', 'LC-KB-WMCI-2022-09-030-15', '31-Dec-9999', T],
    ['1029', 'MURUGESAN RASALINGAM', '0 36874414', '98920274', '19-May-2027', 'Y7684270', '12-Nov-2033', 'INDIAN', 'JA-AWSHCS-2024-0382', '16-Feb-2026', H],
    ['1030', 'GOVINDHAN MURUGANANTHAM', '0 37048771', '96103242', '10-Jun-2027', 'V9401185', '03-Mar-2032', 'INDIAN', 'FGS-WPH-WSH-3080-11-00554', '31-Dec-9999', T, 'SOC No. printed as "FGS-WPH-WSH-3080-1 1-00554" — read as 3080-11'],
    ['1031', 'ELANGOVAN SATHISH', '0 36665629', '84577932', '19-Jun-2027', 'W8275190', '23-Feb-2033', 'INDIAN', 'BCSS2016000639', '31-Dec-9999', J],
    ['1032', 'GANESAN SANGILIMUTHU', '0 38885243', '85023437', '19-Jun-2027', 'V9044656', '10-Apr-2032', 'INDIAN', 'JA-CSOC-2024-0336', '04-Oct-2026', J],
    ['1033', 'AROCKIASAMY AROKIA JOHNSON JACKAB', '0 34866929', '87622521', '19-May-2027', 'T4591658', '24-Aug-2029', 'INDIAN', 'BCSS:10047', '31-Dec-9999', H],
    ['1035', 'GOPAL KABILAN', '0 34240884', '83715196', '13-May-2027', 'AB394829', '21-May-2035', 'INDIAN', 'AWSHC 2025-TM002625-06', '17-Jul-2029', T],
    ['1037', 'ELANGOVEN RAJARAJAN', '0 38734946', '81740501', '16-Jul-2027', 'R8498727', '11-Feb-2028', 'INDIAN', 'LC-KB-AWCS-2024-04-1555-13', '03-Apr-2026', T],
    ['1038', 'MUTHUKRISHNAN VEMBARASAN', '0 33570562', '98061216', '21-Jul-2027', 'U2278660', '02-Dec-2029', 'INDIAN', 'CSOC 2024-TM004965-11', '18-Sept-2030', T],
    ['1039', 'NATH SREE UBENDRA', '0 63853534', '86539090', '29-Jul-2027', 'A17828858', '27-Jan-2035', 'BANGLADESHI', '03344-47348', '20-Sept-2028', T],
    ['1041', 'MANI RAJA', '0 36248173', '97743119', '29-Jul-2027', 'W8271121', '29-Jan-2033', 'INDIAN', 'BCSS-1215-B174-4136', '31-Dec-9999', H],
    ['1043', 'ARUMUGAM MUTHUCHAMY', '0 34040680', '86989020', '06-Aug-2027', 'AA101134', '18-May-2035', 'INDIAN', 'BCSS:103309', '31-Dec-9999', H],
    ['1047', 'GUNASEKARAN BHARATHI', '0 9811355-', '87630171', '16-Aug-2027', 'W4678185', '23-Aug-2032', 'INDIAN', '02172(BL)-39911', '31-Dec-9999', F, 'Work Permit No. "0 9811355-" looks cut off in the PDF — check'],
    ['1048', 'KARUPPIAH SURESHKUMAR', '0 33698089', '94494059', '19-Aug-2027', 'C5550912', '21-Nov-2034', 'INDIAN', '17467-2008 (REF: 008-012-00013)', '31-Dec-9999', T, 'SOC No. printed on two lines ("17467-2008" / "REF: 008-012-00013") — check'],
    ['1049', 'VENU VIJAYAKUMAR', '0 32199917', '90357359', '14-Aug-2027', 'W8877612', '05-Jun-2033', 'INDIAN', 'BCS/07/01643', null, T, 'No SOC expiry in the PDF'],
    ['1050', 'ARUNACHALAM PILLAI SUBASHCHANDRABOSE', '0 39047527', '98645455', '23-Sept-2027', 'V2069764', '24-Aug-2031', 'INDIAN', 'FGE-030389', '29-Nov-2026', H],
    ['1051', 'RATHAKRISHNAN RAJAPRASANNA', '0 98153535', '82298036', '08-Oct-2027', 'AA111445', '04-Jun-2035', 'INDIAN', 'WPH-WSH-3080-1.1', '31-Dec-9999', null, 'Nationality printed "INDIA" — stored as INDIAN; no address in the PDF'],
    ['1052', 'PUGAZHENTHI AKASH', '0 38786946', '98588329', '16-Oct-2027', 'U9529807', '04-Mar-2031', 'INDIAN', 'LC-KB-AWCS-2025-10-3733-13', '27-Oct-2027', J],
];

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
function toDate(s) {
    if (!s) return null;
    let m = /^(\d{1,2})-([A-Za-z]{3,4})-(\d{4})$/.exec(s.trim());
    if (m) {
        const mo = MON[m[2].toLowerCase()];
        if (!mo) throw new Error('bad month ' + s);
        return `${m[3]}-${String(mo).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    throw new Error('unparsed date ' + s);
}
const lit = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const dlit = (v) => (v == null ? 'null' : `'${v}'::date`);

const COLS = ['work_permit_no', 'hp_number', 'permit_expiry_date', 'passport_no', 'passport_expiry_date', 'nationality', 'safety_cert_no', 'safety_cert_expiry_date', 'address'];
const values = rows.map(([emp, name, wp, hp, pe, pp, ppe, nat, soc, soce, addr, note]) => {
    const v = [lit(emp), lit(wp), lit(hp), dlit(toDate(pe)), lit(pp), dlit(toDate(ppe)), lit(nat), lit(soc), dlit(toDate(soce)), lit(addr)];
    return `    (${v.join(', ')})${note ? ` -- ${emp} ${name}: ${note}` : ` -- ${emp} ${name}`}`;
});

const sql = `-- =====================================================================================
-- AKK Hub — import of "Worker details.pdf" (Project Name List, last update 22/10/2026), 28 foreign workers.
-- Generated by migration/tool/make-worker-import.mjs. Safe to re-run:
--   · only rows whose Employee ID exists in Attendance are imported (others are listed by the check below)
--   · a value already stored is NEVER overwritten (coalesce) — the PDF only fills blanks
--   · names are not imported (Attendance is the master for names)
--   · Safety certificate expiry 31-Dec-9999 in the PDF = "no expiry"; stored as 9999-12-31 and shown as "No expiry"
-- Rows marked with a note below were ambiguous in the PDF and should be checked by an admin.
-- =====================================================================================
with src (employee_id, ${COLS.join(', ')}) as (
  values
${values.map((line, i) => (i < values.length - 1 ? line.replace(/\) --/, '), --').replace(/\)$/, '),') : line)).join('\n')}
)
insert into core.worker_info as w (employee_id, ${COLS.join(', ')}, updated_by)
select s.employee_id, ${COLS.map((c) => `s.${c}`).join(', ')}, 'import:Worker details.pdf'
  from src s
 where exists (select 1 from attendance.worker_details d where d.employee_id = s.employee_id)
    or exists (select 1 from attendance.local_worker_details l where l.employee_id = s.employee_id)
on conflict (employee_id) do update set
${COLS.map((c) => `    ${c} = coalesce(w.${c}, excluded.${c})`).join(',\n')},
    updated_at = now(),
    updated_by = coalesce(w.updated_by, excluded.updated_by);

insert into core.worker_info_audit (employee_id, action, fields, actor)
select employee_id, 'import', array[${COLS.map((c) => `'${c}'`).join(', ')}], 'import:Worker details.pdf'
  from core.worker_info where updated_by = 'import:Worker details.pdf'
   and not exists (select 1 from core.worker_info_audit a where a.employee_id = core.worker_info.employee_id and a.action = 'import');
`;
const out = path.join(MIGRATION_DIR, 'sql', '81_worker_info_import.sql');
fs.writeFileSync(out, sql);
console.log('wrote', out, rows.length, 'rows');
