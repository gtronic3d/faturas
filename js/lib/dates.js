// Datas: deteção em texto, validação e conversão para série do Excel.

const pad = n => String(n).padStart(2, '0');

export function isValidYMD(y, m, d) {
  if (!(y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1)) return false;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= dim;
}

export const toIso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/**
 * Encontra datas num texto. order = 'DMY' (Portugal) ou 'MDY'.
 * Devolve [{ iso, raw, index, twoDigitYear }].
 */
export function findDates(text, order = 'DMY') {
  const out = [];
  const months = { jan: 1, fev: 2, feb: 2, mar: 3, abr: 4, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, set: 9, sep: 9, out: 10, oct: 10, nov: 11, dez: 12, dec: 12 };
  let m;
  const iso = /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g;
  while ((m = iso.exec(text))) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    if (isValidYMD(y, mo, d)) out.push({ iso: toIso(y, mo, d), raw: m[0], index: m.index, twoDigitYear: false });
  }
  const dmy = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/g;
  while ((m = dmy.exec(text))) {
    if (out.some(o => m.index >= o.index && m.index < o.index + o.raw.length)) continue;
    let a = +m[1], b = +m[2], y = +m[3];
    const two = m[3].length === 2;
    if (two) y += 2000;
    const [d, mo] = order === 'MDY' ? [b, a] : [a, b];
    if (isValidYMD(y, mo, d)) out.push({ iso: toIso(y, mo, d), raw: m[0], index: m.index, twoDigitYear: two });
  }
  const named = /\b(\d{1,2})\s*(?:de\s*)?(jan|fev|feb|mar|abr|apr|mai|may|jun|jul|ago|aug|set|sep|out|oct|nov|dez|dec)[a-zç]*\.?\s*(?:de\s*)?(\d{4})\b/gi;
  while ((m = named.exec(text))) {
    const d = +m[1], mo = months[m[2].toLowerCase()], y = +m[3];
    if (isValidYMD(y, mo, d)) out.push({ iso: toIso(y, mo, d), raw: m[0], index: m.index, twoDigitYear: false });
  }
  return out.sort((x, y) => x.index - y.index);
}

/** Série de data do Excel (sistema 1900): dias desde 30/12/1899. */
export function isoToExcelSerial(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!isValidYMD(y, m, d)) return null;
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
}

export function formatDatePt(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
