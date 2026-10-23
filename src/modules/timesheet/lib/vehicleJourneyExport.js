/**
 * Completed vehicle journeys → Excel (one row per journey). Times in Singapore time.
 */
import ExcelJS from 'exceljs/dist/exceljs.bare.min.js';
import { savePdfBlob } from '@/modules/progress/lib/fileSave';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const sgt = (iso) => (iso ? new Date(new Date(iso).getTime() + 8 * 3600 * 1000) : null); // Excel has no zones: shift to SGT wall time

export async function downloadJourneysExcel(journeys, gps = {}, fileName = 'AKK-Vehicle-Journeys.xlsx') {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'AKK Engineering Pte. Ltd.';
    const ws = wb.addWorksheet('Journeys', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
        { header: 'Vehicle', key: 'vehicle', width: 14 },
        { header: 'Driver', key: 'driver', width: 28 },
        { header: 'Employee ID', key: 'id', width: 12 },
        { header: 'Started (SGT)', key: 'start', width: 20, style: { numFmt: 'dd mmm yyyy hh:mm' } },
        { header: 'Finished (SGT)', key: 'end', width: 20, style: { numFmt: 'dd mmm yyyy hh:mm' } },
        { header: 'Duration (h)', key: 'hours', width: 12, style: { numFmt: '0.00' } },
        { header: 'Distance (km)', key: 'km', width: 13, style: { numFmt: '0.00' } },
        { header: 'Avg speed (km/h)', key: 'avg', width: 15, style: { numFmt: '0.0' } },
        { header: 'Top speed (km/h)', key: 'top', width: 15, style: { numFmt: '0.0' } },
        { header: 'GPS points', key: 'pts', width: 11 },
        { header: 'Start location', key: 'from', width: 24 },
        { header: 'End location', key: 'to', width: 24 },
    ];
    const head = ws.getRow(1);
    head.eachCell((c) => {
        c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8C0D26' } };
    });
    const ll = (a, b) => (a != null && b != null ? `${Number(a).toFixed(5)}, ${Number(b).toFixed(5)}` : '');
    for (const j of journeys) {
        ws.addRow({
            vehicle: j.vehicles?.vehicle_number || '',
            driver: j.worker_name || '',
            id: j.worker_id,
            start: sgt(j.started_at),
            end: sgt(j.ended_at),
            hours: j.duration_seconds != null ? Number(j.duration_seconds) / 3600 : null,
            km: j.total_distance_km != null ? Number(j.total_distance_km) : null,
            avg: j.avg_speed_kmh != null ? Number(j.avg_speed_kmh) : null,
            top: j.top_speed_kmh != null ? Number(j.top_speed_kmh) : null,
            pts: gps[j.id]?.points ?? null,
            from: ll(j.start_latitude, j.start_longitude),
            to: ll(j.end_latitude, j.end_longitude),
        });
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
    const buffer = await wb.xlsx.writeBuffer();
    return savePdfBlob(new Blob([buffer], { type: XLSX_TYPE }), fileName);
}
