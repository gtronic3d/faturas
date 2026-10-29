// Controlador da interface. Sem frameworks: módulos ES nativos, sem passo de build.

import profile from './profiles/pt.js';
import { extractInvoice, FIELD_KEYS, MONEY_FIELDS } from './lib/extract.js';
import { validateRecord, findDuplicates } from './lib/validate.js';
import { parseUserNumber, formatMoney, formatNumberInput } from './lib/numbers.js';
import { formatDatePt } from './lib/dates.js';
import { exportXlsx, imageFileName, FIELD_LABELS } from './lib/export.js';
import { makeZip } from './lib/zip.js';
import { db, requestPersistence, storageEstimate } from './lib/db.js';
import { loadImage, thumbnail, decodeQr, recognizeText, linesFromText, engines } from './lib/ocr.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STATUS_LABEL = { ok: 'lido', doubt: 'confirmar', missing: 'não encontrado', edited: 'editado', confirmed: 'confirmado', calc: 'calculado' };

const state = {
  records: [],
  selected: new Set(),
  draft: null,       // registo em revisão
  draftBlob: null,   // imagem original (só para registos novos)
  isNew: false,
};

// ====================================================================== util
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

function newId() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `F${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${rnd}`;
}

function show(view) {
  for (const v of ['list', 'review', 'about']) $(`#view-${v}`).hidden = v !== view;
  $('#btn-back').hidden = view === 'list';
  $('#btn-about').hidden = view !== 'list';
  $('#title').textContent = view === 'list' ? 'Faturas' : view === 'about' ? 'Privacidade e estado' : (state.isNew ? 'Rever fatura' : 'Editar fatura');
  window.scrollTo(0, 0);
}

