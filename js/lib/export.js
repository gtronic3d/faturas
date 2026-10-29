// Conversão de registos para folhas de cálculo.

import { buildXlsx } from './xlsx.js';
import { validateRecord, findDuplicates } from './validate.js';

export const FIELD_LABELS = {
  supplierName: 'Fornecedor',
  supplierTaxId: 'NIF do fornecedor',
  invoiceNumber: 'N.º da fatura',
  issueDate: 'Data de emissão',
  customerName: 'Cliente',
  customerTaxId: 'NIF do cliente',
  currency: 'Moeda',
  totalNet: 'Total sem IVA',
  totalVat: 'Total IVA',
  total: 'Total',
};

export function imageFileName(rec) {
  if (!rec.imageId) return '';
  const ext = (rec.imageType || 'image/jpeg').split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
  return `imagens/${rec.id}.${ext}`;
}

/** Alertas a incluir na exportação: campos por confirmar, validações e duplicados. */
export function recordAlerts(rec, all, profile) {
  const a = [];
  const pending = Object.entries(rec.review || {}).filter(([, s]) => s === 'doubt').map(([k]) => FIELD_LABELS[k] || k);
  if (pending.length) a.push(`Por confirmar: ${pending.join(', ')}`);
  for (const v of validateRecord(rec, profile)) a.push(v.msg);
  if (all && findDuplicates(rec, all).length) a.push('Possível duplicado');
  return a;
}

export function recordsToSheets(records, profile, all = records) {
  const faturas = {
    name: 'Faturas',
    columns: [
      { header: 'ID', type: 'text', width: 22 },
      { header: 'Data de emissão', type: 'date', width: 14 },
      { header: 'Fornecedor', type: 'text', width: 32 },
      { header: 'NIF fornecedor', type: 'text', width: 14 },
      { header: 'N.º fatura', type: 'text', width: 20 },
      { header: 'Cliente', type: 'text', width: 28 },
      { header: 'NIF cliente', type: 'text', width: 14 },
      { header: 'Moeda', type: 'text', width: 8 },
      { header: 'Total sem IVA', type: 'money', width: 14 },
      { header: 'Total IVA', type: 'money', width: 12 },
      { header: 'Total', type: 'money', width: 12 },
      { header: 'N.º taxas IVA', type: 'int', width: 12 },
      { header: 'Imagem', type: 'text', width: 40 },
      { header: 'Alertas', type: 'text', width: 60 },
    ],
    rows: records.map(r => {
      const f = r.fields;
      return [
        r.id, f.issueDate || null, f.supplierName || null, f.supplierTaxId || null, f.invoiceNumber || null,
        f.customerName || null, f.customerTaxId || null, f.currency || null,
        f.totalNet ?? null, f.totalVat ?? null, f.total ?? null,
        (r.vat || []).length, imageFileName(r) || null, recordAlerts(r, all, profile).join(' | ') || null,
      ];
    }),
  };
  const vatRows = [];
  for (const r of records) {
    const sorted = [...(r.vat || [])].sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1)); // taxa mais alta primeiro
    for (const v of sorted) {
      vatRows.push([r.id, r.fields.invoiceNumber || null, r.fields.supplierTaxId || null,
        typeof v.rate === 'number' ? v.rate / 100 : null, v.base ?? null, v.vat ?? null]);
    }
  }
  const sheets = [faturas];
  if (vatRows.length) {
    sheets.push({
      name: 'IVA por taxa',
      columns: [
        { header: 'ID', type: 'text', width: 22 },
        { header: 'N.º fatura', type: 'text', width: 20 },
        { header: 'NIF fornecedor', type: 'text', width: 14 },
        { header: 'Taxa IVA', type: 'percent', width: 10 },
        { header: 'Base tributável', type: 'money', width: 16 },
        { header: 'Valor IVA', type: 'money', width: 12 },
      ],
      rows: vatRows,
    });
  }
  return sheets;
}

export function exportXlsx(records, profile, all) {
  return buildXlsx(recordsToSheets(records, profile, all));
}
