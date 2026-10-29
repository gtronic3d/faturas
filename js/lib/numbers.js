// Interpretação e formatação de valores monetários.

export const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Converte um texto monetário em número.
 * Suporta "1.234,56", "1 234,56", "1234,56", "1,234.56", "1234.56", "12,30 €", "-5,00".
 * Devolve { value, ambiguous } ou null se não for um número.
 * ambiguous=true quando o separador não é determinável (ex.: "1.234" ou "1,234").
 */
export function parseAmount(input) {
  if (input === null || input === undefined) return null;
  let s = String(input).trim();
  if (!s) return null;
  s = s.replace(/(eur|€|usd|\$|gbp|£)/gi, '').replace(/ /g, ' ').trim();
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (/^-/.test(s) || /-$/.test(s)) { negative = true; s = s.replace(/-/g, ''); }
  s = s.replace(/\s+/g, ' ').trim();
  // espaços como separador de milhares: "1 234,56"
  if (/^\d{1,3}( \d{3})+([.,]\d+)?$/.test(s)) s = s.replace(/ /g, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let ambiguous = false;
  let normalized;
  if (lastDot >= 0 && lastComma >= 0) {
    const decSep = lastDot > lastComma ? '.' : ',';
    const thouSep = decSep === '.' ? ',' : '.';
    normalized = s.split(thouSep).join('').replace(decSep, '.');
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const count = s.split(sep).length - 1;
    const decimals = s.length - s.lastIndexOf(sep) - 1;
    if (count > 1) {
      normalized = s.split(sep).join(''); // "1.234.567" -> milhares
      if (decimals !== 3) return null;
    } else if (decimals === 3) {
      // "1.234" pode ser 1234 ou 1,234: ambíguo
      ambiguous = true;
      normalized = s.replace(sep, '.');
    } else {
      normalized = s.replace(sep, '.');
    }
  } else {
    normalized = s;
  }
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return { value: negative ? -value : value, ambiguous };
}

/** Encontra todos os valores monetários num texto (exclui percentagens). */
export function findAmounts(text) {
  const out = [];
  // Só "." ou "," como separador de milhares: espaços simples separam colunas no OCR.
  const re = /-?\d{1,3}(?:[.,]\d{3})+[.,]\d{2}(?!\d)|-?\d+[.,]\d{2}(?!\d)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    // ignora se faz parte de uma data (dd.mm.aa) ou de uma percentagem
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 2);
    if (/^\s?%/.test(after)) continue;
    if (/^[.,/\-]\d/.test(after)) continue; // parte de uma data ou código
    const before = text.slice(Math.max(0, m.index - 1), m.index);
    if (/[\d/]/.test(before)) continue;
    const parsed = parseAmount(m[0]);
    if (parsed) out.push({ ...parsed, raw: m[0], index: m.index });
  }
  return out;
}

/** Converte texto introduzido pelo utilizador (aceita vírgula) em número ou null. */
export function parseUserNumber(s) {
  if (s === null || s === undefined || String(s).trim() === '') return null;
  const p = parseAmount(String(s));
  return p ? p.value : NaN;
}

export function formatMoney(n, currency = '', locale = 'pt-PT') {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  const s = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  return currency ? `${s} ${currency === 'EUR' ? '€' : currency}` : s;
}

export function formatNumberInput(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return n.toFixed(2).replace('.', ',');
}
