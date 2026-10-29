// Teste ponta-a-ponta (browser real via Playwright) cobrindo os 7 critérios de aceitação.
//
//   node --test tests/e2e/e2e.test.mjs
//
// Por omissão o motor de OCR é substituído por OCR real feito pelo executável "tesseract"
// (mesmo formato de saída do Tesseract.js) para o teste correr em qualquer máquina.
// Com E2E_REAL_OCR=1 usa o Tesseract.js/jsQR da pasta vendor/ (requer "npm run vendor").
// BROWSER=webkit usa o motor do Safari (requer "npx playwright install webkit").
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { start } from '../../scripts/serve.mjs';
import { ocrLines, haveTesseract } from '../tools/ocr_lines.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fx = f => join(here, '../fixtures', f);
const shots = join(here, '../../test-output');
mkdirSync(shots, { recursive: true });

let pw;
try { pw = await import('playwright'); } catch { pw = null; }
const REAL = process.env.E2E_REAL_OCR === '1';
const skip = !pw ? 'playwright não instalado (npm i -D playwright)' : (!REAL && !haveTesseract() ? 'tesseract indisponível' : false);

const FALLBACK_TEXT = {
  multi_iva: ['Papelaria Central, Lda', 'NIF: 501442600', 'FATURA FT 2025A/57', 'Data de emissão: 14/02/2025', 'Cliente: Maria Silva', 'NIF Cliente: 123456789',
    'Taxa 23% Incidência 100,00 IVA 23,00', 'Taxa 13% Incidência 20,00 IVA 2,60', 'Taxa 6% Incidência 50,00 IVA 3,00', 'Total s/ IVA 170,00', 'Total IVA 28,60', 'Total a pagar 198,60 EUR'],
};
const lines = name => (haveTesseract() ? ocrLines(fx(`fatura_${name}.png`)) : FALLBACK_TEXT[name].map(text => ({ text, conf: 95 })));

let server, browser, ctx, page, base, tmp;
const consoleErrors = [];

async function nextImage(name, qr = null) {
  if (REAL) return;
  await page.evaluate(([l, q]) => { window.__next = { lines: l, qr: q }; }, [lines(name), qr]);
}
const val = id => page.inputValue(`#fld-${id}`);

before(async () => {
  if (skip) return;
  server = await start(0);
  base = `http://localhost:${server.address().port}/`;
  const engine = pw[process.env.BROWSER || 'chromium'];
  browser = await engine.launch();
  const device = pw.devices['iPhone 13'];
  ctx = await browser.newContext({ ...device, locale: 'pt-PT', acceptDownloads: true, ...(process.env.BROWSER === 'webkit' ? {} : { isMobile: true }) });
  if (!REAL) {
    await ctx.addInitScript(() => {
      window.__FATURAS_TEST__ = {
        noSW: true,
        recognize: async () => window.__next?.lines || [],
        decodeQr: async () => ({ text: window.__next?.qr || null }),
      };
    });
  } else {
    await ctx.addInitScript(() => { window.__FATURAS_TEST__ = { noSW: true }; });
  }
  page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push(String(e)));
  page.on('dialog', d => d.accept());
  tmp = mkdtempSync(join(tmpdir(), 'faturas-e2e-'));
  await page.goto(base);
  await page.waitForFunction(() => window.__faturasReady === true);
});

after(async () => { await browser?.close(); server?.close(); });

test('Critério 1 + 4 + 5: fotografar (câmara), várias taxas de IVA, correção manual antes de guardar', { skip }, async () => {
  await nextImage('multi_iva', readFileSync(fx('qr_multi_iva.txt'), 'utf8'));
  await page.setInputFiles('#in-camera', fx('fatura_multi_iva.png'));
  await page.waitForSelector('#review:not([hidden])', { timeout: 120000 });
  assert.equal(await val('supplierTaxId'), '501442600');
  assert.equal(await val('invoiceNumber'), 'FT 2025A/57');
  assert.equal(await val('issueDate'), '2025-02-14');
  assert.equal(await val('total'), '198,60');
  assert.equal(await page.locator('#rv-vat tr[data-i]').count(), 3);
  await page.screenshot({ path: join(shots, '02-revisao.png'), fullPage: true });
  // correção manual
  await page.fill('#fld-supplierName', 'Papelaria Central Lisboa, Lda');
  await page.click('#rv-save');
  await page.waitForSelector('#view-list:not([hidden])');
  assert.equal(await page.locator('.item').count(), 1);
  assert.match(await page.locator('.item .t1').first().innerText(), /Papelaria Central Lisboa, Lda/);
});

test('Critério 1 + 2: importar da galeria; imagem pouco legível => campos assinalados, sem dados inventados', { skip }, async () => {
  await nextImage('ilegivel');
  await page.setInputFiles('#in-gallery', fx('fatura_ilegivel.png'));
  await page.waitForSelector('#review:not([hidden])', { timeout: 120000 });
  const doubts = await page.locator('.field.doubt').count();
  const notes = await page.locator('#rv-notes').innerText();
  assert.ok(doubts > 0 || /pouco legível/.test(notes), 'há campos/avisos de dúvida');
  // valores que não foram lidos com segurança não aparecem como certos
  for (const k of ['supplierTaxId', 'invoiceNumber', 'total']) {
    const v = await val(k);
    const cls = await page.getAttribute(`.field[data-k="${k}"]`, 'class');
    assert.ok(v === '' || /doubt/.test(cls), `${k}: "${v}" deve estar vazio ou assinalado`);
  }
  await page.screenshot({ path: join(shots, '03-ilegivel.png'), fullPage: true });
  await page.click('#rv-save'); // confirmação aceite: fica guardado com campos por confirmar
  await page.waitForSelector('#view-list:not([hidden])');
  assert.equal(await page.locator('.item').count(), 2);
});

