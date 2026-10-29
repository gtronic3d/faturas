// Validações de coerência de um registo (já revisto ou em revisão).

import { round2 } from './numbers.js';

export const TOLERANCE = 0.02; // euros (arredondamentos por linha)

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const fmt = n => n.toFixed(2).replace('.', ',');

/**
 * @param {object} rec  { fields: {k: value}, vat: [{rate, base, vat}] }
 * @param {object} profile
 * @returns {{level:'error'|'warn', code:string, msg:string}[]}
 */
export function validateRecord(rec, profile) {
  const out = [];
  const f = rec.fields || {};
  const vat = (rec.vat || []).filter(r => r && (isNum(r.base) || isNum(r.vat) || isNum(r.rate)));

  for (const [k, label] of [['supplierTaxId', 'NIF do fornecedor'], ['customerTaxId', 'NIF do cliente']]) {
    const v = f[k];
    if (v && !profile.validateTaxId(v)) out.push({ level: 'warn', code: `${k}.invalid`, msg: `${label} inválido (${v}): dígito de controlo não confere.` });
  }

  for (const [k, label] of [['totalNet', 'Total sem IVA'], ['totalVat', 'Total IVA'], ['total', 'Total']]) {
    if (Number.isNaN(f[k])) out.push({ level: 'error', code: `${k}.nan`, msg: `${label}: valor não numérico.` });
  }
  vat.forEach((r, i) => {
    if ([r.rate, r.base, r.vat].some(v => Number.isNaN(v))) out.push({ level: 'error', code: `vat.${i}.nan`, msg: `Linha de IVA ${i + 1}: valor não numérico.` });
    if (isNum(r.rate) && isNum(r.base) && isNum(r.vat)) {
      const expected = round2(r.base * r.rate / 100);
      if (Math.abs(expected - r.vat) > TOLERANCE) out.push({ level: 'warn', code: `vat.${i}.rate`, msg: `IVA ${r.rate}%: ${fmt(r.base)} × ${r.rate}% = ${fmt(expected)}, mas está ${fmt(r.vat)}.` });
    }
    if (isNum(r.rate) && profile.KNOWN_RATES && !profile.KNOWN_RATES.includes(r.rate)) out.push({ level: 'warn', code: `vat.${i}.unknown`, msg: `Taxa de IVA ${r.rate}% não é uma taxa conhecida.` });
  });

  const tol = TOLERANCE * Math.max(1, vat.length);
  const bases = vat.filter(r => isNum(r.base));
  const vats = vat.filter(r => isNum(r.vat));
  if (isNum(f.totalNet) && bases.length && bases.length === vat.length) {
    const s = round2(bases.reduce((a, r) => a + r.base, 0));
    if (Math.abs(s - f.totalNet) > tol) out.push({ level: 'warn', code: 'sum.net', msg: `Soma das bases por taxa (${fmt(s)}) ≠ Total sem IVA (${fmt(f.totalNet)}).` });
  }
  if (isNum(f.totalVat) && vats.length && vats.length === vat.length) {
    const s = round2(vats.reduce((a, r) => a + r.vat, 0));
    if (Math.abs(s - f.totalVat) > tol) out.push({ level: 'warn', code: 'sum.vat', msg: `Soma do IVA por taxa (${fmt(s)}) ≠ Total IVA (${fmt(f.totalVat)}).` });
  }
  if (isNum(f.total)) {
    const vatTotal = isNum(f.totalVat) ? f.totalVat : (vats.length && vats.length === vat.length ? round2(vats.reduce((a, r) => a + r.vat, 0)) : null);
    if (isNum(f.totalNet) && vatTotal !== null) {
      const s = round2(f.totalNet + vatTotal);
      if (Math.abs(s - f.total) > tol) out.push({ level: 'warn', code: 'sum.total', msg: `Total sem IVA + IVA (${fmt(s)}) ≠ Total (${fmt(f.total)}).` });
    }
  }
  if (f.issueDate) {
    const d = new Date(f.issueDate + 'T00:00:00Z');
    if (Number.isNaN(d.getTime())) out.push({ level: 'error', code: 'date.invalid', msg: 'Data de emissão inválida.' });
    else if (d.getTime() > Date.now() + 86400000) out.push({ level: 'warn', code: 'date.future', msg: 'Data de emissão no futuro.' });
  }
  return out;
}

/** Chave de duplicado: fornecedor (NIF ou nome) + número + data. */
export function duplicateKey(fields) {
  const sup = (fields.supplierTaxId || '').replace(/\s/g, '') || (fields.supplierName || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const num = (fields.invoiceNumber || '').toUpperCase().replace(/\s+/g, '');
  const date = fields.issueDate || '';
  if (!sup || !num || !date) return null;
  return `${sup}|${num}|${date}`;
}

/** Devolve os registos existentes que parecem duplicados de `rec` (sem eliminar nada). */
export function findDuplicates(rec, all) {
  const key = duplicateKey(rec.fields || {});
  if (!key) return [];
  return all.filter(o => o.id !== rec.id && duplicateKey(o.fields || {}) === key);
}
