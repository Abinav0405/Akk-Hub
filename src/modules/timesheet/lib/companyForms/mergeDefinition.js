import { getFormDefinition } from './catalog';

function trimLabel(value, fallback) {
    const t = String(value ?? '').trim();
    return t || fallback;
}

/**
 * Apply DB questions_override onto a catalog definition.
 * Only titles/labels change — keys, types, options, and layout stay fixed.
 */
export function mergeDefinitionWithOverride(base, override) {
    if (!base) return null;
    const o = override && typeof override === 'object' ? override : {};

    const fields = (base.fields || []).map((field) => ({
        ...field,
        label: trimLabel(o.fields?.[field.key], field.label),
    }));

    const extraFields = (base.extraFields || []).map((field) => ({
        ...field,
        label: trimLabel(o.extraFields?.[field.key], field.label),
    }));

    const sections = (base.sections || []).map((sec) => {
        const secO = o.sections?.[sec.key] || {};
        return {
            ...sec,
            title: trimLabel(secO.title, sec.title),
            items: (sec.items || []).map((item) => ({
                ...item,
                label: trimLabel(secO.items?.[item.key], item.label),
            })),
        };
    });

    let table = base.table;
    if (table) {
        const tO = o.table || {};
        table = {
            ...table,
            label: trimLabel(tO.label, table.label),
            columns: (table.columns || []).map((col) => ({
                ...col,
                label: trimLabel(tO.columns?.[col.key], col.label),
            })),
            defaultRows: table.defaultRows
                ? table.defaultRows.map((row) => ({ ...row }))
                : table.defaultRows,
        };
    }

    return {
        ...base,
        title: trimLabel(o.title, base.title),
        fields,
        extraFields,
        sections,
        table,
    };
}

/** Build a questions_override object from an edited definition (labels only). */
export function buildQuestionsOverrideFromDefinition(definition) {
    if (!definition) return {};
    const override = {
        title: definition.title,
        fields: {},
        extraFields: {},
        sections: {},
        table: null,
    };

    for (const field of definition.fields || []) {
        override.fields[field.key] = field.label;
    }
    for (const field of definition.extraFields || []) {
        override.extraFields[field.key] = field.label;
    }
    for (const sec of definition.sections || []) {
        override.sections[sec.key] = {
            title: sec.title,
            items: {},
        };
        for (const item of sec.items || []) {
            override.sections[sec.key].items[item.key] = item.label;
        }
    }
    if (definition.table) {
        override.table = {
            label: definition.table.label,
            columns: {},
        };
        for (const col of definition.table.columns || []) {
            override.table.columns[col.key] = col.label;
        }
    }

    return override;
}

/** Snapshot of editable labels from the stock catalog (for reset / editor seed). */
export function getEditableQuestionsSnapshot(formKey) {
    const base = getFormDefinition(formKey);
    if (!base) return null;
    return buildQuestionsOverrideFromDefinition(base);
}

export function resolveFormDefinition(formKey, questionsOverride = null) {
    const base = getFormDefinition(formKey);
    if (!base) return null;
    return mergeDefinitionWithOverride(base, questionsOverride);
}
