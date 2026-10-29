// Motor de extração: transforma linhas de OCR (+ conteúdo do QR fiscal, se existir)
// em campos estruturados com estado de confiança.
//
// Princípios (regras de fiabilidade do MVP):
//  - nunca inventar: um campo só é preenchido com algo que está escrito no documento
//    (ou é soma direta de valores do QR fiscal, assinalado como "calc");
//  - ambiguidade ou leitura fraca => estado 'doubt' (o utilizador confirma);
//  - ausência => estado 'missing' e valor vazio.

import { findAmounts, round2 } from './numbers.js';
import { findDates } from './dates.js';

export const FIELD_KEYS = [
  'supplierName', 'supplierTaxId', 'invoiceNumber', 'issueDate',
  'customerName', 'customerTaxId', 'currency', 'totalNet', 'totalVat', 'total',
];

export const MONEY_FIELDS = ['totalNet', 'totalVat', 'total'];

export const norm = s => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[°]/g, 'º');

const letters = s => (s.match(/[a-zà-ÿ]/gi) || []).length;

function emptyField() { return { value: null, status: 'missing', source: '', note: '' }; }

/**
 * @param {object} p
 * @param {{text:string, conf?:number|null}[]} p.lines  linhas de texto (OCR ou colado)
 * @param {string|null} p.qrText  conteúdo bruto do QR, se lido
 * @param {object} p.profile  perfil de país (ver js/profiles/pt.js)
 * @param {number} [p.lowConf=65]  limiar de confiança (0-100) abaixo do qual o valor é duvidoso
 */
