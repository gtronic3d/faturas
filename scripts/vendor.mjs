// Copia os motores de OCR (Tesseract.js + modelo de português) e de QR (jsQR)
// para ./vendor, para a app funcionar 100% no dispositivo e sem Internet.
// Uso:  npm install  &&  npm run vendor
import { mkdirSync, copyFileSync, existsSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = p => join(root, 'node_modules', p);
const out = p => join(root, 'vendor', p);

function copy(src, dst) {
  if (!existsSync(src)) throw new Error(`Em falta: ${src} (correu "npm install"?)`);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  console.log(`  ${dst.replace(root + '/', '')}  (${(statSync(dst).size / 1048576).toFixed(1)} MB)`);
}

console.log('A copiar motores para ./vendor ...');
copy(nm('tesseract.js/dist/tesseract.min.js'), out('tesseract/tesseract.min.js'));
copy(nm('tesseract.js/dist/worker.min.js'), out('tesseract/worker.min.js'));
for (const f of ['tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js']) copy(nm(`tesseract.js-core/${f}`), out(`tesseract-core/${f}`));
copy(nm('jsqr/dist/jsQR.js'), out('jsqr/jsQR.js'));

// Modelo de português (LSTM "best_int": bom equilíbrio precisão/tamanho)
const langDst = out('lang/por.traineddata.gz');
const local = nm('@tesseract.js-data/por/4.0.0_best_int/por.traineddata.gz');
if (existsSync(local)) copy(local, langDst);
else {
  const urls = [
    'https://cdn.jsdelivr.net/npm/@tesseract.js-data/por/4.0.0_best_int/por.traineddata.gz',
    'https://github.com/tesseract-ocr/tessdata_best/raw/main/por.traineddata',
  ];
  let ok = false;
  for (const u of urls) {
    try {
      console.log(`  a descarregar ${u}`);
      const r = await fetch(u);
      if (!r.ok) throw new Error(r.status);
      let buf = Buffer.from(await r.arrayBuffer());
      if (!u.endsWith('.gz')) buf = gzipSync(buf);
      mkdirSync(dirname(langDst), { recursive: true });
      writeFileSync(langDst, buf);
      ok = true; break;
    } catch (e) { console.warn(`  falhou: ${e.message}`); }
  }
  if (!ok) throw new Error('Não foi possível obter o modelo de português (por.traineddata).');
}

const ver = JSON.parse(readFileSync(nm('tesseract.js/package.json'))).version;
writeFileSync(out('VERSIONS.txt'), `tesseract.js ${ver}\ntesseract.js-core ${JSON.parse(readFileSync(nm('tesseract.js-core/package.json'))).version}\njsqr ${JSON.parse(readFileSync(nm('jsqr/package.json'))).version}\n`);
console.log('Concluído. Licenças: tesseract.js/tesseract (Apache-2.0), jsQR (Apache-2.0).');
