// Motores de leitura: OCR (texto) e QR. Interface comum para permitir trocar
// de motor (on-device ou API externa) sem alterar o resto da aplicação.
//
// Motor por omissão: Tesseract.js (WASM, 100% no dispositivo).
// QR: jsQR (JS puro, no dispositivo).
// Ambos são carregados de ./vendor/ (ver scripts/vendor.mjs). Nenhum pedido sai do dispositivo.

const VENDOR = {
  tesseract: 'vendor/tesseract/tesseract.min.js',
  worker: 'vendor/tesseract/worker.min.js',
  core: 'vendor/tesseract-core/',
  lang: 'vendor/lang/',
  jsqr: 'vendor/jsqr/jsQR.js',
};

const abs = p => new URL(p, document.baseURI).href;
const scripts = {};
function loadScript(src) {
  if (!scripts[src]) {
    scripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = () => resolve(true);
      s.onerror = () => { delete scripts[src]; reject(new Error(`Não foi possível carregar ${src}`)); };
      document.head.appendChild(s);
    });
  }
  return scripts[src];
}

// ------------------------------------------------------------------ imagem
export async function loadImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function drawScaled(img, maxSide, crop = null) {
  const sx = crop ? crop.x : 0, sy = crop ? crop.y : 0;
  const sw = crop ? crop.w : img.naturalWidth || img.width;
  const sh = crop ? crop.h : img.naturalHeight || img.height;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

/** Tons de cinzento + esticamento de contraste (ajuda o OCR em fotos baças). */
export function preprocess(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const im = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = im.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0;
    d[i] = d[i + 1] = d[i + 2] = g; hist[g]++;
  }
  const total = d.length / 4;
  let lo = 0, hi = 255, acc = 0;
  while (lo < 255 && (acc += hist[lo]) < total * 0.01) lo++;
  acc = 0;
  while (hi > 0 && (acc += hist[hi]) < total * 0.01) hi--;
  if (hi - lo > 20) {
    const k = 255 / (hi - lo);
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.max(0, Math.min(255, (d[i] - lo) * k));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
  ctx.putImageData(im, 0, 0);
  return canvas;
}

/** Miniatura JPEG (data URL) para a lista. */
export function thumbnail(img, size = 160) {
  return drawScaled(img, size).toDataURL('image/jpeg', 0.7);
}

// ------------------------------------------------------------------ QR
export async function decodeQr(img) {
  const test = globalThis.__FATURAS_TEST__;
  if (test?.decodeQr) return test.decodeQr(img);
  try { await loadScript(VENDOR.jsqr); } catch { return { text: null, unavailable: true }; }
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const attempts = [
    [1200, null], [1800, null], [2600, null],
    [2000, { x: 0, y: Math.floor(H / 2), w: W, h: Math.ceil(H / 2) }],
    [2000, { x: 0, y: 0, w: W, h: Math.ceil(H / 2) }],
  ];
  for (const [max, crop] of attempts) {
    const c = drawScaled(img, max, crop);
    const data = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
    const r = globalThis.jsQR(data.data, c.width, c.height, { inversionAttempts: 'attemptBoth' });
    if (r?.data) return { text: r.data };
    await new Promise(res => setTimeout(res, 0));
  }
  return { text: null };
}

// ------------------------------------------------------------------ OCR
let tessWorker = null;

export const engines = {
  tesseract: {
    id: 'tesseract',
    label: 'Tesseract.js (no dispositivo)',
    external: false, // nada é enviado para fora do dispositivo
    async available() {
      try { await loadScript(VENDOR.tesseract); return !!globalThis.Tesseract; } catch { return false; }
    },
    /** @returns {Promise<{text:string, conf:number}[]>} */
    async recognize(img, onProgress = () => {}) {
      await loadScript(VENDOR.tesseract);
      if (!tessWorker) {
        onProgress({ status: 'A preparar o motor de OCR…', progress: 0 });
        tessWorker = await globalThis.Tesseract.createWorker('por', 1, {
          workerPath: abs(VENDOR.worker),
          corePath: abs(VENDOR.core),
          langPath: abs(VENDOR.lang),
          workerBlobURL: false,
          cacheMethod: 'none',
          gzip: true,
          logger: m => onProgress({ status: m.status, progress: m.progress }),
        });
        // PSM 4 (coluna única, linhas de tamanho variável) mantém as linhas das tabelas inteiras.
        await tessWorker.setParameters({ tessedit_pageseg_mode: '4', preserve_interword_spaces: '1', user_defined_dpi: '300' });
      }
      const canvas = preprocess(drawScaled(img, 2200));
      const { data } = await tessWorker.recognize(canvas);
      return (data.lines || []).map(l => ({ text: l.text.replace(/\n$/, ''), conf: l.confidence }));
    },
  },
};

export async function recognizeText(img, onProgress) {
  const test = globalThis.__FATURAS_TEST__;
  if (test?.recognize) return { lines: await test.recognize(img), engine: 'teste' };
  const engine = engines.tesseract;
  if (engine.external) {
    // Regra de privacidade: motores externos exigem consentimento explícito antes de enviar a imagem.
    const ok = confirm(`A imagem vai ser enviada para ${engine.label}. Continuar?`);
    if (!ok) return { lines: [], engine: engine.id, cancelled: true };
  }
  if (!(await engine.available())) return { lines: [], engine: engine.id, unavailable: true };
  return { lines: await engine.recognize(img, onProgress), engine: engine.id };
}

/** Converte texto colado (ex.: "Texto ao Vivo" do iOS) em linhas sem confiança. */
export function linesFromText(text) {
  return String(text || '').split(/\r?\n/).map(t => ({ text: t, conf: null })).filter(l => l.text.trim());
}