export function extractInvoice({ lines = [], qrText = null, profile, lowConf = 65 }) {
  const P = profile;
  const K = P.KEYWORDS;
  const L = lines
    .map(l => (typeof l === 'string' ? { text: l, conf: null } : { text: String(l.text ?? ''), conf: l.conf ?? null }))
    .map(l => ({ ...l, text: l.text.replace(/\s+$/g, '') }))
    .filter(l => l.text.trim() !== '');
  const N = L.map(l => norm(l.text));

  const fields = Object.fromEntries(FIELD_KEYS.map(k => [k, emptyField()]));
  const notes = [];

  const confNote = conf => (conf !== null && conf < lowConf) ? `Leitura com confiança baixa (${Math.round(conf)}%)` : '';
  const setOcr = (key, value, { conf = null, doubt = false, note = '' } = {}) => {
    const cn = confNote(conf);
    const isDoubt = doubt || !!cn;
    fields[key] = { value, status: isDoubt ? 'doubt' : 'ok', source: 'ocr', note: [note, cn].filter(Boolean).join('; ') };
  };

  // ---------------------------------------------------------------- QR fiscal
  const qr = qrText ? P.parseFiscalQr(qrText) : null;
  if (qrText && !qr) notes.push('Foi lido um código QR, mas não é um QR fiscal reconhecido.');

  // ---------------------------------------------------------------- NIF
  const taxIdCands = [];
  for (let i = 0; i < L.length; i++) {
    const labeled = K.taxId.test(N[i]) || /\bpt\s?\d{9}\b/.test(N[i]);
    if (!labeled) continue;
    const scan = (text, lineIdx) => {
      const re = /(?<![\d])(?:PT\s?)?(\d(?:[\s.]?\d){8})(?![\d])/gi;
      let m; const found = [];
      while ((m = re.exec(text))) {
        const digits = m[1].replace(/\D/g, '');
        if (digits.length === 9) found.push({ digits, lineIdx, conf: L[lineIdx].conf });
      }
      return found;
    };
    let found = scan(L[i].text, i);
    if (!found.length && i + 1 < L.length && letters(L[i + 1].text) < 4) found = scan(L[i + 1].text, i + 1);
    const prev = [N[i - 1] || '', N[i - 2] || ''];
    const customerCtx = K.customer.test(N[i]) || prev.some(p => K.customer.test(p) && letters(p) < 40);
    for (const f of found) taxIdCands.push({ ...f, customerCtx });
  }
  {
    const supplier = taxIdCands.find(c => !c.customerCtx);
    const customer = taxIdCands.find(c => c.customerCtx && (!supplier || c.digits !== supplier.digits));
    const pick = (key, c, extraDoubt, extraNote) => {
      if (!c) return;
      const valid = P.validateTaxId(c.digits);
      setOcr(key, c.digits, {
        conf: c.conf,
        doubt: !valid || extraDoubt,
        note: [valid ? '' : 'NIF com dígito de controlo inválido (possível erro de leitura)', extraNote].filter(Boolean).join('; '),
      });
    };
    pick('supplierTaxId', supplier, false, '');
    if (customer) pick('customerTaxId', customer, false, '');
    else {
      const distinct = [...new Set(taxIdCands.map(c => c.digits))];
      if (supplier && distinct.length === 2) {
        const other = taxIdCands.find(c => c.digits !== supplier.digits);
        pick('customerTaxId', other, true, 'Assumido como NIF do cliente por ser o segundo NIF do documento');
      }
    }
    if (fields.customerTaxId.value === P.GENERIC_CONSUMER_TAX_ID) {
      fields.customerTaxId = { ...emptyField(), note: 'Consumidor final (NIF genérico 999999990)' };
    }
  }

  // ---------------------------------------------------------------- Nº da fatura
  {
    const codes = P.DOC_TYPE_CODES.join('|');
    const reDoc = new RegExp(`(?<![A-Z0-9])(${codes})\\s?([A-Z0-9][A-Z0-9.\\-_]*)?\\s?\\/\\s?(\\d{1,10})(?![\\d])`, 'gi');
    const cands = [];
    L.forEach((l, i) => {
      let m;
      while ((m = reDoc.exec(l.text))) {
        const code = m[1].toUpperCase();
        const series = (m[2] || '').toUpperCase();
        const value = series ? `${code} ${series}/${m[3]}` : `${code}/${m[3]}`;
        const before = N[i].slice(0, m.index);
        const isRef = /\b(ref|referencia|origem|relativ|corrige|anula)/.test(before);
        cands.push({ value, conf: l.conf, labeled: K.invoiceNo.test(N[i]) && !isRef, isRef });
      }
    });
    let chosen = null, doubt = false, note = '';
    const primary = cands.filter(c => !c.isRef);
    const pool = primary.length ? primary : cands;
    const distinct = [...new Set(pool.map(c => c.value))];
    if (distinct.length === 1) chosen = pool[0];
    else if (distinct.length > 1) {
      const labeled = pool.filter(c => c.labeled);
      const dl = [...new Set(labeled.map(c => c.value))];
      chosen = dl.length === 1 ? labeled[0] : pool[0];
      doubt = dl.length !== 1;
      note = doubt ? `Vários números possíveis: ${distinct.join(', ')}` : '';
    }
    if (!chosen) {
      // formato livre: "Fatura n.º 12345"
      const reFree = /(fatura|factura|invoice|fatura-recibo|factura-recibo)\s*(n\.?\s?[ºo]?\.?|no\.?|num(ero)?\.?|#)\s*[:.]?\s*([a-z0-9][a-z0-9\/\-.]{0,30})/i;
      for (let i = 0; i < L.length; i++) {
        const m = L[i].text.match(reFree) ;
        if (m && /\d/.test(m[4])) { chosen = { value: m[4].toUpperCase(), conf: L[i].conf }; break; }
      }
    }
    if (chosen) setOcr('invoiceNumber', chosen.value, { conf: chosen.conf, doubt, note });
  }

  // ---------------------------------------------------------------- Data de emissão
  {
    const cands = [];
    L.forEach((l, i) => {
      for (const d of findDates(l.text, P.DATE_ORDER)) {
        const before = N[i].slice(Math.max(0, d.index - 30), d.index);
        const excluded = K.notIssueDate.test(before);
        const labeled = !excluded && K.issueDate.test(before);
        cands.push({ ...d, conf: l.conf, labeled, excluded });
      }
    });
    const labeled = cands.filter(c => c.labeled);
    const usable = cands.filter(c => !c.excluded);
    const pickFrom = (arr, unlabeled) => {
      const distinct = [...new Set(arr.map(c => c.iso))];
      const c = arr[0];
      const notesArr = [];
      if (unlabeled) notesArr.push('Data sem etiqueta "Data de emissão"');
      if (distinct.length > 1) notesArr.push(`Várias datas possíveis: ${distinct.map(x => x.split('-').reverse().join('/')).join(', ')}`);
      if (c.twoDigitYear) notesArr.push('Ano com 2 dígitos');
      setOcr('issueDate', c.iso, { conf: c.conf, doubt: unlabeled || distinct.length > 1 || c.twoDigitYear, note: notesArr.join('; ') });
    };
    if (labeled.length) pickFrom(labeled, false);
    else if (usable.length) pickFrom(usable, true);
  }

  // ---------------------------------------------------------------- Fornecedor (nome)
  {
    const firstStop = (() => {
      const idx = L.findIndex((_, i) => K.customer.test(N[i]));
      return idx === -1 ? Math.min(L.length, 10) : Math.min(idx, 10);
    })();
    const cands = [];
    for (let i = 0; i < firstStop; i++) {
      const t = L[i].text.trim();
      const n = N[i];
      if (t.length < 3 || t.length > 80) continue;
      if (letters(t) < 3 || letters(t) / t.replace(/\s/g, '').length < 0.6) continue;
      const hasSuffix = K.companySuffix.test(n);
      if (!hasSuffix && K.headerNoise.test(n)) continue;
      if (new RegExp(`\\b(${P.DOC_TYPE_CODES.join('|')})\\b\\s?\\S*\\/`, 'i').test(t)) continue;
      cands.push({ text: t.replace(/\s*[-–|,]?\s*(nif|nipc|contribuinte)\b.*$/i, '').trim(), conf: L[i].conf, hasSuffix });
    }
    const withSuffix = cands.find(c => c.hasSuffix);
    if (withSuffix) setOcr('supplierName', withSuffix.text, { conf: withSuffix.conf });
    else if (cands.length) setOcr('supplierName', cands[0].text, { conf: cands[0].conf, doubt: true, note: 'Nome deduzido do cabeçalho; confirme' });
  }

  // ---------------------------------------------------------------- Cliente (nome)
  {
    const re = /^(.*?)(cliente|exmo\(?s?\)?\.?\s*(sr|sra)?\(?s?\)?\.?\(?a?\)?|customer|bill to|faturar a|adquirente)\s*(nome)?\s*[:\-]?\s*(.*)$/i;
    const strip = v => v.replace(/\s*[-–|,]?\s*(nif|nipc|contribuinte|n\.?\s?contrib)\b.*$/i, '').trim();
    const looksName = v => v.length >= 3 && letters(v) >= 3 && letters(v) / v.replace(/\s/g, '').length > 0.6 && !/^(n\.?º|nº|numero|codigo|cod\.?)/i.test(norm(v));
    for (let i = 0; i < L.length; i++) {
      const m = L[i].text.match(re);
      if (!m) continue;
      if (/consumidor\s+final/.test(N[i])) { fields.customerName = { ...emptyField(), note: 'Consumidor final' }; break; }
      let v = strip(m[5] || '');
      if (/^(n\.?º|nº|n\.?\s?o|numero|cod)/i.test(norm(v))) v = '';
      if (looksName(v)) { setOcr('customerName', v, { conf: L[i].conf }); break; }
      const next = L[i + 1];
      if (next) {
        const nv = strip(next.text.replace(/^\s*nome\s*[:\-]?\s*/i, ''));
        if (looksName(nv) && !K.taxId.test(norm(nv))) { setOcr('customerName', nv, { conf: next.conf, doubt: true, note: 'Nome lido na linha seguinte à etiqueta' }); break; }
      }
    }
  }

  // ---------------------------------------------------------------- Moeda
  {
    const counts = {};
    const all = N.join('\n');
    const add = (c, re) => { const n = (all.match(re) || []).length; if (n) counts[c] = (counts[c] || 0) + n; };
    add('EUR', /€|\beur\b|\beuros?\b/g);
    add('USD', /\busd\b|us\$/g);
    add('GBP', /\bgbp\b|£/g);
    add('BRL', /\bbrl\b|r\$/g);
    const keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    const reByCur = { EUR: /€|\beur\b|\beuros?\b/, USD: /\busd\b|us\$/, GBP: /\bgbp\b|£/, BRL: /\bbrl\b|r\$/ };
    const curConf = c => {
      const cs = L.filter((_, i) => reByCur[c].test(N[i])).map(l => l.conf);
      return cs.some(x => x === null) ? null : Math.max(...cs);
    };
    if (keys.length === 1) setOcr('currency', keys[0], { conf: curConf(keys[0]) });
    else if (keys.length > 1) setOcr('currency', keys[0], { conf: curConf(keys[0]), doubt: true, note: `Várias moedas no texto: ${keys.join(', ')}` });
    else if (/\$/.test(all)) setOcr('currency', null, { doubt: true, note: 'Símbolo "$" sem indicação da moeda' });
    if (fields.currency.value === null && fields.currency.status === 'doubt') fields.currency.value = null;
  }

  // ---------------------------------------------------------------- Totais
  {
    const excludeTotal = /\b(desconto|descontos|qtd|quantidade|artigos|itens|unidades|retenc|retencao|pago|troco|recebido|entregue|pontos|peso|volumes)\b/;
    const buckets = { totalVat: [], totalNet: [], totalStrong: [], totalWeak: [] };
    for (let i = 0; i < L.length; i++) {
      const n = N[i];
      let cat = null;
      if (K.vatTotal.test(n)) cat = 'totalVat';
      else if (K.net.test(n)) cat = 'totalNet';
      else if (K.totalStrong.test(n)) cat = 'totalStrong';
      else if (K.totalWeak.test(n) && !excludeTotal.test(n) && !/subtotal/.test(n) && !/%/.test(n)) cat = 'totalWeak';
      if (!cat) continue;
      if ((cat === 'totalNet' || cat === 'totalVat') && /\d\s?%/.test(n)) continue; // linha do quadro de IVA
      let amts = findAmounts(L[i].text), conf = L[i].conf;
      if (!amts.length && L[i + 1] && letters(L[i + 1].text) < 5) { amts = findAmounts(L[i + 1].text); conf = L[i + 1].conf; }
      if (!amts.length) continue;
      const a = amts[amts.length - 1];
      buckets[cat].push({ value: a.value, ambiguous: a.ambiguous, conf });
    }
    const pick = (key, arr) => {
      if (!arr.length) return false;
      const distinct = [...new Set(arr.map(c => c.value))];
      const c = arr[0];
      const notesArr = [];
      if (distinct.length > 1) notesArr.push(`Vários valores possíveis: ${distinct.map(v => v.toFixed(2).replace('.', ',')).join(' / ')}`);
      if (c.ambiguous) notesArr.push('Separador decimal ambíguo');
      setOcr(key, c.value, { conf: c.conf, doubt: distinct.length > 1 || c.ambiguous, note: notesArr.join('; ') });
      return true;
    };
    pick('totalVat', buckets.totalVat);
    pick('totalNet', buckets.totalNet);
    if (!pick('total', buckets.totalStrong)) {
      // "Total" simples: o último costuma ser o total final
      const weak = buckets.totalWeak;
      if (weak.length) {
        const last = weak[weak.length - 1];
        const distinct = [...new Set(weak.map(c => c.value))];
        setOcr('total', last.value, {
          conf: last.conf,
          doubt: distinct.length > 1 || last.ambiguous,
          note: distinct.length > 1 ? `Vários "Total": ${distinct.map(v => v.toFixed(2).replace('.', ',')).join(' / ')}` : '',
        });
      }
    }
  }

  // ---------------------------------------------------------------- IVA por taxa
  let vat = [];
  {
    const rows = [];
    for (let i = 0; i < L.length; i++) {
      const t = L[i].text, n = N[i];
      const pct = [...t.matchAll(/(?<![\d,.])(\d{1,2})(?:[.,]0{1,2})?\s?%/g)].map(m => Number(m[1])).filter(r => P.KNOWN_RATES.includes(r));
      const isExempt = /\bisent[oa]\b|\bisencao\b/.test(n) && !pct.length;
      if (!pct.length && !isExempt) continue;
      const textLetters = letters(n.replace(K.vatTable, '').replace(/\b(base|total|valor|eur)\b/g, ''));
      if (!K.vatTable.test(n) && textLetters > 6) continue; // provável linha de artigo
      if (textLetters > 25) continue;
      const rate = isExempt ? 0 : pct[0];
      const amts = findAmounts(t).map(a => a.value);
      const tol = b => 0.02 + Math.abs(b) * 0.0005;
      let row = null;
      if (rate === 0) {
        if (amts.length) row = { rate: 0, base: amts[0], vat: 0, status: amts.length > 2 ? 'doubt' : 'ok', note: '' };
      } else if (amts.length >= 2) {
        outer: for (let a = 0; a < amts.length; a++) for (let b = 0; b < amts.length; b++) {
          if (a === b) continue;
          if (Math.abs(amts[a] * rate / 100 - amts[b]) <= tol(amts[a]) && amts[a] > amts[b]) {
            row = { rate, base: amts[a], vat: amts[b], status: 'ok', note: '' }; break outer;
          }
        }
        if (!row) row = { rate, base: amts[0], vat: amts[1], status: 'doubt', note: 'Base × taxa não coincide com o IVA lido' };
      } else if (amts.length === 1) {
        const isBase = /\b(incid|base)/.test(n) && !/\biva\b.*\d/.test(n.replace(/incid\w*|base/g, ''));
        row = isBase ? { rate, base: amts[0], vat: null, status: 'doubt', note: 'Só foi lido um valor (base)' }
                     : { rate, base: null, vat: amts[0], status: 'doubt', note: 'Só foi lido um valor (IVA)' };
      }
      if (!row) continue;
      const cn = confNote(L[i].conf);
      if (cn) { row.status = 'doubt'; row.note = [row.note, cn].filter(Boolean).join('; '); }
      row.source = 'ocr';
      row.kw = K.vatTable.test(n);
      if (!row.kw && row.status === 'doubt') continue; // linha sem etiqueta e incoerente: provavelmente artigo
      rows.push(row);
    }
    // Se existe um quadro de IVA identificado (linhas com "IVA", "Taxa", "Incidência"...), só ele conta.
    if (rows.some(r => r.kw)) for (let i = rows.length - 1; i >= 0; i--) if (!rows[i].kw) rows.splice(i, 1);
    rows.forEach(r => delete r.kw);
    // remover duplicados exatos; assinalar taxas repetidas com valores diferentes
    for (const r of rows) {
      const same = vat.find(v => v.rate === r.rate);
      if (!same) { vat.push(r); continue; }
      if (same.base === r.base && same.vat === r.vat) continue;
      same.status = 'doubt';
      same.note = [same.note, `Outra linha com ${r.rate}%: ${r.base ?? '-'} / ${r.vat ?? '-'}`].filter(Boolean).join('; ');
    }
  }

  // ---------------------------------------------------------------- Fusão com o QR
  if (qr) {
    const qrSet = (key, value, note = '') => {
      if (value === null || value === undefined || value === '') return;
      const prev = fields[key];
      const differs = prev.value !== null && prev.value !== '' && String(prev.value).replace(/\s/g, '').toUpperCase() !== String(value).replace(/\s/g, '').toUpperCase();
      fields[key] = { value, status: 'ok', source: 'qr', note: [note, differs ? `Texto da imagem: ${prev.value}` : ''].filter(Boolean).join('; ') };
    };
    qrSet('supplierTaxId', qr.supplierTaxId);
    if (qr.customerTaxId) qrSet('customerTaxId', qr.customerTaxId);
    else if (qr.customerIsGenericConsumer) fields.customerTaxId = { ...emptyField(), note: 'Consumidor final (NIF genérico 999999990)' };
    qrSet('issueDate', qr.issueDate);
    qrSet('invoiceNumber', qr.invoiceNumber);

    const ocrCurrency = fields.currency.value;
    const amountsUsable = !ocrCurrency || ocrCurrency === 'EUR';
    if (!amountsUsable) {
      notes.push(`Documento em ${ocrCurrency}: os valores do QR (sempre em euros) não foram usados.`);
    } else {
      qrSet('total', qr.total);
      if (qr.vat.length) {
        vat = qr.vat.map(r => ({ rate: r.rate, base: r.base, vat: r.vat ?? 0, status: r.rate === null ? 'doubt' : 'ok', source: 'qr', note: r.region === 'NS' ? 'Não sujeito / não tributável' : '' }));
        const sumBase = round2(qr.vat.reduce((s, r) => s + (r.base || 0), 0));
        const sumVat = round2(qr.vat.reduce((s, r) => s + (r.vat || 0), 0));
        fields.totalNet = { value: sumBase, status: 'ok', source: 'calc', note: ['Soma das bases do QR fiscal', fields.totalNet.value !== null && fields.totalNet.value !== sumBase ? `Texto da imagem: ${fields.totalNet.value}` : ''].filter(Boolean).join('; ') };
        fields.totalVat = { value: sumVat, status: 'ok', source: 'calc', note: ['Soma do IVA do QR fiscal', qr.stampDuty ? `Imposto do Selo à parte: ${qr.stampDuty}` : ''].filter(Boolean).join('; ') };
      } else if (qr.totalTaxes !== null && !qr.stampDuty) {
        qrSet('totalVat', qr.totalTaxes);
      }
      if (!ocrCurrency) fields.currency = { value: 'EUR', status: 'doubt', source: 'qr', note: 'Moeda não escrita no texto; o QR fiscal usa sempre euros. Confirme.' };
    }
    if (qr.warnings.length) notes.push(...qr.warnings);
  }

  // ---------------------------------------------------------------- Qualidade global
  const confs = L.map(l => l.conf).filter(c => typeof c === 'number');
  const avgConf = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null;
  if (avgConf !== null && avgConf < lowConf) notes.push(`Imagem pouco legível (confiança média ${Math.round(avgConf)}%). Reveja todos os campos.`);
  if (!L.length && !qr) notes.push('Não foi possível ler texto na imagem. Preencha os campos manualmente.');

  return { fields, vat, qr, notes, avgConf };
}
