// Calculations and checks the portal's pages share, kept free of the page
// and the database client so they can be unit tested
// (portal/tests/calc.test.mjs).

// ------------------------------------------------------------------ dates

/** Whole days from today to a date (YYYY-MM-DD); negative once it's past.
 * @param {string | null | undefined} d @param {string} [from] today, YYYY-MM-DD */
export const daysUntil = (d, from = new Date().toISOString().slice(0, 10)) =>
  (d ? Math.round((+new Date(`${d}T12:00:00`) - +new Date(`${from}T12:00:00`)) / 864e5) : null);

/** How a due date reads: overdue in red, within a week in amber, later in blue.
 * @param {number} n days until it's due, from daysUntil */
export function dueState(n) {
  if (n < 0) return { tone: 'red', text: `${-n} day${n === -1 ? '' : 's'} overdue` };
  if (n <= 7) return { tone: 'amber', text: n === 0 ? 'Due today' : `Due in ${n} day${n === 1 ? '' : 's'}` };
  return { tone: 'blue', text: null };
}

/** A deadline countdown's colour: red under three days, amber under a week.
 * @param {number} n */
export const countdownTone = (n) => (n < 3 ? 'red' : n < 7 ? 'amber' : 'blue');

// ---------------------------------------------------------------- figures

/** Sum of the rows' amounts (strings from the database count as numbers).
 * @param {Array<{ amount: number | string | null }>} rows */
export const sumAmounts = (rows) => rows.reduce((s, r) => s + Number(r.amount), 0);

/** Actual as a percentage of target; 0 without a target.
 * @param {number} actual @param {number | null | undefined} target */
export const percentOf = (actual, target) => (target ? (100 * actual) / target : 0);

/** Whether the targeted share meets the funder's minimum: null when either is missing.
 * @param {number | null | undefined} share @param {number | null | undefined} min */
export const meetsMinimum = (share, min) => (share == null || min == null ? null : share >= min);

/** Whether a funding element's share keeps to its limit (a maximum or a minimum percentage).
 * @param {number} share @param {{ limit_kind: string, limit_pct: number }} e */
export const withinLimit = (share, e) => (e.limit_kind === 'max' ? share <= e.limit_pct : share >= e.limit_pct);

/** A live workspace's overall score as a status: 95 and over on track, 80 and over some concern.
 * @param {number | null | undefined} score */
export const scoreBand = (score) => (score == null ? 'not_started' : score >= 95 ? 'on_track' : score >= 80 ? 'concern' : 'behind');

// ---------------------------------------------------------------- uploads
// What each storage bucket accepts. The database sets the same types and
// sizes on the buckets (migration 20261104100000); checking here first gives
// a clear message instead of a storage error.

const MB = 1024 * 1024;
const DOCUMENT_TYPES = {
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif', webp: 'image/webp', gif: 'image/gif',
};
export const UPLOAD_RULES = {
  documents: { max: 25 * MB, types: DOCUMENT_TYPES, label: 'PDF, Word, Excel, CSV, PowerPoint, OpenDocument, text or a photo' },
  'lead-workspace': { max: 25 * MB, types: DOCUMENT_TYPES, label: 'PDF, Word, Excel, CSV, PowerPoint, OpenDocument, text or a photo' },
  library: { max: 25 * MB, types: { ...DOCUMENT_TYPES, svg: 'image/svg+xml' }, label: 'PDF, Word, Excel, CSV, PowerPoint, OpenDocument, text or an image' },
  // Agreements to sign: a PDF, or a Word file the server converts (migration 20261105100000).
  agreements: { max: 25 * MB, types: { pdf: 'application/pdf', docx: DOCUMENT_TYPES.docx }, label: 'a PDF or a Word (.docx) file' },
  dbs: { max: 10 * MB, types: { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', webp: 'image/webp' }, label: 'PDF or a photo' },
};

/** The content type to store a file under, or an error message saying why it can't be uploaded.
 * The type comes from the file's extension, so it matches the bucket's list
 * even when the browser reports none.
 * @param {string} bucket @param {{ name: string, size: number }} file
 * @returns {{ contentType: string } | { error: string }} */
export function checkUpload(bucket, file) {
  const rule = UPLOAD_RULES[bucket];
  if (!rule) return { error: 'Files can\'t be uploaded here.' };
  const ext = (file.name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
  const contentType = rule.types[ext];
  if (!contentType) return { error: `${file.name} can't be uploaded: choose ${rule.label}.` };
  if (!file.size) return { error: `${file.name} is empty.` };
  if (file.size > rule.max) return { error: `${file.name} is larger than ${rule.max / MB}MB.` };
  return { contentType };
}

// ------------------------------------------------------------- agreements

/** Fill a template's {{merge fields}}; fields with no value stay marked for the lead to fill.
 * @param {string} body @param {Record<string, string | null | undefined>} fields */
export const mergeTemplate = (body, fields) =>
  String(body ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (fields[k] != null && String(fields[k]).trim() !== '' ? String(fields[k]) : m));

/** The merge fields still unfilled in a text. @param {string} text */
export const unfilledFields = (text) => [...new Set([...String(text ?? '').matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]))];

/** The register's filters: type, a party organisation and status ('' for any).
 * @param {Array<{ type: string, parties: string[], status: string }>} rows @param {{ type?: string, party?: string, status?: string }} f */
export const filterAgreements = (rows, f) => rows.filter((a) => (!f.type || a.type === f.type)
  && (!f.party || (a.parties || []).includes(f.party)) && (!f.status || a.status === f.status));

/** The next date that matters on a signed agreement: its review or expiry, whichever comes first.
 * @param {{ review_date?: string | null, expiry_date?: string | null }} a @returns {{ kind: 'review' | 'expiry', date: string } | null} */
export function nextAgreementDate(a) {
  const ds = [['review', a.review_date], ['expiry', a.expiry_date]].filter(([, d]) => d).sort((x, y) => String(x[1]).localeCompare(String(y[1])));
  return ds.length ? { kind: /** @type {'review' | 'expiry'} */ (ds[0][0]), date: String(ds[0][1]) } : null;
}

/** Whether a signer's turn has come: everyone with a lower order number has signed.
 * @param {{ sign_order: number }} r @param {Array<{ sign_order: number, status: string }>} all */
export const signerTurn = (r, all) => all.every((o) => o.sign_order >= r.sign_order || o.status === 'signed');
