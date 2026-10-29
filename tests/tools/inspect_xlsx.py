"""Lê um .xlsx com openpyxl e devolve, em JSON, valores, tipos e formatos de cada célula.
Uso: python3 inspect_xlsx.py ficheiro.xlsx
"""
import json
import sys
import datetime as dt

import openpyxl

wb = openpyxl.load_workbook(sys.argv[1])
out = {}
for ws in wb.worksheets:
    rows = []
    for row in ws.iter_rows():
        cells = []
        for c in row:
            v = c.value
            if isinstance(v, (dt.datetime, dt.date)):
                kind, v = "date", v.strftime("%Y-%m-%d")
            elif isinstance(v, bool):
                kind = "bool"
            elif isinstance(v, (int, float)):
                kind = "number"
            elif v is None:
                kind = "empty"
            else:
                kind = "text"
            cells.append({"v": v, "t": kind, "fmt": c.number_format})
        rows.append(cells)
    out[ws.title] = rows
print(json.dumps(out, ensure_ascii=False))
