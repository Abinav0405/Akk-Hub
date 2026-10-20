import { LAYOUT, VENDOR_EVAL_CRITERIA } from './constants';

const f = (key, label, type = 'text', opts = {}) => ({
    key,
    label,
    type,
    required: opts.required !== false,
    auto: opts.auto || null,
    options: opts.options || null,
    placeholder: opts.placeholder || null,
});

const section = (key, title, items) => ({
    key,
    title,
    items: items.map((label, i) => ({
        key: `${key}_${i + 1}`,
        label,
    })),
});

const checklistForm = ({
    key,
    title,
    department,
    fields,
    sections,
    answerMode = 'ok_not_ok',
    extraFields = [],
}) => ({
    key,
    title,
    department,
    layout: LAYOUT.CHECKLIST_STEPS,
    fields,
    sections,
    answerMode,
    extraFields,
    table: null,
});

const singleForm = ({ key, title, department, fields }) => ({
    key,
    title,
    department,
    layout: LAYOUT.SINGLE,
    fields,
    sections: [],
    answerMode: null,
    extraFields: [],
    table: null,
});

const tableForm = ({ key, title, department, fields, table }) => ({
    key,
    title,
    department,
    layout: LAYOUT.SINGLE_WITH_TABLE,
    fields,
    sections: [],
    answerMode: null,
    extraFields: [],
    table,
});

const DATE = (key = 'date', label = 'Date') => f(key, label, 'date');
const WORKSITE = f('worksite', 'Worksite');
const PROJECT = f('project', 'Project');

