// Testes do extrator sobre OCR REAL (Tesseract CLI) das imagens de tests/fixtures.
// Requer o executável "tesseract" (idealmente com o idioma "por"). Sem ele, os testes são ignorados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pt from '../../js/profiles/pt.js';
import { extractInvoice } from '../../js/lib/extract.js';
import { ocrLines, haveTesseract } from '../tools/ocr_lines.mjs';

const fx = f => join(dirname(fileURLToPath(import.meta.url)), '../fixtures', f);
const skip = !haveTesseract() && 'tesseract indisponível';

const TRUTH = {
  supplierName: 'Papelaria Central, Lda', supplierTaxId: '501442600', invoiceNumber: 'FT 2025A/57',
  issueDate: '2025-02-14', customerName: 'Maria Silva', customerTaxId: '123456789', currency: 'EUR',
  totalNet: 170, totalVat: 28.6, total: 198.6,
};
const VAT = [[23, 100, 23], [13, 20, 2.6], [6, 50, 3]];

test('OCR real, fatura legível com 3 taxas (só texto, sem QR)', { skip }, () => {
  const r = extractInvoice({ lines: ocrLines(fx('fatura_multi_iva.png')), profile: pt });
  for (const [k, v] of Object.entries(TRUTH)) assert.equal(r.fields[k].value, v, k);
  assert.deepEqual(r.vat.map(v => [v.rate, v.base, v.vat]), VAT);
});

test('OCR real + QR fiscal: QR prevalece e tudo coerente', { skip }, () => {
  const qr = readFileSync(fx('qr_multi_iva.txt'), 'utf8');
  const r = extractInvoice({ lines: ocrLines(fx('fatura_multi_iva.png')), qrText: qr, profile: pt });
  for (const [k, v] of Object.entries(TRUTH)) assert.equal(r.fields[k].value, v, k);
  assert.equal(r.fields.total.source, 'qr');
});

test('Critério 2 com OCR real: imagem pouco legível não produz valores errados marcados como certos', { skip }, () => {
  const r = extractInvoice({ lines: ocrLines(fx('fatura_ilegivel.png')), profile: pt });
  const wrongButOk = Object.entries(r.fields).filter(([k, f]) => f.status === 'ok' && f.value !== null && f.value !== TRUTH[k]);
  assert.deepEqual(wrongButOk, [], 'nenhum valor errado com estado "ok"');
  const flagged = Object.values(r.fields).filter(f => f.status === 'doubt').length;
  assert.ok(flagged >= 1 || r.notes.some(n => /pouco legível/.test(n)), 'há assinalamento');
  console.log('  ilegível ->', Object.fromEntries(Object.entries(r.fields).map(([k, f]) => [k, `${f.value} [${f.status}]`])));
});

test('Critério 3 com OCR real: talão sem NIF/número/data => campos vazios', { skip }, () => {
  const r = extractInvoice({ lines: ocrLines(fx('fatura_incompleta.png')), profile: pt });
  for (const k of ['supplierTaxId', 'invoiceNumber', 'issueDate', 'customerTaxId']) assert.equal(r.fields[k].value, null, k);
  assert.equal(r.fields.total.value, 2.4);
});
