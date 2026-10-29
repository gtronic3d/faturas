// Corre o Tesseract (CLI) e devolve linhas {text, conf} no mesmo formato que o
// motor Tesseract.js da app. Usado para testar o extrator com OCR real.
import { execFileSync } from 'node:child_process';

export function haveTesseract() {
  try { execFileSync('tesseract', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

export function ocrLines(path) {
  const langs = execFileSync('tesseract', ['--list-langs']).toString();
  const lang = /\bpor\b/.test(langs) ? 'por' : 'eng';
  const tsv = execFileSync('tesseract', [path, 'stdout', '--psm', '4', '-l', lang, 'tsv'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  const groups = new Map();
  for (const row of tsv.split('\n').slice(1)) {
    const c = row.split('\t');
    if (c.length < 12 || c[0] !== '5') continue;
    const text = c[11];
    const conf = Number(c[10]);
    if (!text.trim() || conf < 0) continue;
    const key = `${c[2]}-${c[3]}-${c[4]}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ text, conf });
  }
  return [...groups.values()].map(ws => ({ text: ws.map(w => w.text).join(' '), conf: ws.reduce((a, w) => a + w.conf, 0) / ws.length }));
}
