// Servidor estático mínimo para testar no PC ou na rede local.
// Uso: node scripts/serve.mjs [porta]   (por omissão 8080)
// Nota: no iPhone, câmara/importação funcionam por http na rede local, mas o modo
// offline (service worker) exige HTTPS (ou localhost). Ver README.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || process.env.PORT || 8080);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
  '.gz': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8',
};
const BLOCK = /^\/(node_modules|tests|scripts|\.git)(\/|$)/;

export function start(p = port) {
  const server = createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (BLOCK.test(path)) { res.writeHead(404).end(); return; }
      if (path.endsWith('/')) path += 'index.html';
      const file = normalize(join(root, path));
      if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
      const s = await stat(file);
      if (!s.isFile()) throw new Error('not file');
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(await readFile(file));
    } catch { res.writeHead(404).end('Não encontrado'); }
  });
  return new Promise(r => server.listen(p, () => r(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await start();
  const ips = Object.values(networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`Faturas a servir em http://localhost:${port}`);
  for (const ip of ips) console.log(`  rede local: http://${ip}:${port}`);
}
