/**
 * Worker details as an Excel sheet: just the details — no ID card. One row per worker (any number of
 * workers), Employee ID + Name first, then the chosen details in the same order as the picker.
 * Dates are real dates, money and numbers are real numbers (sortable / filterable), the header row is
 * frozen with filters on.
 */
import ExcelJS from 'exceljs/dist/exceljs.bare.min.js';
import { savePdfBlob } from '@/modules/progress/lib/fileSave';
import { EXPORT_FIELDS, GROUPS, formatValue } from './fields';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const BRAND = 'FF8C0D26';

function typed(def, value) {
    if (value == null || value === '') return null;
    if (def.kind === 'date' && /^\d{4}-\d{2}-\d{2}/.test(String(value))) {
        if (String(value).startsWith('9999')) return 'No expiry';
        const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d));
    }
    if ((def.kind === 'money' || def.kind === 'num') && Number.isFinite(Number(value))) return Number(value);
    return formatValue(def.key, value);
}

/**
 * @param {Array<{card: object, values: object}>} workers rows from core.admin_export_workers
 * @param {string[]} fields selected field keys
 * @param {string} fileName
 * @param {object[]} [defs] field definitions (catalogue + custom)
 */
export async function downloadWorkerInfoExcel(workers, fields, fileName, defs = EXPORT_FIELDS) {
    const order = GROUPS.flatMap((g) => defs.filter((f) => f.group === g.key));
    const cols = order.filter((f) => fields.includes(f.key) && f.key !== 'employee_id' && f.key !== 'name');

    const wb = new ExcelJS.Workbook();
    wb.creator = 'AKK Engineering Pte. Ltd.';
    wb.created = new Date();
    const ws = wb.addWorksheet('Employees', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
    ws.columns = [
        { header: 'Employee ID', key: 'employee_id', width: 13 },
        { header: 'Name', key: 'name', width: 30 },
        ...cols.map((f) => ({
            header: f.label,
            key: f.key,
            width: f.kind === 'textarea' || f.key === 'address' ? 42 : Math.min(34, Math.max(14, f.label.length + 4)),
            style: f.kind === 'date' ? { numFmt: 'dd mmm yyyy' } : f.kind === 'money' ? { numFmt: '"S$" #,##0.00' } : {},
        })),
    ];
    const head = ws.getRow(1);
    head.height = 26;
    head.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
        cell.alignment = { vertical: 'middle', wrapText: true };
    });

    for (const { card, values } of workers) {
        const row = { employee_id: card.employee_id, name: card.name };
        for (const f of cols) row[f.key] = typed(f, values?.[f.key]);
        ws.addRow(row);
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
    ws.eachRow((r, n) => {
        if (n > 1) r.alignment = { vertical: 'top', wrapText: true };
    });

    const buffer = await wb.xlsx.writeBuffer();
    return savePdfBlob(new Blob([buffer], { type: XLSX_TYPE }), fileName);
}
