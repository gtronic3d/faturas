# Faturas - MVP de extração e registo de faturas (PWA local)

## Resumo executivo

Aplicação web instalável (PWA) para iPhone e Android, em português de Portugal. Fotografa ou importa uma fatura, lê o **código QR fiscal da AT** e faz **OCR no próprio telemóvel**. Depois mostra os campos para revisão, com os duvidosos assinalados. Os registos ficam guardados localmente e exportam para um **.xlsx verdadeiro**, ou para um .zip com o .xlsx e as imagens originais.

- Sem contas, sem servidor de dados, sem cloud, sem subscrições.
- Depois de aberta uma vez, funciona sem Internet.
- Sem frameworks nem passo de build. O código é HTML, CSS e módulos JavaScript nativos.
- 33 testes automáticos: unitários, OCR real e ponta-a-ponta num browser.

## 1. Escolhas tecnológicas

### 1.1 Plataforma: PWA (escolhida) vs. app nativa

| Critério | PWA (escolhida) | Nativa (Swift/Kotlin) ou híbrida (Flutter/React Native) |
|---|---|---|
| Instalação no iPhone | "Adicionar ao ecrã principal" no Safari, sem App Store | Exige conta Apple Developer (99 €/ano), TestFlight ou App Store |
| Android | Mesmo código | Build separado ou ponte híbrida |
| Câmara e galeria | `<input type="file" capture>` (ambos suportados) | APIs nativas, mais controlo (focagem, recorte automático) |
| OCR no dispositivo | Tesseract.js (WASM) | Apple Vision / Google ML Kit, mais precisos e rápidos |
| Armazenamento local | IndexedDB (pode ser limpo pelo sistema em casos extremos) | SQLite/ficheiros, mais robusto |
| Dependência de fornecedor | Nenhuma: ficheiros estáticos em qualquer alojamento | Lojas de apps e SDKs |
| Custo e tempo do MVP | Baixo | Médio/alto |

**Justificação:** cumpre o pedido ("correr localmente no iPhone, tipo atalho"), não precisa da App Store e é agnóstica de fornecedor. Corre igual em iOS e Android. O preço é um OCR menos preciso que o Apple Vision. Esse risco é compensado pela leitura do QR fiscal, que é exato, e pela alternativa "colar texto" (Texto ao Vivo do iOS, ver 4.3).

### 1.2 Motor de extração

| Opção | Onde corre | Prós | Contras |
|---|---|---|---|
| **QR fiscal AT (jsQR)** - usado | Dispositivo | Dados exatos (NIFs, n.º, data, bases e IVA por taxa, total); obrigatório nas faturas PT desde 2022 | Não inclui nomes; só faturas portuguesas certificadas |
| **Tesseract.js (por)** - usado | Dispositivo (WASM) | Privado, offline, open source (Apache-2.0) | Mais lento (5 a 20 s); sensível a fotos tortas ou baças; cerca de 15 MB de modelo |
| Texto ao Vivo do iOS (colar) - suportado | Dispositivo (Apple) | Excelente qualidade | Passo manual (copiar e colar) |
| APIs cloud (OCR/IA de documentos ou LLM com visão) | Externo | Precisão alta, estrutura de faturas | Envio de dados pessoais e fiscais, custo, dependência, RGPD |

A camada `js/lib/ocr.js` tem uma interface comum de motores (`engines`). Um motor com `external: true` obriga a **pedir consentimento antes de enviar a imagem** (já implementado). Não está fixado nenhum fornecedor externo.

### 1.3 Geração de Excel

| Opção | Prós | Contras |
|---|---|---|
| **Gerador próprio (OOXML + ZIP), ~250 linhas** - usado | Zero dependências; controlo total de tipos (número, data com `dd/mm/yyyy`, texto `@`); auditável | Só o necessário (sem gráficos nem fórmulas) |
| SheetJS (Community) | Muito completo | Estilos e formatos limitados na versão gratuita; distribuição fora do npm |
| ExcelJS | Estilos completos | Cerca de 1 MB; pensado para Node |

O ficheiro foi validado com **openpyxl** (tipos e formatos de cada célula) e aberto com **LibreOffice** nos testes.

## 2. Estrutura

```
index.html, css/app.css, manifest.webmanifest, sw.js, icons/
js/app.js                 interface (lista, revisão, exportação, privacidade)
js/profiles/pt.js         tudo o que é específico de Portugal: NIF, taxas IVA, QR AT, palavras-chave
js/lib/extract.js         motor de extração (linhas OCR + QR -> campos com estado ok/doubt/missing)
js/lib/validate.js        coerência de totais, NIF, duplicados
js/lib/numbers.js|dates.js  formatos PT (1.234,56 / dd/mm/aaaa) e série de datas Excel
js/lib/xlsx.js|zip.js|export.js  geração de .xlsx/.zip
js/lib/db.js              IndexedDB (registos + imagens originais)
js/lib/ocr.js             motores: Tesseract.js, jsQR, pré-processamento de imagem
vendor/                   motores copiados por "npm run vendor" (não versionados no zip)
scripts/                  vendor.mjs (motores), serve.mjs (servidor local)
tests/                    unit/, ocr/, e2e/, fixtures/ (faturas fictícias), tools/
```

