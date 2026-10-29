"""Gera imagens de faturas sintéticas (fictícias) para testes.

  python3 tests/tools/make_invoice.py tests/fixtures

Cria:
  fatura_multi_iva.png      - fatura legível, 3 taxas de IVA, com QR fiscal
  fatura_ilegivel.png       - mesma fatura, desfocada e com ruído (pouco legível)
  fatura_incompleta.png     - talão sem NIF, sem número e sem data
  qr_multi_iva.txt          - conteúdo do QR fiscal da fatura multi-IVA
Todos os dados são fictícios (NIFs com dígito de controlo válido, mas inventados).
"""
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 else "tests/fixtures"
os.makedirs(OUT, exist_ok=True)
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"

QR = ("A:501442600*B:123456789*C:PT*D:FT*E:N*F:20250214*G:FT 2025A/57*H:JFJ8CQYD-57*I1:PT*"
      "I3:50.00*I4:3.00*I5:20.00*I6:2.60*I7:100.00*I8:23.00*N:28.60*O:198.60*Q:ab1C*R:1234")


def qr_image(data, size):
    try:
        import cv2
        q = cv2.QRCodeEncoder.create().encode(data)
        return Image.fromarray(q).resize((size, size), Image.NEAREST)
    except Exception:
        pass
    try:
        from reportlab.graphics.barcode.qr import QrCodeWidget
        from reportlab.graphics.shapes import Drawing
        from reportlab.graphics import renderPM
        w = QrCodeWidget(data)
        b = w.getBounds()
        bw, bh = b[2] - b[0], b[3] - b[1]
        d = Drawing(size, size, transform=[size / bw, 0, 0, size / bh, 0, 0])
        d.add(w)
        return renderPM.drawToPIL(d)
    except Exception as e:  # pragma: no cover
        print("QR indisponível:", e)
        return None


def invoice(lines_spec, path, qr=None, blur=0, noise=0):
    W, H = 1240, 1754  # A4 a 150 dpi
    im = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(im)
    y = 80
    for kind, text in lines_spec:
        if kind == "gap":
            y += int(text)
            continue
        font = ImageFont.truetype(BOLD if kind in ("h1", "b") else (MONO if kind == "m" else FONT),
                                  44 if kind == "h1" else 30)
        d.text((90, y), text, fill="black", font=font)
        y += 58 if kind == "h1" else 46
    if qr:
        q = qr_image(qr, 300)
        if q:
            im.paste(q.convert("RGB"), (W - 400, H - 420))
    if blur:
        im = im.filter(ImageFilter.GaussianBlur(blur))
    if noise:
        px = im.load()
        rnd = random.Random(42)
        for _ in range(noise):
            x, yy = rnd.randrange(W), rnd.randrange(H)
            g = rnd.randrange(80, 200)
            px[x, yy] = (g, g, g)
    im.save(path)


MULTI = [
    ("h1", "Papelaria Central, Lda"),
    ("t", "Rua Direita 10, 1000-100 Lisboa"),
    ("t", "NIF: 501442600"),
    ("gap", 30),
    ("b", "FATURA FT 2025A/57"),
    ("t", "Data de emissão: 14/02/2025"),
    ("t", "Vencimento: 16/03/2025"),
    ("gap", 20),
    ("t", "Cliente: Maria Silva"),
    ("t", "NIF Cliente: 123456789"),
    ("gap", 30),
    ("m", "Caderno A4        2 x  50,00  23%   100,00"),
    ("m", "Livro escolar     1 x  20,00  13%    20,00"),
    ("m", "Pão               5 x  10,00   6%    50,00"),
    ("gap", 30),
    ("b", "Resumo de IVA"),
    ("m", "Taxa 23%   Incidência 100,00   IVA 23,00"),
    ("m", "Taxa 13%   Incidência  20,00   IVA  2,60"),
    ("m", "Taxa 6%    Incidência  50,00   IVA  3,00"),
    ("gap", 20),
    ("t", "Total s/ IVA 170,00"),
    ("t", "Total IVA 28,60"),
    ("b", "Total a pagar 198,60 EUR"),
    ("gap", 20),
    ("t", "ATCUD: JFJ8CQYD-57"),
]

INCOMPLETE = [
    ("h1", "Café Sol"),
    ("t", "Obrigado pela visita"),
    ("gap", 30),
    ("m", "1 Café            0,80"),
    ("m", "1 Pastel de nata  1,60"),
    ("gap", 20),
    ("b", "Total 2,40 €"),
]

invoice(MULTI, os.path.join(OUT, "fatura_multi_iva.png"), qr=QR)
invoice(MULTI, os.path.join(OUT, "fatura_ilegivel.png"), qr=None, blur=3.2, noise=60000)
invoice(INCOMPLETE, os.path.join(OUT, "fatura_incompleta.png"))
with open(os.path.join(OUT, "qr_multi_iva.txt"), "w") as f:
    f.write(QR)
print("Imagens geradas em", OUT)
