# AGENTS.md - instruções para agentes (independente do modelo)

## Projeto
PWA local "Faturas": extração de dados de faturas (QR fiscal AT + OCR no dispositivo), revisão, registo em IndexedDB e exportação .xlsx. Ver README.md.

## Regras
- Interface e documentação em português de Portugal; hífen (-), nunca travessão; formatos 1.234,56 € e dd/mm/aaaa.
- Sem dependências em runtime fora de `vendor/` (Tesseract.js, jsQR). Sem pedidos a terceiros (CSP `connect-src 'self'`).
- Nunca inventar valores: o extrator só preenche o que está no documento; ambiguidade => `doubt`; ausência => `missing`.
- Específico de país só em `js/profiles/<pais>.js`.
- Lógica pura em `js/lib/` (testável em Node, sem DOM). DOM só em `js/app.js` e `js/lib/ocr.js`/`db.js`.
- Ao adicionar ficheiros da app, atualizar a lista `APP` em `sw.js` e subir `VERSION`.

## Verificação obrigatória antes de concluir
```
npm test && npm run test:ocr && npm run test:e2e
```