Para outro país: criar `js/profiles/xx.js` com a mesma interface (validação do NIF, taxas, palavras-chave, QR) e importá-lo em `app.js`.

## 3. Execução passo a passo

### 3.1 No PC (Node 18 ou superior)

```bash
npm install          # descarrega tesseract.js, modelo português e jsQR (dev)
npm run vendor       # copia os motores para ./vendor (cerca de 25 MB)
npm start            # http://localhost:8080
```

Abrir `http://localhost:8080` no Chrome ou Safari. A importação de imagem funciona logo.

### 3.2 No iPhone (modo "app", offline)

O iPhone exige **HTTPS** para o modo offline (service worker). O alojamento só serve ficheiros estáticos. **Os dados das faturas nunca lá chegam.**

1. Depois de `npm run vendor`, publicar a pasta (sem `node_modules`, `tests`, `scripts`) num alojamento estático com HTTPS à escolha: o seu servidor ou NAS, GitHub Pages, Cloudflare Pages, Netlify, etc. Para uso só em rede local com HTTPS, servem `Tailscale Serve` ou um certificado `mkcert`.
2. No iPhone, abrir o endereço no **Safari**, depois **Partilhar > Adicionar ao ecrã principal**.
3. Abrir a app pelo ícone uma vez, com rede, para ficar guardada em cache. A partir daí funciona em modo de avião.
4. Em "Info" confirma-se o estado: OCR instalado, armazenamento persistente, modo offline.

Alternativa sem HTTPS: `npm start` no PC e abrir `http://IP-do-PC:8080` no iPhone (mesma rede). Câmara, OCR e armazenamento funcionam, mas sem modo offline e com o PC ligado.

### 3.3 Utilização

1. **Fotografar fatura** (câmara) ou **Importar imagem** (galeria ou Ficheiros).
2. A app lê o QR e faz o OCR (barra de progresso).
3. Revisão: os campos a laranja são para **confirmar**, os cinzentos ficaram **vazios** porque não foram encontrados. Tudo é editável, incluindo as taxas de IVA. O quadro "Verificações" mostra discrepâncias de totais, NIF inválido e possíveis duplicados.
4. **Guardar**. Se houver campos por confirmar ou um duplicado, a app pede confirmação. Nada é eliminado automaticamente.
5. Na lista: pesquisar, filtrar por datas e fornecedor, editar ou eliminar, selecionar e **Exportar Excel** (ou **Excel + imagens .zip**). No iPhone abre a folha de partilha ("Guardar em Ficheiros", Mail, etc.).

## 4. Regras de fiabilidade (como estão implementadas)

| Regra | Implementação |
|---|---|
| Nunca inventar | Só se preenche o que está escrito. Os NIFs só são aceites junto de uma etiqueta (NIF/NIPC/Contribuinte), para os telefones não serem lidos como NIF. Valores ilegíveis ficam vazios. Os totais do QR são somas diretas dos campos do QR (origem "calc"). |
| Assinalar duvidosos | Estado `doubt` quando: confiança OCR < 65%, NIF com dígito de controlo errado, várias candidaturas (datas, números, totais), separador decimal ambíguo, nome deduzido do cabeçalho, base × taxa ≠ IVA. |
| Ausentes vazios | Estado `missing`, exportado como célula vazia. |
| Coerência | Soma das bases = total sem IVA; soma do IVA = total IVA; sem IVA + IVA = total; base × taxa = IVA (tolerância de 0,02 € por linha). |
| Duplicados | Chave: NIF (ou nome) do fornecedor + n.º + data. Aviso na revisão, na lista e no Excel ("Alertas"). |
| QR vs OCR | O QR prevalece. Se o texto diferir, fica anotado. Se o documento estiver noutra moeda, os valores do QR (sempre em euros) não são usados. |

### 4.3 Alternativa "colar texto" (iPhone)

Em Fotos, manter premido o texto da fatura e escolher Copiar. Na revisão, abrir "Colar texto da fatura" e colar. A extração não sobrepõe campos já editados nem os que vieram do QR.

## 5. Excel exportado

