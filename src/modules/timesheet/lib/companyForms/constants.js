export const DEPARTMENTS = [
    { key: 'safety', label: 'Safety Department' },
    { key: 'transport', label: 'Transport Department' },
    { key: 'electrical', label: 'Electrical Works' },
    { key: 'fire', label: 'Fire Protection Works' },
    { key: 'hr', label: 'HR Department' },
    { key: 'accounts', label: 'Accounts Department' },
    { key: 'store', label: 'Store / Inventory Department' },
    { key: 'engineering', label: 'Engineering Department' },
    { key: 'contract', label: 'Contract / Tender Department' },
    { key: 'management', label: 'Top Management' },
];

export const LAYOUT = {
    CHECKLIST_STEPS: 'checklist_steps',
    SINGLE: 'single',
    SINGLE_WITH_TABLE: 'single_with_table',
};

export const SUBMISSION_STATUS = {
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
};

/** RA matrix: High when likelihood × severity >= 15 (max 25). */
export const RA_HIGH_THRESHOLD = 15;

export const VENDOR_EVAL_CRITERIA = [
    'Quality',
    'Timeliness',
    'Safety Compliance',
    'Pricing',
    'Workmanship',
];

/** Default recommended results for reviewers after a form is submitted. */
export const DEFAULT_RECOMMENDED_RESULTS = [
    'Cleared to proceed',
    'Approved with conditions',
    'Rectify and resubmit',
    'Monitor / follow up',
    'Escalate to management',
    'Vehicle / equipment off road',
    'Not accepted',
];
