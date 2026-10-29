import { test } from 'node:test';
import assert from 'node:assert/strict';
import pt from '../../js/profiles/pt.js';
import { extractInvoice } from '../../js/lib/extract.js';

const L = (arr, conf = 92) => arr.map(t => ({ text: t, conf }));

const CLEAN = L([
  'Papelaria Central, Lda',
  'Rua Direita 10, 1000-100 Lisboa',
  'NIF: 501442600',
  'FATURA FT 2025A/57',
  'Data de emissão: 14/02/2025   Vencimento: 16/03/2025',
  'Cliente: Maria Silva',
  'NIF Cliente: 123456789',
  'Caderno A4            2   5,00   23%   10,00',
  'Resumo de IVA',
  'Taxa 23%   Incidência 100,00   IVA 23,00',
  'Taxa 6%    Incidência 50,00    IVA 3,00',
  'Total s/ IVA 150,00',
  'Total IVA 26,00',
  'Total a pagar 176,00 €',
]);

test('Fatura limpa: todos os campos extraídos e "ok"', () => {
  const r = extractInvoice({ lines: CLEAN, profile: pt });
  const f = r.fields;
  assert.equal(f.supplierName.value, 'Papelaria Central, Lda');
  assert.equal(f.supplierTaxId.value, '501442600');
  assert.equal(f.invoiceNumber.value, 'FT 2025A/57');
  assert.equal(f.issueDate.value, '2025-02-14');
  assert.equal(f.issueDate.status, 'ok');
  assert.equal(f.customerName.value, 'Maria Silva');
  assert.equal(f.customerTaxId.value, '123456789');
  assert.equal(f.currency.value, 'EUR');
  assert.equal(f.totalNet.value, 150);
  assert.equal(f.totalVat.value, 26);
  assert.equal(f.total.value, 176);
  assert.deepEqual(r.vat.map(v => [v.rate, v.base, v.vat, v.status]), [[23, 100, 23, 'ok'], [6, 50, 3, 'ok']]);
  for (const k of ['supplierTaxId', 'invoiceNumber', 'total', 'totalNet', 'totalVat']) assert.equal(f[k].status, 'ok', k);
});

test('Critério 2: imagem pouco legível => campos duvidosos, sem valores inventados', () => {
  const lines = [
    { text: 'P@pel4ria Centr', conf: 41 },
    { text: 'NIF: 501442601', conf: 38 },        // dígito de controlo errado
    { text: 'Data 14/02/2025', conf: 45 },
    { text: 'Total 17?,0 €', conf: 30 },         // valor ilegível
  ];
  const r = extractInvoice({ lines, profile: pt });
  const f = r.fields;
  assert.equal(f.supplierTaxId.status, 'doubt');
  assert.match(f.supplierTaxId.note, /controlo/);
  assert.equal(f.issueDate.status, 'doubt');
  assert.equal(f.total.value, null);             // não inventa
  assert.equal(f.total.status, 'missing');
  assert.equal(f.invoiceNumber.value, null);
  assert.ok(r.notes.some(n => /pouco legível/.test(n)));
  // Nenhum campo "ok" com confiança baixa
  for (const [k, v] of Object.entries(f)) if (v.value !== null) assert.notEqual(v.status, 'ok', k);
});

test('Critério 3: campos ausentes ficam vazios ("missing")', () => {
  const r = extractInvoice({ lines: L(['Café Sol', 'Total 2,40 €']), profile: pt });
  const f = r.fields;
  for (const k of ['supplierTaxId', 'invoiceNumber', 'issueDate', 'customerName', 'customerTaxId', 'totalNet', 'totalVat']) {
    assert.equal(f[k].value, null, k);
    assert.equal(f[k].status, 'missing', k);
  }
  assert.equal(f.total.value, 2.4);
});

test('Números de telefone não são confundidos com NIF', () => {
  const r = extractInvoice({ lines: L(['Loja X', 'Tel. 213456789', 'Telemóvel 912345678']), profile: pt });
  assert.equal(r.fields.supplierTaxId.value, null);
});

test('Datas: vencimento não é data de emissão; várias datas sem etiqueta => dúvida', () => {
  const r = extractInvoice({ lines: L(['Vencimento: 30/03/2025', 'Data: 01/03/2025']), profile: pt });
  assert.equal(r.fields.issueDate.value, '2025-03-01');
  const r2 = extractInvoice({ lines: L(['01/03/2025', '05/03/2025']), profile: pt });
  assert.equal(r2.fields.issueDate.status, 'doubt');
});

test('Linha de artigo com 23% não é confundida com o resumo de IVA', () => {
  const r = extractInvoice({ lines: L(['Parafusos inox caixa 100 unidades  2  5,00  23%  10,00']), profile: pt });
  assert.equal(r.vat.length, 0);
});

test('QR fiscal tem prioridade e completa campos; OCR diferente fica anotado', () => {
  const qr = 'A:501442600*B:123456789*C:PT*D:FT*E:N*F:20250214*G:FT 2025A/57*H:JFJ8-57*I1:PT*I3:50.00*I4:3.00*I7:100.00*I8:23.00*N:26.00*O:176.00*Q:abcd*R:1234';
  const lines = L(['Papelaria Central, Lda', 'Total a pagar 178,00 €']);
  const r = extractInvoice({ lines, qrText: qr, profile: pt });
  const f = r.fields;
  assert.equal(f.supplierTaxId.value, '501442600');
  assert.equal(f.supplierTaxId.source, 'qr');
  assert.equal(f.issueDate.value, '2025-02-14');
  assert.equal(f.total.value, 176);
  assert.match(f.total.note, /178/);
  assert.equal(f.totalNet.value, 150);
  assert.equal(f.totalVat.value, 26);
  assert.deepEqual(r.vat.map(v => [v.rate, v.base, v.vat]), [[6, 50, 3], [23, 100, 23]]);
  assert.equal(f.currency.value, 'EUR');
});

test('Documento em USD: valores do QR não são usados', () => {
  const qr = 'A:501442600*B:123456789*C:US*D:FT*E:N*F:20250214*G:FT X/1*H:0*I1:PT*I7:90.00*I8:20.70*N:20.70*O:110.70*Q:a*R:1';
  const r = extractInvoice({ lines: L(['Total USD 120,00']), qrText: qr, profile: pt });
  assert.equal(r.fields.currency.value, 'USD');
  assert.equal(r.fields.total.value, 120);
  assert.ok(r.notes.some(n => /USD/.test(n)));
});

test('Consumidor final: NIF do cliente vazio com nota', () => {
  const r = extractInvoice({ lines: L(['Loja, Lda', 'NIF 501442600', 'Cliente: Consumidor final', 'NIF cliente: 999999990']), profile: pt });
  assert.equal(r.fields.customerTaxId.value, null);
  assert.match(r.fields.customerTaxId.note, /Consumidor final/);
});
