import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pt from '../../js/profiles/pt.js';
import { exportXlsx } from '../../js/lib/export.js';
import { crc32 } from '../../js/lib/zip.js';

const here = dirname(fileURLToPath(import.meta.url));

export const SAMPLE = [
  {
    id: 'F20250214-0001', imageId: 'img1', imageType: 'image/jpeg',
    fields: { supplierName: 'Papelaria Central, Lda', supplierTaxId: '501442600', invoiceNumber: '000123', issueDate: '2025-02-14',
      customerName: 'Maria Silva', customerTaxId: '123456789', currency: 'EUR', totalNet: 150, totalVat: 26, total: 176 },
    vat: [{ rate: 23, base: 100, vat: 23 }, { rate: 6, base: 50, vat: 3 }], review: {},
  },
  {
    id: 'F20250301-0002', imageId: 'img2', imageType: 'image/png',
    fields: { supplierName: 'Café Sol', supplierTaxId: null, invoiceNumber: null, issueDate: null,
      customerName: null, customerTaxId: null, currency: null, totalNet: null, totalVat: null, total: 2.4 },
    vat: [], review: { supplierName: 'doubt' },
  },
];

function havePython() {
  try { execFileSync('python3', ['-c', 'import openpyxl'], { stdio: 'ignore' }); return true; } catch { return false; }
}

test('CRC32 conhecido', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('XLSX é um ZIP OOXML real (não CSV)', () => {
  const bytes = exportXlsx(SAMPLE, pt);
  assert.equal(bytes[0], 0x50); assert.equal(bytes[1], 0x4b); // "PK"
  const text = new TextDecoder().decode(bytes);
  assert.ok(text.includes('[Content_Types].xml'));
  assert.ok(text.includes('xl/worksheets/sheet2.xml'));
});

test('Critérios 4 e 7: tipos corretos e folha de IVA por taxa (openpyxl)', { skip: !havePython() && 'python3+openpyxl indisponível' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'xlsx-'));
  const file = join(dir, 'faturas.xlsx');
  writeFileSync(file, exportXlsx(SAMPLE, pt));
  const data = JSON.parse(execFileSync('python3', [join(here, '../tools/inspect_xlsx.py'), file]).toString());
  const fat = data['Faturas'];
  const header = fat[0].map(c => c.v);
  const col = name => header.indexOf(name);
  const r1 = fat[1];
  assert.equal(r1[col('Data de emissão')].t, 'date');
  assert.equal(r1[col('Data de emissão')].v, '2025-02-14');
  assert.equal(r1[col('Data de emissão')].fmt, 'dd/mm/yyyy');
  assert.equal(r1[col('NIF fornecedor')].t, 'text');
  assert.equal(r1[col('NIF fornecedor')].v, '501442600');
  assert.equal(r1[col('NIF fornecedor')].fmt, '@');
  assert.equal(r1[col('N.º fatura')].v, '000123'); // zeros à esquerda preservados
  assert.equal(r1[col('N.º fatura')].t, 'text');
  assert.equal(r1[col('Total')].t, 'number');
  assert.equal(r1[col('Total')].v, 176);
  assert.equal(r1[col('Total sem IVA')].fmt, '#,##0.00');
  assert.equal(r1[col('Imagem')].v, 'imagens/F20250214-0001.jpg');
  // Critério 3: campos vazios exportados vazios
  const r2 = fat[2];
  assert.equal(r2[col('NIF fornecedor')].t, 'empty');
  assert.equal(r2[col('Data de emissão')].t, 'empty');
  assert.equal(r2[col('Total')].v, 2.4);
  assert.match(r2[col('Alertas')].v, /Por confirmar: Fornecedor/);
  // Critério 4: folha IVA com chave comum
  const iva = data['IVA por taxa'];
  assert.equal(iva.length, 3);
  assert.deepEqual(iva.slice(1).map(r => [r[0].v, r[3].v, r[4].v, r[5].v]), [['F20250214-0001', 0.23, 100, 23], ['F20250214-0001', 0.06, 50, 3]]);
  assert.equal(iva[1][3].fmt, '0%');
});