test('Critério 3: campos ausentes => registo guardado com campos vazios', { skip }, async () => {
  await nextImage('incompleta');
  await page.setInputFiles('#in-gallery', fx('fatura_incompleta.png'));
  await page.waitForSelector('#review:not([hidden])', { timeout: 120000 });
  for (const k of ['supplierTaxId', 'invoiceNumber', 'issueDate', 'customerTaxId']) assert.equal(await val(k), '', k);
  assert.equal(await val('total'), '2,40');
  await page.click('#rv-save');
  await page.waitForSelector('#view-list:not([hidden])');
  assert.equal(await page.locator('.item').count(), 3);
});

test('Duplicados: aviso sem eliminação automática', { skip }, async () => {
  await nextImage('multi_iva', readFileSync(fx('qr_multi_iva.txt'), 'utf8'));
  await page.setInputFiles('#in-gallery', fx('fatura_multi_iva.png'));
  await page.waitForSelector('#review:not([hidden])', { timeout: 120000 });
  assert.match(await page.locator('#rv-validation').innerText(), /Possível duplicado/);
  await page.click('#rv-cancel');
  assert.equal(await page.locator('.item').count(), 3);
});

test('Critério 6: fechar e reabrir => registos persistem', { skip }, async () => {
  await page.close();
  page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  page.on('pageerror', e => consoleErrors.push(String(e)));
  await page.goto(base);
  await page.waitForFunction(() => window.__faturasReady === true);
  assert.equal(await page.locator('.item').count(), 3);
  await page.screenshot({ path: join(shots, '01-lista.png'), fullPage: true });
});

test('Pesquisa e filtros por fornecedor e data', { skip }, async () => {
  await page.fill('#f-search', 'café');
  assert.equal(await page.locator('.item').count(), 1);
  await page.click('#f-clear');
  await page.fill('#f-from', '2025-02-01');
  await page.fill('#f-to', '2025-02-28');
  assert.equal(await page.locator('.item').count(), 1);
  await page.click('#f-clear');
  await page.selectOption('#f-supplier', 'Papelaria Central Lisboa, Lda');
  assert.equal(await page.locator('.item').count(), 1);
  await page.click('#f-clear');
  assert.equal(await page.locator('.item').count(), 3);
});

test('Critérios 4, 5 e 7: exportar .xlsx com tipos corretos e folha de IVA', { skip }, async () => {
  await page.check('#sel-all');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export-xlsx')]);
  const file = join(tmp, 'faturas.xlsx');
  await dl.saveAs(file);
  const data = JSON.parse(execFileSync('python3', [join(here, '../tools/inspect_xlsx.py'), file]).toString());
  const fat = data['Faturas'];
  const h = fat[0].map(c => c.v);
  const row = fat.slice(1).find(r => r[h.indexOf('NIF fornecedor')].v === '501442600');
  assert.ok(row, 'linha da fatura multi-IVA');
  assert.equal(row[h.indexOf('Fornecedor')].v, 'Papelaria Central Lisboa, Lda'); // correção manual exportada
  assert.equal(row[h.indexOf('Data de emissão')].t, 'date');
  assert.equal(row[h.indexOf('NIF fornecedor')].t, 'text');
  assert.equal(row[h.indexOf('N.º fatura')].t, 'text');
  assert.equal(row[h.indexOf('Total')].t, 'number');
  assert.equal(row[h.indexOf('Total')].v, 198.6);
  const id = row[0].v;
  const iva = data['IVA por taxa'].slice(1).filter(r => r[0].v === id);
  assert.deepEqual(iva.map(r => [r[3].v, r[4].v, r[5].v]), [[0.23, 100, 23], [0.13, 20, 2.6], [0.06, 50, 3]]);
  assert.equal(fat.length, 4);
  // validação adicional: o LibreOffice abre e converte o ficheiro (se instalado)
  try {
    execFileSync('soffice', ['--headless', '--convert-to', 'csv', '--outdir', tmp, file], { stdio: 'ignore', timeout: 60000 });
    assert.match(readFileSync(join(tmp, 'faturas.csv'), 'utf8'), /Papelaria Central Lisboa/);
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
});

test('Exportar .zip com Excel + imagens originais', { skip }, async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export-zip')]);
  const file = join(tmp, 'faturas.zip');
  await dl.saveAs(file);
  const names = execFileSync('python3', ['-c', 'import zipfile,sys;print("\\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))', file]).toString().trim().split('\n');
  assert.equal(names.filter(n => n.endsWith('.xlsx')).length, 1);
  assert.equal(names.filter(n => n.startsWith('imagens/')).length, 3);
});

test('Editar e eliminar registos', { skip }, async () => {
  await page.locator('.item .main', { hasText: 'Café Sol' }).click();
  await page.waitForSelector('#review:not([hidden])');
  await page.fill('#fld-total', '2,50');
  await page.click('#rv-save');
  await page.waitForSelector('#view-list:not([hidden])');
  assert.match(await page.locator('.item', { hasText: 'Café Sol' }).innerText(), /2,50/);
  await page.locator('.item .main', { hasText: 'Café Sol' }).click();
  await page.click('#rv-delete');
  await page.waitForSelector('#view-list:not([hidden])');
  assert.equal(await page.locator('.item').count(), 2);
});

test('Sem erros de JavaScript na consola', { skip }, () => {
  assert.deepEqual(consoleErrors.filter(e => !/favicon/.test(e)), []);
});
