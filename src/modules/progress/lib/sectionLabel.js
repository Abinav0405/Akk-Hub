export const DEFAULT_SECTION_LABEL = 'LCB';

export function normalizeSectionLabel(value) {
  const label = String(value || '').trim();
  return label || DEFAULT_SECTION_LABEL;
}

/** e.g. LCB-57 or TR-12 */
export function formatSectionRef(label, id) {
  const value = String(id || '').trim();
  if (!value) return '';
  return `${normalizeSectionLabel(label)}-${value}`;
}

export function sectionIdFieldLabel(label) {
  return normalizeSectionLabel(label);
}

/** Excel header from the package itself, e.g. "POLE NO : Lp-26". */
export function formatExcelSectionLine(sectionLabel, id) {
  const name = String(sectionLabel || '').trim();
  const value = String(id || '').trim();
  if (name && value) return `${name.toUpperCase()} : ${value}`;
  if (name) return `${name.toUpperCase()} : N/A`;
  if (value) return value;
  return 'N/A';
}

/** LCB-30, or lcb_id when it already includes the section label. */
function exportSectionId({ sectionLabel, lcbId }) {
  const id = String(lcbId || '').trim();
  if (!id) return normalizeSectionLabel(sectionLabel);
  const label = normalizeSectionLabel(sectionLabel);
  const compact = id.replace(/\s+/g, '-');
  const prefix = `${label}-`;
  if (compact.toUpperCase() === label.toUpperCase() || compact.toUpperCase().startsWith(prefix.toUpperCase())) {
    return compact;
  }
  return formatSectionRef(label, id);
}

function firstLine(text, max = 80) {
  const line = String(text || '').split('\n').map((s) => s.trim()).find(Boolean) || '';
  return line.length > max ? `${line.slice(0, max - 1).trim()}…` : line;
}

/** A short code like "69" or "LP-26". Free text ("Rusty pole, LP43, Barker Rd") is not. */
function isShortSectionCode(id) {
  return /^[\w.\-/]{1,16}$/.test(id);
}

/** Section part of a title: "LCB-69" for a code, or the typed text as it is. */
function titleSectionPart({ sectionLabel, lcbId }) {
  const id = String(lcbId || '').trim().replace(/[.\s]+$/, '');
  if (!id) return '';
  return isShortSectionCode(id) ? exportSectionId({ sectionLabel, lcbId: id }) : id;
}

/**
 * Description, section, street — empty ones dropped, and so is a part already typed
 * inside another (e.g. street "Barker Road" when the ID reads "LP43, Barker Road").
 */
function titleParts({ description, sectionLabel, lcbId, streetName }, descMax = 80) {
  const parts = [firstLine(description, descMax), titleSectionPart({ sectionLabel, lcbId }), String(streetName || '').trim()]
    .filter(Boolean);
  const keys = parts.map((part) => part.toLowerCase());
  return parts.filter((part, i) => !keys.some((other, j) => {
    if (j === i) return false;
    if (other === keys[i]) return j < i; // exact repeat: keep the first
    return other.includes(keys[i]);
  }));
}

/**
 * Document title made from the package: description, section name (with its number)
 * and street name — e.g. "Cutout replacement, LCB-316S17, West Coast Highway".
 * Whatever of those is filled in is used; the site name when none is.
 */
export function buildPackageAutoTitle({ description, sectionLabel, lcbId, streetName, siteName } = {}) {
  const parts = titleParts({ description, sectionLabel, lcbId, streetName });
  return parts.length ? parts.join(', ') : String(siteName || '').trim();
}

export { exportSectionId, firstLine, isShortSectionCode, titleParts };

/** A package's title: description, section, street name (the site when none is set). */
export function packageTitle(pkg) {
  return buildPackageAutoTitle({
    description: pkg?.description,
    sectionLabel: pkg?.section_label,
    lcbId: pkg?.lcb_id,
    streetName: pkg?.street_name,
    siteName: pkg?.site?.name || pkg?.site_name || '',
  });
}

/** "PKG-0577 · description, section, street · site" — used on cards, dialogs and lists. */
export function packageHeading(pkg) {
  const id = String(pkg?.display_id || '').trim();
  const site = pkg?.site?.name || pkg?.site_name || 'Deleted site';
  const title = packageTitle(pkg);
  const rest = title && title.toLowerCase() !== site.toLowerCase() ? `${title} · ${site}` : site;
  return id ? `${id} · ${rest}` : rest;
}
