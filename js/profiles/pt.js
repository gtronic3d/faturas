// Perfil de país: Portugal.
// Tudo o que é específico do país (NIF, taxas de IVA, QR da AT, palavras-chave)
// vive aqui, para que outro país possa ser suportado com um novo perfil
// sem alterar o motor de extração.

/** Taxas de IVA por espaço fiscal (TaxCountryRegion do SAF-T).
 *  Fonte: CIVA / InvoiceXpress (atualizado 13/02/2026). Rever quando a lei mudar. */
export const VAT_RATES = {
  'PT':    { reduced: 6, intermediate: 13, normal: 23 },
  'PT-AC': { reduced: 4, intermediate: 9,  normal: 16 },
  'PT-MA': { reduced: 4, intermediate: 12, normal: 22 },
};

/** Todas as taxas conhecidas (inclui 0 = isento). */
export const KNOWN_RATES = [0, ...new Set(Object.values(VAT_RATES).flatMap(r => [r.reduced, r.intermediate, r.normal]))].sort((a, b) => a - b);

/** Valida um NIF/NIPC português (9 dígitos, dígito de controlo módulo 11). */
export function validateTaxId(raw) {
  const nif = String(raw ?? '').replace(/\s+/g, '').replace(/^PT/i, '');
  if (!/^\d{9}$/.test(nif)) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(nif[i]) * (9 - i);
  const mod = sum % 11;
  const check = mod < 2 ? 0 : 11 - mod;
  return check === Number(nif[8]);
}

export function normalizeTaxId(raw) {
  return String(raw ?? '').replace(/[\s.\-]/g, '').replace(/^PT/i, '');
}

/** NIF genérico de "Consumidor final". */
export const GENERIC_CONSUMER_TAX_ID = '999999990';

/** Ordem de datas ambíguas (dd/mm/aaaa em Portugal). */
export const DATE_ORDER = 'DMY';

/** Palavras-chave (sem acentos, minúsculas) usadas pelo extrator. */
export const KEYWORDS = {
  taxId: /\b(nif|nipc|n\.?\s?i\.?\s?f|contribuinte|contrib|vat|tax\s?id|nº\s?fiscal|numero fiscal)\b/,
  customer: /\b(cliente|adquirente|exmo|exma|destinatario|customer|bill to|faturar a|consumidor)\b/,
  issueDate: /\b(data\s*(de\s*)?(emissao|doc(umento)?|fatura|factura)?|emitida em|date|data:)\b/,
  notIssueDate: /\b(vencimento|venc\.?|validade|pagamento ate|limite|entrega|carga|descarga|due)\b/,
  invoiceNo: /\b(fatura|factura|fatura-recibo|factura-recibo|fatura simplificada|invoice|documento|doc\.?)\s*(n\.?\s?[ºo°]?|num(ero)?|no\.?|#)?/,
  net: /\b(total\s*(s\/?|sem)\s*iva|total\s*iliquido|total\s*liquido|valor\s*liquido|base\s*tributavel|incidencia|subtotal|sub-total|valor\s*sem\s*iva|total\s*mercadoria|net\s*amount)\b/,
  vatTotal: /\b(total\s*(de\s*)?iva|iva\s*total|total\s*(de\s*)?imposto[s]?|valor\s*(do\s*)?iva|total\s*vat|vat\s*total)\b/,
  totalStrong: /\b(total\s*a\s*pagar|total\s*(do\s*)?documento|total\s*(da\s*)?fatura|total\s*(c\/?|com)\s*iva|total\s*final|total\s*geral|valor\s*a\s*pagar|total\s*\(?eur\)?|amount\s*due|grand\s*total)\b/,
  totalWeak: /\btotal\b/,
  vatTable: /\b(iva|taxa|incid|imposto|vat|isento|isencao|resumo)\b/,
  companySuffix: /\b(lda|ld\.?a|s\.?\s?a\.?|unipessoal|sgps|eni|crl|e\.?i\.?r\.?l)\b\.?/,
  headerNoise: /\b(fatura|factura|original|duplicado|triplicado|pagina|pag\.|nif|nipc|contribuinte|data|telefone|tel\.?|tlm|e-?mail|www|http|morada|cod\.?\s?postal|capital social|conservatoria|iban|atcud|recibo|cliente|exmo)\b/,
};

/** Códigos de tipo de documento usados em Portugal (InvoiceType do SAF-T e afins). */
export const DOC_TYPE_CODES = ['FT', 'FR', 'FS', 'NC', 'ND', 'VD', 'FA', 'RG'];

/**
 * Interpreta o conteúdo do código QR das faturas portuguesas
 * (Portaria n.º 195/2020, Especificações Técnicas v1.1 da AT).
 * Formato: "A:123456789*B:999999990*C:PT*...". Valores com ponto decimal, em euros.
 * Devolve null se o texto não for um QR da AT.
 */
export function parseFiscalQr(text) {
  if (!text || typeof text !== 'string') return null;
  const parts = text.trim().split('*');
  const map = {};
  for (const p of parts) {
    const i = p.indexOf(':');
    if (i <= 0) continue;
    map[p.slice(0, i).trim().toUpperCase()] = p.slice(i + 1).trim();
  }
  if (!map.A || !map.F || !map.G || !('O' in map)) return null;
  if (!/^\d{8}$/.test(map.F)) return null;

  const num = v => (v === undefined || v === '' || !/^-?\d+(\.\d+)?$/.test(v)) ? null : Number(v);
  const date = `${map.F.slice(0, 4)}-${map.F.slice(4, 6)}-${map.F.slice(6, 8)}`;

  const vat = [];
  const warnings = [];
  for (const L of ['I', 'J', 'K']) {
    const region = map[L + '1'];
    if (!region || region === '0') continue;
    const rates = VAT_RATES[region.toUpperCase()];
    const exempt = num(map[L + '2']);
    if (exempt !== null) vat.push({ rate: 0, base: exempt, vat: 0, region });
    const pairs = [['3', '4', 'reduced'], ['5', '6', 'intermediate'], ['7', '8', 'normal']];
    for (const [b, v, kind] of pairs) {
      const base = num(map[L + b]);
      const tax = num(map[L + v]);
      if (base === null && tax === null) continue;
      if (!rates) { warnings.push(`Espaço fiscal desconhecido: ${region}`); vat.push({ rate: null, base, vat: tax, region }); continue; }
      vat.push({ rate: rates[kind], base, vat: tax, region });
    }
  }
  const notSubject = num(map.L);
  if (notSubject !== null) vat.push({ rate: 0, base: notSubject, vat: 0, region: 'NS' });

  const docId = map.G;
  return {
    supplierTaxId: map.A,
    customerTaxId: map.B && map.B !== GENERIC_CONSUMER_TAX_ID ? map.B : '',
    customerIsGenericConsumer: map.B === GENERIC_CONSUMER_TAX_ID,
    customerCountry: map.C || '',
    docType: map.D || '',
    status: map.E || '',
    issueDate: date,
    invoiceNumber: docId,
    atcud: map.H || '',
    vat,
    stampDuty: num(map.M),
    totalTaxes: num(map.N),
    total: num(map.O),
    withholding: num(map.P),
    currency: 'EUR', // a especificação obriga a valores em euros
    warnings,
  };
}

export default {
  id: 'pt',
  name: 'Portugal',
  locale: 'pt-PT',
  VAT_RATES, KNOWN_RATES, validateTaxId, normalizeTaxId, GENERIC_CONSUMER_TAX_ID,
  DATE_ORDER, KEYWORDS, DOC_TYPE_CODES, parseFiscalQr,
};