- Folha **Faturas**: uma linha por fatura com ID, Data de emissão (data `dd/mm/yyyy`), Fornecedor, NIF fornecedor (texto), N.º fatura (texto), Cliente, NIF cliente (texto), Moeda, Total sem IVA, Total IVA, Total (números `#,##0.00`), N.º taxas IVA, Imagem (caminho no .zip) e Alertas.
- Folha **IVA por taxa**: ID (chave comum), N.º fatura, NIF fornecedor, Taxa IVA (percentagem: 0,23 = 23%), Base tributável, Valor IVA.

## 6. Testes

| Comando | O que cobre | Requisitos |
|---|---|---|
| `npm test` | Unitários: NIF, valores, datas, QR AT, extração (casos limpo, ilegível, incompleto, telefone vs NIF, artigo vs quadro IVA, QR, USD, consumidor final), validação, duplicados, .xlsx (tipos via openpyxl) | Node; python3 + openpyxl para o teste de tipos |
| `npm run test:ocr` | Extrator sobre **OCR real** (Tesseract CLI) das imagens de teste | `tesseract` (idealmente com `por`) |
| `npm run test:e2e` | Browser real (perfil iPhone): câmara, galeria, revisão, gravação, recarregar, filtros, exportação .xlsx/.zip, edição, eliminação | `npm i -D playwright && npx playwright install chromium`, tesseract, python3 + openpyxl; LibreOffice opcional |

Variáveis do E2E: `E2E_REAL_OCR=1` (usa o Tesseract.js e o jsQR de `vendor/` em vez do OCR via CLI) e `BROWSER=webkit` (motor do Safari).

Regenerar as imagens de teste (fictícias): `python3 tests/tools/make_invoice.py tests/fixtures`.

| Critério de aceitação | Testes |
|---|---|
| 1. Fotografar e importar | e2e: `#in-camera` e `#in-gallery` |
| 2. Pouco legível | unit "Critério 2"; ocr "Critério 2"; e2e "Critério 1 + 2" |
| 3. Campos ausentes | unit "Critério 3"; ocr "Critério 3"; e2e "Critério 3"; xlsx (células vazias) |
| 4. Várias taxas no Excel | unit xlsx "Critérios 4 e 7"; e2e "Critérios 4, 5 e 7" |
| 5. Correção manual | e2e (edição do fornecedor refletida na lista e no .xlsx) |
| 6. Persistência | e2e "Critério 6" (fecha e reabre a página) |
| 7. Tipos no Excel | unit xlsx (openpyxl: date/number/text e formatos); e2e (+ LibreOffice) |

## 7. Privacidade

- Dados guardados: campos revistos, taxas de IVA, miniatura e imagem original, no IndexedDB do browser, neste dispositivo. O texto bruto do OCR não é guardado.
- A política de segurança (CSP) da página proíbe ligações a outros domínios (`connect-src 'self'`): a app não consegue enviar dados para fora.
- Remover a app do ecrã principal ou apagar os dados do site apaga os registos. Exporte regularmente.

## 8. Limitações conhecidas e riscos

- **Validação em iPhone físico e com Tesseract.js real ainda por fazer.** O ambiente onde foi desenvolvido não tinha acesso à Internet, por isso não deu para descarregar o Tesseract.js nem o jsQR. Os testes usaram o Tesseract CLI (mesmo motor, mesmo formato de linhas) e Chromium com perfil de iPhone. Primeiro passo recomendado: `npm run vendor` e depois `E2E_REAL_OCR=1 npm run test:e2e`, seguido de um teste no iPhone.
- OCR em fotografias: perspetiva, sombras e papel curvo reduzem a qualidade. Nas faturas PT, o QR cobre os campos críticos.
- Nome do fornecedor e do cliente são heurísticos e ficam normalmente "por confirmar".
- As taxas de IVA por região estão em `js/profiles/pt.js` (fonte: InvoiceXpress, atualizado a 13/02/2026). É preciso revê-las quando a lei mudar.
- **P2 (linhas de artigos) não implementado** neste MVP.
- iOS: o IndexedDB das apps no ecrã principal é persistente na prática, mas não há garantia absoluta. A exportação .zip serve de cópia de segurança.

## 9. Próximos passos sugeridos

1. Teste no iPhone com faturas reais e afinação das palavras-chave e do limiar de confiança.
2. Recorte e correção de perspetiva automáticos antes do OCR.
3. P2: linhas de artigos.
4. Motor opcional externo (com consentimento já previsto) para faturas sem QR.

## Referências consultadas

- AT - [Especificações Técnicas do Código QR (Portaria n.º 195/2020)](https://info.portaldasfinancas.gov.pt/pt/apoio_contribuinte/Novas_regras_faturacao/Documents/Especificacoes_Tecnicas_Codigo_QR.pdf)
- InvoiceXpress - [Taxas de IVA em Portugal (atualizado 13/02/2026)](https://invoicexpress.com/blog/taxas-iva-portugal/)
