import { getFormDefinition } from './catalog';
import { RA_HIGH_THRESHOLD } from './constants';

/**
 * Compute auto-flag state from a form payload.
 * @returns {{ is_flagged: boolean, flag_reasons: string[] }}
 */
export function evaluateFormFlags(formKey, payload = {}) {
    const def = getFormDefinition(formKey);
    if (!def) return { is_flagged: false, flag_reasons: [] };

    const reasons = [];
    const answers = payload.checklist || {};
    const fields = payload.fields || {};
    const tableRows = payload.tableRows || [];

    // Checklist NOT OK / Pending items
    if (def.layout === 'checklist_steps' && def.sections?.length) {
        const badLabel = def.answerMode === 'done_pending' ? 'pending' : 'not_ok';
        const human = def.answerMode === 'done_pending' ? 'Pending' : 'NOT OK';
        let badCount = 0;
        for (const sec of def.sections) {
            for (const item of sec.items) {
                if (answers[item.key] === badLabel) badCount += 1;
            }
        }
        if (badCount > 0) {
            reasons.push(`${badCount} checklist item(s) marked ${human}`);
        }
    }

    // Vehicle Not Safe
    if (formKey === 'vehicle_daily_checklist') {
        const overall = fields.overall_safe || payload.fields?.overall_safe;
        if (String(overall).toLowerCase() === 'not safe') {
            reasons.push('Vehicle marked Not Safe');
        }
    }

    // RA High hazards
    if (formKey === 'risk_assessment') {
        const high = tableRows.filter((row) => {
            const l = Number(row.likelihood);
            const s = Number(row.severity);
            return Number.isFinite(l) && Number.isFinite(s) && l * s >= RA_HIGH_THRESHOLD;
        });
        if (high.length > 0) {
            reasons.push(`${high.length} hazard(s) rated High`);
        }
    }

    // Incident medical leave or worse
    if (formKey === 'incident_report') {
        const sev = String(fields.injury_severity || '');
        if (sev === 'Medical Leave' || sev === 'Hospitalization') {
            reasons.push(`Injury severity: ${sev}`);
        }
    }

    // GRN damaged / short-shipped
    if (formKey === 'goods_received') {
        const bad = tableRows.filter((r) =>
            ['Damaged', 'Short-shipped'].includes(r.condition)
        );
        if (bad.length > 0) {
            reasons.push(`${bad.length} GRN line(s) damaged or short-shipped`);
        }
    }

    // Tools damaged / missing
    if (formKey === 'tools_issuance') {
        const bad = tableRows.filter((r) =>
            ['Damaged', 'Missing'].includes(r.condition)
        );
        if (bad.length > 0) {
            reasons.push(`${bad.length} tool(s) damaged or missing`);
        }
    }

    // Vehicle Off Road maintenance
    if (formKey === 'vehicle_maintenance') {
        if (String(fields.urgency || '').includes('Vehicle Off Road')) {
            reasons.push('Maintenance urgency: Vehicle Off Road');
        }
    }

    return {
        is_flagged: reasons.length > 0,
        flag_reasons: reasons,
    };
}

export function riskBand(likelihood, severity) {
    const score = Number(likelihood) * Number(severity);
    if (!Number.isFinite(score) || score <= 0) return { score: null, band: '—' };
    if (score >= RA_HIGH_THRESHOLD) return { score, band: 'High' };
    if (score >= 8) return { score, band: 'Medium' };
    return { score, band: 'Low' };
}