/** @type {Record<string, object>} */
export const FORM_CATALOG = {
    // ── Safety ──────────────────────────────────────────────
    site_safety_inspection: checklistForm({
        key: 'site_safety_inspection',
        title: 'Site Safety Inspection',
        department: 'safety',
        fields: [
            DATE(),
            WORKSITE,
            f('inspector', 'Inspector', 'text', { auto: 'worker_name' }),
        ],
        sections: [
            section('housekeeping', 'Housekeeping', [
                'Walkways clear',
                'Materials stacked safely',
                'Waste disposed',
                'Work areas tidy',
            ]),
            section('ppe', 'PPE', [
                'Helmets',
                'Safety shoes',
                'Hi-vis vests',
                'Fall arrest harness',
                'PPE for hot/electrical works',
            ]),
            section('access', 'Access & Scaffolding', [
                'Scaffold tagged',
                'Guardrails and toe boards',
                'Ladders secured',
                'Openings covered',
            ]),
            section('electrical', 'Electrical', [
                'Temporary wiring insulated',
                'DB boards secured',
                'ELCB in place',
                'Cables off the ground',
            ]),
            section('fire', 'Fire', [
                'Extinguishers in date',
                'Fire points clear',
                'Exits and assembly points marked',
                'Hot work permits displayed',
            ]),
            section('signage', 'Signage', [
                'Warning signs',
                'Barricades',
                'Excavations barricaded',
            ]),
            section('machinery', 'Machinery', [
                'Lifting certificates valid',
                'Guards intact',
                'Operators certified',
                'No damage or leaks',
            ]),
        ],
    }),

    ppe_compliance: checklistForm({
        key: 'ppe_compliance',
        title: 'PPE Compliance Checklist',
        department: 'safety',
        fields: [
            DATE(),
            WORKSITE,
            f('workers_crew', 'Worker(s) / Crew'),
        ],
        sections: [
            section('ppe_items', 'PPE Items', [
                'Helmet',
                'Safety shoes',
                'Hi-vis',
                'Gloves',
                'Eye protection',
                'Hearing protection',
                'Harness anchored',
                'Respiratory protection',
                'PPE condition',
            ]),
        ],
    }),

    toolbox_meeting: tableForm({
        key: 'toolbox_meeting',
        title: 'Toolbox Meeting Record',
        department: 'safety',
        fields: [
            DATE(),
            f('time', 'Time', 'time'),
            WORKSITE,
            f('conducted_by', 'Conducted By', 'text', { auto: 'worker_name' }),
            f('topics', 'Topics Discussed', 'textarea'),
        ],
        table: {
            key: 'attendance',
            label: 'Attendance',
            minRows: 1,
            columns: [
                { key: 'name', label: 'Name', type: 'text' },
                { key: 'trade_company', label: 'Trade / Company', type: 'text' },
                {
                    key: 'acknowledged',
                    label: 'Acknowledged',
                    type: 'select',
                    options: ['Yes', 'No'],
                },
            ],
        },
    }),

    risk_assessment: tableForm({
        key: 'risk_assessment',
        title: 'Risk Assessment (RA)',
        department: 'safety',
        fields: [
            f('activity', 'Activity'),
            f('location', 'Location'),
            f('assessed_by', 'Assessed By', 'text', { auto: 'worker_name' }),
            DATE(),
            f('next_review_date', 'Next Review Date', 'date'),
        ],
        table: {
            key: 'hazards',
            label: 'Hazards',
            minRows: 1,
            columns: [
                { key: 'hazard', label: 'Hazard', type: 'text' },
                { key: 'who_harmed', label: 'Who May Be Harmed', type: 'text' },
                { key: 'existing_controls', label: 'Existing Controls', type: 'text' },
                {
                    key: 'likelihood',
                    label: 'Likelihood (1-5)',
                    type: 'select',
                    options: ['1', '2', '3', '4', '5'],
                },
                {
                    key: 'severity',
                    label: 'Severity (1-5)',
                    type: 'select',
                    options: ['1', '2', '3', '4', '5'],
                },
                { key: 'additional_controls', label: 'Additional Controls', type: 'text' },
            ],
            computed: { risk_rating: 'likelihood_x_severity' },
        },
    }),

    permit_to_work: singleForm({
        key: 'permit_to_work',
        title: 'Permit to Work (PTW)',
        department: 'safety',
        fields: [
            f('type', 'Type', 'select', {
                options: [
                    'Hot Work',
                    'Work at Height',
                    'Confined Space',
                    'Electrical Isolation',
                    'General',
                ],
            }),
            f('location', 'Location'),
            f('description', 'Description', 'textarea'),
            f('permit_date', 'Permit Date', 'date'),
            f('valid_from', 'Valid From', 'datetime-local'),
            f('valid_to', 'Valid To', 'datetime-local'),
            f('requested_by', 'Requested By', 'text', { auto: 'worker_name' }),
            f('workers_involved', 'Workers Involved', 'textarea'),
            f('precaution_ra', 'RA available', 'yes_no'),
            f('precaution_barricaded', 'Area barricaded', 'yes_no'),
            f('precaution_ppe', 'PPE worn', 'yes_no'),
            f('precaution_fire_watch', 'Fire watch', 'yes_no'),
            f('precaution_loto', 'LOTO applied', 'yes_no'),
            f('precaution_gas_test', 'Gas test', 'yes_no'),
            f('precaution_fall', 'Fall protection', 'yes_no'),
            f('precaution_briefing', 'Emergency briefing', 'yes_no'),
            f('precaution_displayed', 'Permit displayed', 'yes_no'),
        ],
    }),

    incident_report: singleForm({
        key: 'incident_report',
        title: 'Incident / Accident Report',
        department: 'safety',
        fields: [
            DATE(),
            f('time', 'Time', 'time'),
            f('location', 'Location'),
            f('type', 'Type', 'select', {
                options: [
                    'Injury',
                    'Property Damage',
                    'Dangerous Occurrence',
                    'Environmental',
                    'Other',
                ],
            }),
            f('persons_involved', 'Persons Involved', 'textarea'),
            f('description', 'Description', 'textarea'),
            f('immediate_action', 'Immediate Action', 'textarea'),
            f('injury_severity', 'Injury Severity', 'select', {
                options: ['None', 'First Aid', 'Medical Leave', 'Hospitalization'],
            }),
            f('witnesses', 'Witnesses', 'textarea', { required: false }),
            f('reported_by', 'Reported By', 'text', { auto: 'worker_name' }),
        ],
    }),

    near_miss: singleForm({
        key: 'near_miss',
        title: 'Near Miss Report',
        department: 'safety',
        fields: [
            DATE(),
            f('location', 'Location'),
            f('what_happened', 'What Happened', 'textarea'),
            f('potential_consequence', 'Potential Consequence', 'textarea'),
            f('immediate_action', 'Immediate Action', 'textarea'),
            f('reported_by', 'Reported By', 'text', { auto: 'worker_name' }),
        ],
    }),

    // ── Transport ───────────────────────────────────────────
    vehicle_daily_checklist: checklistForm({
        key: 'vehicle_daily_checklist',
        title: 'Vehicle Daily Checklist',
        department: 'transport',
        fields: [
            DATE(),
            f('vehicle_type', 'Vehicle Type'),
            f('vehicle_no', 'Vehicle No.'),
            f('mileage', 'Mileage', 'number'),
            WORKSITE,
        ],
        sections: [
            section('documents', 'Documents', [
                'Licence',
                'Log card',
                'Road tax',
                'Insurance',
                'VICOM certificate',
                'Company decal',
            ]),
            section('engine', 'Engine & Fluids', [
                'Oil',
                'Coolant',
                'Brake fluid',
                'Fuel',
                'Battery',
                'Noise or smoke',
            ]),
            section('tyres', 'Tyres & Brakes', [
                'Tyre condition',
                'Pressure',
                'Wheel nuts',
                'Foot brake',
                'Handbrake',
                'Spare / jack / spanner',
            ]),
            section('lights', 'Lights & Mirrors', [
                'Head / tail / brake lights',
                'Indicators',
                'Reverse light and alarm',
                'Mirrors',
                'Horn',
                'Windscreen and wipers',
            ]),
            section('cargo', 'Cargo', [
                'Deck clean',
                'Load secured',
                'Tailgate and doors',
                'Within payload',
                'Tarpaulin or net',
            ]),
            section('safety_eq', 'Safety Equipment', [
                'Extinguisher',
                'First aid',
                'Chocks / triangle',
                'Seatbelts',
                'PPE',
            ]),
            section('body', 'Body & Cabin', [
                'Doors and windows',
                'Seats',
                'Chassis damage',
                'Number plates',
            ]),
        ],
        extraFields: [
            f('overall_safe', 'Overall vehicle condition', 'select', {
                options: ['Safe', 'Not Safe'],
            }),
        ],
    }),

    trip_journey_log: singleForm({
        key: 'trip_journey_log',
        title: 'Trip / Journey Log',
        department: 'transport',
        fields: [
            DATE(),
            f('driver', 'Driver', 'text', { auto: 'worker_name' }),
            f('vehicle_no', 'Vehicle No.'),
            f('purpose', 'Purpose'),
            f('start_location', 'Start Location'),
            f('end_location', 'End Location'),
            f('start_time', 'Start Time', 'time'),
            f('end_time', 'End Time', 'time'),
            f('start_mileage', 'Start Mileage', 'number'),
            f('end_mileage', 'End Mileage', 'number'),
        ],
    }),

    vehicle_maintenance: singleForm({
        key: 'vehicle_maintenance',
        title: 'Vehicle Maintenance / Repair Request',
        department: 'transport',
        fields: [
            DATE(),
            f('vehicle_no', 'Vehicle No.'),
            f('requested_by', 'Requested By', 'text', { auto: 'worker_name' }),
            f('urgency', 'Urgency', 'select', {
                options: ['Normal', 'Urgent – Vehicle Off Road'],
            }),
            f('issue_description', 'Issue Description', 'textarea'),
        ],
    }),

    fuel_log: singleForm({
        key: 'fuel_log',
        title: 'Fuel Log',
        department: 'transport',
        fields: [
            DATE(),
            f('vehicle_no', 'Vehicle No.'),
            f('driver', 'Driver', 'text', { auto: 'worker_name' }),
            f('odometer', 'Odometer', 'number'),
            f('litres', 'Litres', 'number'),
            f('cost', 'Cost', 'number'),
            f('fuel_station', 'Fuel Station'),
        ],
    }),

    // ── Electrical ──────────────────────────────────────────
    electrical_test_inspection: checklistForm({
        key: 'electrical_test_inspection',
        title: 'Electrical Installation Test & Inspection',
        department: 'electrical',
        fields: [
            DATE(),
            PROJECT,
            f('panel_circuit_ref', 'Panel / Circuit Ref'),
            f('tester', 'Tester', 'text', { auto: 'worker_name' }),
        ],
        sections: [
            section('visual', 'Visual', [
                'Cable sizing and labels',
                'Conduits secured',
                'Enclosures undamaged',
                'Earthing connected',
                'Circuit schedule updated',
            ]),
            section('testing', 'Testing', [
                'Insulation resistance',
                'Earth continuity',
                'Polarity',
                'RCD trip',
                'Phase rotation',
            ]),
            section('documents', 'Documents', [
                'Test results recorded',
                'As-builts updated',
                'LEW endorsement',
                'Authority notification',
            ]),
        ],
    }),

    switchboard_db_checklist: checklistForm({
        key: 'switchboard_db_checklist',
        title: 'Switchboard / DB Installation Checklist',
        department: 'electrical',
        fields: [
            DATE(),
            f('location', 'Location'),
            f('db_reference', 'DB Reference'),
            f('inspector', 'Inspector', 'text', { auto: 'worker_name' }),
        ],
        sections: [
            section('installation', 'Installation', [
                'Mounted level',
                'IP rating',
                'MCB / MCCB ratings',
                'Bus-bar torque',
                'Cable glands sealed',
            ]),
            section('safety', 'Safety', [
                'Interlocks',
                'Danger labels',
                'Single-line diagram',
                'Arc-flash label',
            ]),
            section('signoff', 'Sign-off', [
                'Megger test',
                'Energized and load-tested',
                'Client walk-through',
            ]),
        ],
    }),

    electrical_handover: checklistForm({
        key: 'electrical_handover',
        title: 'Electrical Works Completion / Handover',
        department: 'electrical',
        fields: [
            DATE(),
            PROJECT,
            f('handed_over_to', 'Handed Over To'),
        ],
        sections: [
            section('completion', 'Completion', [
                'Circuits commissioned',
                'As-builts',
                'O&M manuals',
                'Test certificates',
                'Punch list closed',
            ]),
            section('handover', 'Handover', [
                'Client walk-through',
                'Keys and access cards',
                'Warranty explained',
                'Training given',
            ]),
        ],
    }),

    // ── Fire ────────────────────────────────────────────────
    fire_system_installation: checklistForm({
        key: 'fire_system_installation',
        title: 'Fire Protection System Installation',
        department: 'fire',
        fields: [
            DATE(),
            PROJECT,
            f('inspector', 'Inspector', 'text', { auto: 'worker_name' }),
        ],
        sections: [
            section('sprinkler', 'Sprinkler', [
                'Pipe routing',
                'Correct heads',
                'Hangers and supports',
                'Flow / tamper switches',
            ]),
            section('alarm', 'Fire Alarm', [
                'Detectors per layout',
                'Call points accessible',
                'Panel addressed',
                'Zones labeled',
            ]),
            section('general', 'General', [
                'Penetrations sealed',
                'Signage and mounting',
                'Maintenance access',
            ]),
        ],
    }),

    fire_alarm_commissioning: checklistForm({
        key: 'fire_alarm_commissioning',
        title: 'Fire Alarm / Sprinkler Testing & Commissioning',
        department: 'fire',
        fields: [
            DATE(),
            PROJECT,
            f('system_type', 'System Type', 'select', {
                options: ['Fire Alarm', 'Sprinkler', 'Both'],
            }),
            f('commissioning_engineer', 'Commissioning Engineer', 'text', {
                auto: 'worker_name',
            }),
        ],
        sections: [
            section('alarm', 'Alarm', [
                'Detectors',
                'Call points',
                'Sounders and strobes',
                'Panel faults',
                'Interface tests',
            ]),
            section('sprinkler', 'Sprinkler', [
                'Flow switch',
                'Main / alarm valve',
                'System pressure',
                'Pump sequence',
            ]),
            section('signoff', 'Sign-off', [
                'Results recorded',
                'Authority submission',
                'Client acceptance',
            ]),
        ],
    }),

    fire_extinguisher: checklistForm({
        key: 'fire_extinguisher',
        title: 'Fire Extinguisher Inspection',
        department: 'fire',
        fields: [
            DATE(),
            f('location', 'Location'),
            f('inspector', 'Inspector', 'text', { auto: 'worker_name' }),
        ],
        sections: [
            section('items', 'Inspection Items', [
                'Present',
                'Gauge in green',
                'Pin and seal intact',
                'No damage',
                'Tag up to date',
                'Signage visible',
                'Access clear',
            ]),
        ],
    }),

    // ── HR (no Leave Application) ───────────────────────────
    onboarding_checklist: checklistForm({
        key: 'onboarding_checklist',
        title: 'Employee Onboarding Checklist',
        department: 'hr',
        answerMode: 'done_pending',
        fields: [
            DATE(),
            f('employee_name', 'Employee Name'),
            f('department_name', 'Department'),
            f('start_date', 'Start Date', 'date'),
        ],
        sections: [
            section('items', 'Onboarding Items', [
                'Contract signed',
                'Work pass',
                'Induction',
                'Safety induction',
                'PPE issued',
                'Assets issued',
                'Bank details',
                'Emergency contact',
                'Access card',
            ]),
        ],
    }),

    exit_clearance: checklistForm({
        key: 'exit_clearance',
        title: 'Exit Clearance Checklist',
        department: 'hr',
        answerMode: 'done_pending',
        fields: [
            DATE(),
            f('employee_name', 'Employee Name'),
            f('department_name', 'Department'),
            f('last_working_day', 'Last Working Day', 'date'),
        ],
        sections: [
            section('items', 'Exit Items', [
                'Resignation letter',
                'Handover',
                'Property returned',
                'Access revoked',
                'Claims settled',
                'Final pay and CPF',
                'Exit interview',
            ]),
        ],
    }),

    // ── Accounts ────────────────────────────────────────────
    petty_cash: tableForm({
        key: 'petty_cash',
        title: 'Petty Cash / Expense Claim',
        department: 'accounts',
        fields: [
            DATE(),
            f('requested_by', 'Requested By', 'text', { auto: 'worker_name' }),
            f('department_name', 'Department'),
            f('purpose', 'Purpose', 'textarea'),
        ],
        table: {
            key: 'lines',
            label: 'Expense lines',
            minRows: 1,
            columns: [
                { key: 'description', label: 'Description', type: 'text' },
                { key: 'amount', label: 'Amount', type: 'number' },
            ],
        },
    }),

    purchase_requisition: tableForm({
        key: 'purchase_requisition',
        title: 'Purchase Requisition',
        department: 'accounts',
        fields: [
            DATE(),
            f('requested_by', 'Requested By', 'text', { auto: 'worker_name' }),
            f('department_name', 'Department'),
            f('justification', 'Justification', 'textarea'),
        ],
        table: {
            key: 'lines',
            label: 'Items',
            minRows: 1,
            columns: [
                { key: 'item', label: 'Item', type: 'text' },
                { key: 'qty', label: 'Qty', type: 'number' },
                { key: 'estimated_cost', label: 'Estimated Cost', type: 'number' },
            ],
        },
    }),

    payment_invoice: singleForm({
        key: 'payment_invoice',
        title: 'Payment / Invoice Approval',
        department: 'accounts',
        fields: [
            DATE(),
            f('vendor', 'Vendor'),
            f('invoice_no', 'Invoice No.'),
            f('amount', 'Amount', 'number'),
            f('due_date', 'Due Date', 'date'),
            f('description', 'Description', 'textarea'),
        ],
    }),

    // ── Store ───────────────────────────────────────────────
    material_request: tableForm({
        key: 'material_request',
        title: 'Material Request Form (MRF)',
        department: 'store',
        fields: [
            DATE(),
            f('requested_by', 'Requested By', 'text', { auto: 'worker_name' }),
            PROJECT,
            f('urgency', 'Urgency', 'select', {
                options: ['Low', 'Normal', 'High'],
            }),
        ],
        table: {
            key: 'lines',
            label: 'Materials',
            minRows: 1,
            columns: [
                { key: 'item', label: 'Item', type: 'text' },
                { key: 'qty', label: 'Qty', type: 'number' },
                { key: 'unit', label: 'Unit', type: 'text' },
                { key: 'purpose', label: 'Purpose', type: 'text' },
            ],
        },
    }),

    goods_received: tableForm({
        key: 'goods_received',
        title: 'Goods Received Note (GRN)',
        department: 'store',
        fields: [
            DATE(),
            f('supplier', 'Supplier'),
            f('po_number', 'PO Number'),
            f('received_by', 'Received By', 'text', { auto: 'worker_name' }),
        ],
        table: {
            key: 'lines',
            label: 'Goods',
            minRows: 1,
            columns: [
                { key: 'item', label: 'Item', type: 'text' },
                { key: 'qty_ordered', label: 'Qty Ordered', type: 'number' },
                { key: 'qty_received', label: 'Qty Received', type: 'number' },
                {
                    key: 'condition',
                    label: 'Condition',
                    type: 'select',
                    options: ['Good', 'Damaged', 'Short-shipped'],
                },
            ],
        },
    }),

    tools_issuance: tableForm({
        key: 'tools_issuance',
        title: 'Tools & Equipment Issuance / Return',
        department: 'store',
        fields: [
            DATE(),
            f('employee', 'Employee', 'text', { auto: 'worker_name' }),
            f('direction', 'Direction', 'select', {
                options: ['Issued', 'Returned'],
            }),
        ],
        table: {
            key: 'lines',
            label: 'Tools',
            minRows: 1,
            columns: [
                { key: 'item', label: 'Item', type: 'text' },
                { key: 'serial_asset_no', label: 'Serial / Asset No.', type: 'text' },
                {
                    key: 'condition',
                    label: 'Condition',
                    type: 'select',
                    options: ['Good', 'Damaged', 'Missing'],
                },
            ],
        },
    }),

    // ── Engineering ─────────────────────────────────────────
    technical_query: singleForm({
        key: 'technical_query',
        title: 'Technical Query / RFI',
        department: 'engineering',
        fields: [
            DATE(),
            PROJECT,
            f('subject', 'Subject'),
            f('urgency', 'Urgency', 'select', {
                options: ['Low', 'Medium', 'High'],
            }),
            f('raised_by', 'Raised By', 'text', { auto: 'worker_name' }),
            f('query_details', 'Query Details', 'textarea'),
        ],
    }),

    material_submission: singleForm({
        key: 'material_submission',
        title: 'Material Submission Approval',
        department: 'engineering',
        fields: [
            DATE(),
            PROJECT,
            f('material_description', 'Material Description', 'textarea'),
            f('specification_reference', 'Specification Reference'),
            f('supplier_manufacturer', 'Supplier / Manufacturer'),
            f('submitted_by', 'Submitted By', 'text', { auto: 'worker_name' }),
        ],
    }),

    method_statement: singleForm({
        key: 'method_statement',
        title: 'Method Statement Approval',
        department: 'engineering',
        fields: [
            DATE(),
            PROJECT,
            f('activity', 'Activity'),
            f('prepared_by', 'Prepared By', 'text', { auto: 'worker_name' }),
            f('method_sequence', 'Method / Sequence of Work', 'textarea'),
        ],
    }),

    // ── Contract ────────────────────────────────────────────
    tender_checklist: checklistForm({
        key: 'tender_checklist',
        title: 'Tender Submission Checklist',
        department: 'contract',
        answerMode: 'done_pending',
        fields: [
            DATE(),
            f('tender_title', 'Tender Title'),
            f('prepared_by', 'Prepared By', 'text', { auto: 'worker_name' }),
            f('deadline', 'Deadline', 'date'),
        ],
        sections: [
            section('items', 'Tender Items', [
                'BOQ completed',
                'Drawings and specs attached',
                'Pricing verified',
                'Bid bond',
                'Certificates compiled',
                'Management sign-off',
                'Deadline confirmed',
                'Documents submitted',
            ]),
        ],
    }),

    variation_order: singleForm({
        key: 'variation_order',
        title: 'Variation Order (VO) Request',
        department: 'contract',
        fields: [
            DATE(),
            PROJECT,
            f('vo_no', 'VO No.'),
            f('description', 'Description', 'textarea'),
            f('reason', 'Reason', 'textarea'),
            f('estimated_cost', 'Estimated Cost', 'number'),
            f('requested_by', 'Requested By', 'text', { auto: 'worker_name' }),
        ],
    }),

    vendor_evaluation: tableForm({
        key: 'vendor_evaluation',
        title: 'Subcontractor / Vendor Evaluation',
        department: 'contract',
        fields: [
            DATE(),
            f('vendor_name', 'Vendor Name'),
            PROJECT,
            f('evaluated_by', 'Evaluated By', 'text', { auto: 'worker_name' }),
        ],
        table: {
            key: 'criteria',
            label: 'Evaluation criteria',
            minRows: VENDOR_EVAL_CRITERIA.length,
            defaultRows: VENDOR_EVAL_CRITERIA.map((criterion) => ({
                criterion,
                score: '',
                remarks: '',
            })),
            columns: [
                { key: 'criterion', label: 'Criterion', type: 'text' },
                {
                    key: 'score',
                    label: 'Score (1-5)',
                    type: 'select',
                    options: ['1', '2', '3', '4', '5'],
                },
                { key: 'remarks', label: 'Remarks', type: 'text' },
            ],
        },
    }),

    // ── Top Management ──────────────────────────────────────
    management_review: tableForm({
        key: 'management_review',
        title: 'Management Review Action Items',
        department: 'management',
        fields: [
            DATE(),
            f('attendees', 'Attendees', 'textarea'),
            f('key_decisions', 'Key Decisions', 'textarea'),
        ],
        table: {
            key: 'actions',
            label: 'Action items',
            minRows: 1,
            columns: [
                { key: 'action', label: 'Action', type: 'text' },
                { key: 'owner', label: 'Owner', type: 'text' },
                { key: 'due_date', label: 'Due Date', type: 'date' },
                {
                    key: 'status',
                    label: 'Status',
                    type: 'select',
                    options: ['Open', 'In Progress', 'Closed'],
                },
            ],
        },
    }),

    budget_capex: singleForm({
        key: 'budget_capex',
        title: 'Budget / CAPEX Approval Request',
        department: 'management',
        fields: [
            DATE(),
            f('department_name', 'Department'),
            f('purpose', 'Purpose'),
            f('amount', 'Amount', 'number'),
            f('justification', 'Justification', 'textarea'),
            f('requested_by', 'Requested By', 'text', { auto: 'worker_name' }),
        ],
    }),

    policy_approval: singleForm({
        key: 'policy_approval',
        title: 'Policy Approval / Sign-off',
        department: 'management',
        fields: [
            DATE(),
            f('policy_title', 'Policy Title'),
            f('prepared_by', 'Prepared By', 'text', { auto: 'worker_name' }),
            f('effective_date', 'Effective Date', 'date'),
            f('summary', 'Summary', 'textarea'),
        ],
    }),
};

export const ALL_FORM_KEYS = Object.keys(FORM_CATALOG);

export function getFormDefinition(formKey) {
    return FORM_CATALOG[formKey] || null;
}

export function listFormsByDepartment(departmentKey) {
    return Object.values(FORM_CATALOG).filter((f) => f.department === departmentKey);
}

export function getDepartmentLabel(departmentKey) {
    const map = {
        safety: 'Safety Department',
        transport: 'Transport Department',
        electrical: 'Electrical Works',
        fire: 'Fire Protection Works',
        hr: 'HR Department',
        accounts: 'Accounts Department',
        store: 'Store / Inventory Department',
        engineering: 'Engineering Department',
        contract: 'Contract / Tender Department',
        management: 'Top Management',
    };
    return map[departmentKey] || departmentKey;
}