async function deliverFile(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (!globalThis.__FATURAS_TEST__ && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// ====================================================================== lista
async function reload() {
  state.records = (await db.listInvoices()).sort((a, b) =>
    (b.fields.issueDate || '').localeCompare(a.fields.issueDate || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
  for (const id of [...state.selected]) if (!state.records.some(r => r.id === id)) state.selected.delete(id);
  renderSupplierFilter();
  renderList();
}

function renderSupplierFilter() {
  const sel = $('#f-supplier');
  const cur = sel.value;
  const names = [...new Set(state.records.map(r => r.fields.supplierName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt'));
  sel.innerHTML = '<option value="">Todos os fornecedores</option>' + names.map(n => `<option>${esc(n)}</option>`).join('');
  if (names.includes(cur)) sel.value = cur;
}

function visibleRecords() {
  const q = $('#f-search').value.trim().toLowerCase();
  const from = $('#f-from').value, to = $('#f-to').value, sup = $('#f-supplier').value;
  return state.records.filter(r => {
    const f = r.fields;
    if (sup && f.supplierName !== sup) return false;
    if (from && (!f.issueDate || f.issueDate < from)) return false;
    if (to && (!f.issueDate || f.issueDate > to)) return false;
    if (q) {
      const hay = [f.supplierName, f.supplierTaxId, f.invoiceNumber, f.customerName, f.customerTaxId].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderList() {
  const vis = visibleRecords();
  $('#empty').hidden = state.records.length > 0;
  $('#list').innerHTML = vis.map(r => {
    const f = r.fields;
    const pending = Object.values(r.review || {}).some(s => s === 'doubt');
    const warns = validateRecord(r, profile).length;
    const dup = findDuplicates(r, state.records).length;
    return `<li class="item" data-id="${esc(r.id)}">
      <input type="checkbox" class="sel" ${state.selected.has(r.id) ? 'checked' : ''} aria-label="Selecionar">
      <img src="${esc(r.thumb || '')}" alt="">
      <div class="main">
        <div class="t1">${esc(f.supplierName || '(sem fornecedor)')}</div>
        <div class="t2">${esc(f.invoiceNumber || 's/ n.º')} · ${esc(formatDatePt(f.issueDate) || 's/ data')}</div>
        <div>${pending ? '<span class="badge warn">Por confirmar</span>' : ''}${warns ? '<span class="badge warn">Alerta</span>' : ''}${dup ? '<span class="badge err">Possível duplicado</span>' : ''}</div>
      </div>
      <div class="amt">${esc(formatMoney(f.total, f.currency))}</div>
    </li>`;
  }).join('');
  if (state.records.length && !vis.length) $('#list').innerHTML = '<p class="muted center">Nenhum registo corresponde aos filtros.</p>';
  updateSelection();
}

function updateSelection() {
  const n = state.selected.size;
  $('#sel-count').textContent = `${n} selecionada${n === 1 ? '' : 's'}`;
  $('#btn-export-xlsx').disabled = n === 0;
  $('#btn-export-zip').disabled = n === 0;
  const vis = visibleRecords();
  $('#sel-all').checked = vis.length > 0 && vis.every(r => state.selected.has(r.id));
}

// ====================================================================== captura
async function onImageChosen(file) {
  if (!file) return;
  state.isNew = true;
  show('review');
  $('#review').hidden = true;
  const prog = (text, p = null) => {
    $('#progress').hidden = false;
    $('#progress-text').textContent = text;
    if (p !== null) $('#progress-bar').style.width = `${Math.round(p * 100)}%`;
  };
  try {
    prog('A abrir a imagem…', 0.02);
    const img = await loadImage(file);
    const thumb = thumbnail(img);
    prog('A procurar o código QR fiscal…', 0.08);
    const qr = await decodeQr(img);
    prog('A reconhecer o texto (no dispositivo)…', 0.12);
    const ocr = await recognizeText(img, m => {
      const label = m.status === 'recognizing text' ? 'A reconhecer o texto (no dispositivo)…' : 'A preparar o motor de OCR…';
      prog(label, m.status === 'recognizing text' ? 0.15 + 0.85 * (m.progress || 0) : 0.12);
    });
    const ex = extractInvoice({ lines: ocr.lines, qrText: qr.text, profile });
    const extraNotes = [];
    if (ocr.unavailable) extraNotes.push('Motor de OCR não instalado nesta versão (ver README: "npm run vendor"). Pode colar o texto ou preencher manualmente.');
    if (qr.unavailable) extraNotes.push('Leitor de QR não instalado (ver README).');
    state.draftBlob = file;
    state.draft = draftFromExtraction(ex, {
      id: newId(), imageId: `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      imageType: file.type || 'image/jpeg', thumb,
      source: [qr.text ? 'QR' : null, ocr.lines.length ? 'OCR' : null].filter(Boolean).join(' + ') || 'manual',
    }, extraNotes);
    $('#progress').hidden = true;
    renderReview();
  } catch (e) {
    console.error(e);
    $('#progress').hidden = true;
    toast('Não foi possível processar a imagem: ' + e.message, 5000);
    show('list');
  }
}

function draftFromExtraction(ex, base, extraNotes = []) {
  const fields = {}, review = {}, notes = {}, sources = {};
  for (const k of FIELD_KEYS) {
    const f = ex.fields[k];
    fields[k] = f.value ?? null;
    review[k] = f.status;
    notes[k] = f.note || '';
    sources[k] = f.source || '';
  }
  return {
    ...base,
    createdAt: new Date().toISOString(),
    fields, review, notes, sources,
    vat: ex.vat.map(v => ({ rate: v.rate, base: v.base, vat: v.vat, status: v.status, note: v.note || '' })),
    extractionNotes: [...extraNotes, ...ex.notes],
  };
}

// ====================================================================== revisão
const FIELD_INPUT = {
  supplierName: { type: 'text' },
  supplierTaxId: { type: 'text', inputmode: 'numeric', maxlength: 20 },
  invoiceNumber: { type: 'text' },
  issueDate: { type: 'date' },
  customerName: { type: 'text' },
  customerTaxId: { type: 'text', inputmode: 'numeric', maxlength: 20 },
  currency: { type: 'text', maxlength: 3, upper: true },
  totalNet: { type: 'text', inputmode: 'decimal', money: true },
  totalVat: { type: 'text', inputmode: 'decimal', money: true },
  total: { type: 'text', inputmode: 'decimal', money: true },
};

function renderReview() {
  const d = state.draft;
  $('#review').hidden = false;
  $('#rv-thumb').src = d.thumb || '';
  $('#rv-source').textContent = `Origem: ${d.source || 'manual'} · ID ${d.id}`;
  $('#rv-delete').hidden = state.isNew;
  $('#rv-notes').innerHTML = (d.extractionNotes || []).map(n => `<div class="note">${esc(n)}</div>`).join('');
  $('#rv-fields').innerHTML = FIELD_KEYS.map(k => {
    const cfg = FIELD_INPUT[k];
    const st = d.review[k] || 'missing';
    const v = d.fields[k];
    const val = cfg.money ? formatNumberInput(v) : (v ?? '');
    const showConfirm = st === 'doubt';
    return `<div class="field ${st === 'doubt' ? 'doubt' : st === 'missing' ? 'missing' : 'ok'}" data-k="${k}">
      <label for="fld-${k}"><span>${esc(FIELD_LABELS[k])}</span><span class="st">${esc(STATUS_LABEL[st] || st)}${d.sources?.[k] === 'qr' ? ' (QR)' : ''}</span></label>
      <div class="inrow">
        <input id="fld-${k}" name="${k}" type="${cfg.type}" value="${esc(val)}" ${cfg.inputmode ? `inputmode="${cfg.inputmode}"` : ''} ${cfg.maxlength ? `maxlength="${cfg.maxlength}"` : ''} placeholder="${st === 'missing' ? 'vazio' : ''}">
        ${showConfirm ? `<button type="button" class="btn small confirm" data-k="${k}">Confirmar</button>` : ''}
      </div>
      ${d.notes?.[k] ? `<div class="hint">${esc(d.notes[k])}</div>` : ''}
    </div>`;
  }).join('');
  renderVat();
  renderValidation();
}

function renderVat() {
  const d = state.draft;
  $('#rv-vat').innerHTML = d.vat.map((v, i) => `<tr class="${v.status === 'doubt' ? 'doubt' : ''}" data-i="${i}" title="${esc(v.note || '')}">
    <td><input name="rate" inputmode="decimal" value="${v.rate ?? ''}" aria-label="Taxa"></td>
    <td><input name="base" inputmode="decimal" value="${formatNumberInput(v.base)}" aria-label="Base"></td>
    <td><input name="vat" inputmode="decimal" value="${formatNumberInput(v.vat)}" aria-label="IVA"></td>
    <td class="rm"><button type="button" class="btn small rm-vat" aria-label="Remover">×</button></td>
  </tr>${v.note && v.status === 'doubt' ? `<tr><td colspan="4" class="small" style="color:var(--warn)">${esc(v.note)}</td></tr>` : ''}`).join('');
}

function draftForValidation() {
  const d = state.draft;
  return { id: d.id, fields: d.fields, vat: d.vat.map(v => ({ rate: v.rate, base: v.base, vat: v.vat })) };
}

function renderValidation() {
  const rec = draftForValidation();
  const issues = validateRecord(rec, profile);
  const dups = findDuplicates(rec, state.records);
  const pending = FIELD_KEYS.filter(k => state.draft.review[k] === 'doubt');
  const html = [];
  if (pending.length) html.push(`<div class="v warn">Por confirmar: ${esc(pending.map(k => FIELD_LABELS[k]).join(', '))}</div>`);
  for (const i of issues) html.push(`<div class="v ${i.level}">${esc(i.msg)}</div>`);
  for (const dRec of dups) html.push(`<div class="v error">Possível duplicado: ${esc(dRec.fields.supplierName || dRec.fields.supplierTaxId || '')} ${esc(dRec.fields.invoiceNumber || '')} de ${esc(formatDatePt(dRec.fields.issueDate))} (já registado). Não foi eliminado nada.</div>`);
  if (!html.length) html.push('<div class="v ok">Sem alertas: totais coerentes.</div>');
  $('#rv-validation').innerHTML = '<h3 style="margin:0 0 6px;font-size:15px">Verificações</h3>' + html.join('');
  const f = state.draft.fields;
  $('#rv-summary').textContent = [f.supplierName, f.total !== null && f.total !== undefined ? formatMoney(f.total, f.currency) : null].filter(Boolean).join(' · ');
}

function onFieldInput(e) {
  const el = e.target;
  const d = state.draft;
  if (!d) return;
  if (el.closest('.field')) {
    const k = el.name;
    const cfg = FIELD_INPUT[k];
    let v = el.value;
    if (cfg.upper) { v = v.toUpperCase(); el.value = v; }
    if (cfg.money) v = parseUserNumber(v);
    else v = v.trim() === '' ? null : (k.endsWith('TaxId') ? v.replace(/\s/g, '') : v.trim());
    d.fields[k] = v;
    d.review[k] = v === null ? 'missing' : 'edited';
    const box = el.closest('.field');
    box.className = `field ${v === null ? 'missing' : 'ok'}`;
    box.querySelector('.st').textContent = STATUS_LABEL[d.review[k]];
    box.querySelector('.confirm')?.remove();
  } else if (el.closest('#rv-vat')) {
    const i = Number(el.closest('tr').dataset.i);
    const v = parseUserNumber(el.value);
    d.vat[i][el.name] = v;
    d.vat[i].status = 'edited';
    el.closest('tr').classList.remove('doubt');
  }
  renderValidation();
}

async function applyPastedText() {
  const text = $('#rv-paste').value;
  if (!text.trim()) return toast('Cole primeiro o texto da fatura.');
  const ex = extractInvoice({ lines: linesFromText(text), qrText: null, profile });
  const d = state.draft;
  let changed = 0;
  for (const k of FIELD_KEYS) {
    if (['edited', 'confirmed'].includes(d.review[k])) continue; // não sobrepor o que o utilizador já tratou
    if (d.sources?.[k] === 'qr' || d.sources?.[k] === 'calc') continue; // QR fiscal tem prioridade
    const f = ex.fields[k];
    if (f.value === null || f.value === undefined) continue;
    d.fields[k] = f.value; d.review[k] = f.status; d.notes[k] = f.note; d.sources[k] = 'texto';
    changed++;
  }
  if (!d.vat.length && ex.vat.length) { d.vat = ex.vat.map(v => ({ ...v })); changed++; }
  renderReview();
  toast(changed ? `${changed} campo(s) preenchido(s) a partir do texto.` : 'Nenhum campo novo encontrado no texto.');
}

async function saveDraft() {
  const d = state.draft;
  const bad = FIELD_KEYS.filter(k => Number.isNaN(d.fields[k]));
  if (bad.length || d.vat.some(v => [v.rate, v.base, v.vat].some(Number.isNaN))) {
    return toast('Há valores numéricos inválidos. Corrija antes de guardar.', 4000);
  }
  const pending = FIELD_KEYS.filter(k => d.review[k] === 'doubt');
  if (pending.length && !confirm(`Há ${pending.length} campo(s) por confirmar (${pending.map(k => FIELD_LABELS[k]).join(', ')}).\nGuardar mesmo assim? Ficarão assinalados.`)) return;
  const dups = findDuplicates(draftForValidation(), state.records);
  if (dups.length && !confirm('Esta fatura parece duplicada (mesmo fornecedor, número e data). Guardar mesmo assim?')) return;

  const rec = {
    id: d.id, createdAt: d.createdAt, updatedAt: new Date().toISOString(),
    fields: { ...d.fields },
    vat: d.vat.filter(v => v.rate !== null || v.base !== null || v.vat !== null).map(v => ({ rate: v.rate, base: v.base, vat: v.vat })),
    review: Object.fromEntries(FIELD_KEYS.map(k => [k, d.review[k] === 'doubt' ? 'doubt' : (d.fields[k] === null ? 'missing' : 'ok')])),
    notes: d.notes, sources: d.sources, source: d.source,
    imageId: d.imageId, imageType: d.imageType, thumb: d.thumb,
  };
  await db.saveInvoice(rec, state.isNew ? state.draftBlob : null);
  state.draft = null; state.draftBlob = null;
  await reload();
  show('list');
  toast('Fatura guardada.');
}

async function openRecord(id) {
  const rec = await db.getInvoice(id);
  if (!rec) return;
  state.isNew = false;
  state.draftBlob = null;
  state.draft = {
    ...rec,
    review: { ...rec.review }, notes: { ...(rec.notes || {}) }, sources: { ...(rec.sources || {}) },
    vat: (rec.vat || []).map(v => ({ ...v, status: 'ok' })),
    extractionNotes: [],
  };
  show('review');
  $('#progress').hidden = true;
  renderReview();
}

async function showImage() {
  const d = state.draft;
  let blob = state.draftBlob;
  if (!blob && d?.imageId) blob = (await db.getImage(d.imageId))?.blob;
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  $('#lightbox-img').src = url;
  $('#lightbox').hidden = false;
  $('#lightbox').onclick = () => { $('#lightbox').hidden = true; URL.revokeObjectURL(url); };
}

// ====================================================================== exportação
function selectedRecords() {
  return state.records.filter(r => state.selected.has(r.id))
    .sort((a, b) => (a.fields.issueDate || '').localeCompare(b.fields.issueDate || ''));
}
const stamp = () => new Date().toISOString().slice(0, 10);

async function exportSelected(withImages) {
  const recs = selectedRecords();
  if (!recs.length) return;
  const xlsx = exportXlsx(recs, profile, state.records);
  if (!withImages) {
    return deliverFile(new Blob([xlsx], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `faturas_${stamp()}.xlsx`);
  }
  const entries = [{ name: `faturas_${stamp()}.xlsx`, data: xlsx }];
  for (const r of recs) {
    const im = r.imageId ? await db.getImage(r.imageId) : null;
    if (im?.blob) entries.push({ name: imageFileName(r), data: new Uint8Array(await im.blob.arrayBuffer()) });
  }
  return deliverFile(new Blob([makeZip(entries)], { type: 'application/zip' }), `faturas_${stamp()}.zip`);
}

// ====================================================================== info
async function renderAbout() {
  const est = await storageEstimate();
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  const ocrOk = await engines.tesseract.available();
  const mb = n => (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
  $('#about-status').innerHTML = [
    `Registos guardados: <b>${state.records.length}</b>`,
    est ? `Espaço usado: ${mb(est.usage || 0)}${est.quota ? ` de ${mb(est.quota)} disponíveis` : ''}` : '',
    `Armazenamento persistente: ${persisted ? 'sim' : 'não garantido (adicione ao ecrã principal)'}`,
    `Motor de OCR: ${ocrOk ? engines.tesseract.label : 'não instalado (ver README)'}`,
    `Funciona sem Internet: ${navigator.serviceWorker?.controller ? 'sim' : 'após a primeira abertura'}`,
  ].filter(Boolean).map(s => `<div>${s}</div>`).join('');
}

// ====================================================================== eventos
function bind() {
  $('#in-camera').addEventListener('change', e => { onImageChosen(e.target.files[0]); e.target.value = ''; });
  $('#in-gallery').addEventListener('change', e => { onImageChosen(e.target.files[0]); e.target.value = ''; });
  for (const id of ['#f-search', '#f-from', '#f-to', '#f-supplier']) $(id).addEventListener('input', renderList);
  $('#f-clear').addEventListener('click', () => { $('#f-search').value = ''; $('#f-from').value = ''; $('#f-to').value = ''; $('#f-supplier').value = ''; renderList(); });
  $('#list').addEventListener('click', e => {
    const li = e.target.closest('.item'); if (!li) return;
    if (e.target.classList.contains('sel')) {
      e.target.checked ? state.selected.add(li.dataset.id) : state.selected.delete(li.dataset.id);
      updateSelection();
    } else openRecord(li.dataset.id);
  });
  $('#sel-all').addEventListener('change', e => {
    for (const r of visibleRecords()) e.target.checked ? state.selected.add(r.id) : state.selected.delete(r.id);
    renderList();
  });
  $('#btn-export-xlsx').addEventListener('click', () => exportSelected(false).catch(err => toast('Erro na exportação: ' + err.message)));
  $('#btn-export-zip').addEventListener('click', () => exportSelected(true).catch(err => toast('Erro na exportação: ' + err.message)));

  $('#rv-form').addEventListener('input', onFieldInput);
  $('#rv-form').addEventListener('submit', e => e.preventDefault());
  $('#rv-fields').addEventListener('click', e => {
    const b = e.target.closest('.confirm'); if (!b) return;
    const k = b.dataset.k;
    const d = state.draft;
    d.review[k] = d.fields[k] === null ? 'missing' : 'confirmed';
    const box = b.closest('.field');
    box.className = `field ${d.review[k] === 'missing' ? 'missing' : 'ok'}`;
    box.querySelector('.st').textContent = STATUS_LABEL[d.review[k]];
    b.remove();
    renderValidation();
  });
  $('#rv-vat').addEventListener('click', e => {
    if (!e.target.classList.contains('rm-vat')) return;
    state.draft.vat.splice(Number(e.target.closest('tr').dataset.i), 1);
    renderVat(); renderValidation();
  });
  $('#rv-vat-add').addEventListener('click', () => { state.draft.vat.push({ rate: null, base: null, vat: null, status: 'edited' }); renderVat(); });
  $('#rv-paste-run').addEventListener('click', applyPastedText);
  $('#rv-save').addEventListener('click', () => saveDraft().catch(err => toast('Erro ao guardar: ' + err.message, 5000)));
  $('#rv-cancel').addEventListener('click', () => { state.draft = null; show('list'); });
  $('#rv-delete').addEventListener('click', async () => {
    if (!confirm('Eliminar este registo e a imagem associada? Esta ação não pode ser anulada.')) return;
    await db.deleteInvoice(state.draft.id);
    state.selected.delete(state.draft.id);
    state.draft = null;
    await reload(); show('list'); toast('Registo eliminado.');
  });
  $('#rv-thumb').addEventListener('click', showImage);
  $('#btn-back').addEventListener('click', () => { state.draft = null; show('list'); });
  $('#btn-about').addEventListener('click', () => { show('about'); renderAbout(); });
  $('#btn-clear-all').addEventListener('click', async () => {
    if (!confirm('Apagar TODOS os registos e imagens deste dispositivo?')) return;
    if (!confirm('Confirma? Esta ação é irreversível. Exportou antes os dados?')) return;
    await db.clearAll(); state.selected.clear(); await reload(); show('list'); toast('Dados apagados.');
  });
}

async function init() {
  bind();
  await reload();
  requestPersistence();
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !globalThis.__FATURAS_TEST__?.noSW) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW não registado', e));
  }
  globalThis.__faturasReady = true;
}

init();
