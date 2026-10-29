// Service worker: guarda a app e os motores (OCR/QR) em cache para funcionar sem Internet.
// Estratégia: cache-first para ficheiros da própria app. Não faz pedidos a terceiros.
const VERSION = 'faturas-v1.0.0';
const APP = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/profiles/pt.js',
  './js/lib/extract.js', './js/lib/validate.js', './js/lib/numbers.js', './js/lib/dates.js',
  './js/lib/xlsx.js', './js/lib/zip.js', './js/lib/export.js', './js/lib/db.js', './js/lib/ocr.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];
// Motores (opcionais: só existem depois de "npm run vendor")
const VENDOR = [
  './vendor/tesseract/tesseract.min.js', './vendor/tesseract/worker.min.js',
  './vendor/tesseract-core/tesseract-core-simd-lstm.wasm.js', './vendor/tesseract-core/tesseract-core-lstm.wasm.js',
  './vendor/lang/por.traineddata.gz', './vendor/jsqr/jsQR.js',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(APP);
    await Promise.all(VENDOR.map(u => c.add(u).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const hit = await c.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    } catch (err) {
      if (e.request.mode === 'navigate') return (await c.match('./index.html')) || Response.error();
      throw err;
    }
  })());
});
