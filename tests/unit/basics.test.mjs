import { test } from 'node:test';
import assert from 'node:assert/strict';
import pt, { validateTaxId, parseFiscalQr } from '../../js/profiles/pt.js';
import { parseAmount, findAmounts } from '../../js/lib/numbers.js';
import { findDates, isoToExcelSerial } from '../../js/lib/dates.js';
import { validateRecord, findDuplicates } from '../../js/lib/validate.js';

test('NIF: dígito de controlo', () => {
  assert.equal(validateTaxId('501442600'), true);   // NIF válido (checksum)
  assert.equal(validateTaxId('999999990'), true);   // consumidor final
  assert.equal(validateTaxId('123456789'), true);
  assert.equal(validateTaxId('123456780'), false);
  assert.equal(validateTaxId('PT 501 442 600'), true);
  assert.equal(validateTaxId('12345678'), false);
  assert.equal(validateTaxId(''), false);
});

test('Valores monetários em formatos PT e internacionais', () => {
  assert.deepEqual(parseAmount('1.234,56'), { value: 1234.56, ambiguous: false });
  assert.deepEqual(parseAmount('1 234,56 €'), { value: 1234.56, ambiguous: false });
  assert.deepEqual(parseAmount('1,234.56'), { value: 1234.56, ambiguous: false });
  assert.deepEqual(parseAmount('12,30'), { value: 12.3, ambiguous: false });
  assert.deepEqual(parseAmount('-5,00'), { value: -5, ambiguous: false });
  assert.equal(parseAmount('1.234').ambiguous, true);
  assert.equal(parseAmount('abc'), null);
});

test('findAmounts ignora percentagens e datas', () => {
  const a = findAmounts('IVA 23,00% 100,00 23,00 em 15.01.24');
  assert.deepEqual(a.map(x => x.value), [100, 23]);
  assert.deepEqual(findAmounts('Total 1.234,56 EUR').map(x => x.value), [1234.56]);
});

test('Datas: dd/mm/aaaa, ISO, nome do mês; série Excel', () => {
  assert.equal(findDates('Data: 05/03/2025')[0].iso, '2025-03-05');
  assert.equal(findDates('2025-03-05')[0].iso, '2025-03-05');
  assert.equal(findDates('5 de março de 2025')[0].iso, '2025-03-05');
  assert.equal(findDates('31/02/2025').length, 0);
  assert.equal(findDates('05-03-25')[0].twoDigitYear, true);
  assert.equal(isoToExcelSerial('1900-03-01'), 61);
  assert.equal(isoToExcelSerial('2025-01-15'), 45672);
});

test('QR fiscal AT: várias taxas, consumidor final', () => {
  const q = parseFiscalQr('A:501442600*B:999999990*C:PT*D:FT*E:N*F:20250115*G:FT A/123*H:JFJ8CQYD-123*I1:PT*I3:10.00*I4:0.60*I5:20.00*I6:2.60*I7:100.00*I8:23.00*N:26.20*O:156.20*Q:ab12*R:1234');
  assert.equal(q.supplierTaxId, '501442600');
  assert.equal(q.customerTaxId, '');
  assert.equal(q.customerIsGenericConsumer, true);
  assert.equal(q.issueDate, '2025-01-15');
  assert.equal(q.invoiceNumber, 'FT A/123');
  assert.deepEqual(q.vat.map(v => [v.rate, v.base, v.vat]), [[6, 10, 0.6], [13, 20, 2.6], [23, 100, 23]]);
  assert.equal(q.total, 156.2);
  const madeira = parseFiscalQr('A:501442600*B:123456789*C:PT*D:FT*E:N*F:20250115*G:FT M/1*H:0*I1:PT-MA*I7:100.00*I8:22.00*N:22.00*O:122.00*Q:x*R:1');
  assert.equal(madeira.vat[0].rate, 22);
  assert.equal(parseFiscalQr('https://exemplo.pt'), null);
});

test('Validação de totais deteta discrepâncias', () => {
  const ok = { fields: { totalNet: 130, totalVat: 26.2, total: 156.2 }, vat: [{ rate: 6, base: 10, vat: 0.6 }, { rate: 13, base: 20, vat: 2.6 }, { rate: 23, base: 100, vat: 23 }] };
  assert.deepEqual(validateRecord(ok, pt), []);
  const bad = { fields: { totalNet: 130, totalVat: 26.2, total: 160 }, vat: ok.vat };
  assert.ok(validateRecord(bad, pt).some(v => v.code === 'sum.total'));
  const badRate = { fields: {}, vat: [{ rate: 23, base: 100, vat: 20 }] };
  assert.ok(validateRecord(badRate, pt).some(v => v.code === 'vat.0.rate'));
  const badNif = { fields: { supplierTaxId: '123456780' }, vat: [] };
  assert.ok(validateRecord(badNif, pt).some(v => v.code === 'supplierTaxId.invalid'));
});

test('Duplicados: mesmo fornecedor + número + data; não elimina', () => {
  const a = { id: '1', fields: { supplierTaxId: '501442600', invoiceNumber: 'FT A/1', issueDate: '2025-01-01' } };
  const b = { id: '2', fields: { supplierTaxId: '501442600', invoiceNumber: 'FT  A/1', issueDate: '2025-01-01' } };
  const c = { id: '3', fields: { supplierTaxId: '501442600', invoiceNumber: 'FT A/2', issueDate: '2025-01-01' } };
  const all = [a, b, c];
  assert.deepEqual(findDuplicates(a, all).map(x => x.id), ['2']);
  assert.deepEqual(findDuplicates(c, all), []);
  assert.equal(all.length, 3);
});
