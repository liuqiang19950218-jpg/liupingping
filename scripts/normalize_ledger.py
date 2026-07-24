import os, re, json, glob, sys, openpyxl

BASE = r"E:\交接资料\工作交接-历年往来-8.30\更新至25.12月往来数据"
OUT = r"work\ledger_index.json"
KEYS = {
  "customer": ["客户名称", "往来单位名称"],
  "date": ["业务日期", "财务日期", "交易日期", "日期"],
  "invoice": ["发票号码", "发票号", "单据编号", "单据编码", "摘要"],
  "amount": ["本期应收", "应收金额", "借方", "开票金额"],
}
INVOICE_RE = re.compile(r"(?<!\d)(?:\d{8}|\d{20})(?!\d)")

def norm(v): return str(v).strip() if v is not None else ""
def number(v):
  try: return float(str(v).replace(',', ''))
  except: return 0.0
def pick(row, mapping, field):
  for h in KEYS[field]:
    if h in mapping: return row[mapping[h]]
  return None

items=[]
paths=[sys.argv[1]] if len(sys.argv)>1 else glob.glob(os.path.join(BASE, '*往来明细.xlsx'))
for path in paths:
  if os.path.basename(path).startswith('~$'): continue
  account=os.path.basename(path).replace('-往来明细.xlsx','')
  wb=openpyxl.load_workbook(path,read_only=True,data_only=True)
  for ws in wb.worksheets:
    rows=ws.iter_rows(values_only=True)
    first=[]
    for _ in range(2):
      try: first.append(next(rows))
      except StopIteration: break
    header_row=first[1] if len(first)>1 and any(norm(x) in sum(KEYS.values(),[]) for x in first[1]) else (first[0] if first else [])
    mapping={norm(v):i for i,v in enumerate(header_row) if norm(v)}
    if not any(k in mapping for k in KEYS['customer']): continue
    for row in rows:
      customer=norm(pick(row,mapping,'customer'))
      amount=number(pick(row,mapping,'amount'))
      if not customer or not amount: continue
      source=' '.join(norm(row[i]) for h,i in mapping.items() if h in KEYS['invoice'])
      invoice=norm(pick(row,mapping,'invoice'))
      m=INVOICE_RE.search(source)
      if m: invoice=m.group(0)
      if not invoice or invoice in ('收货款','上月结余','期初余额','当前累计'): continue
      items.append({'accountSet':account,'sheet':ws.title,'customer':customer,'date':norm(pick(row,mapping,'date')),'invoice':invoice.replace(' ',''),'amount':round(amount,2)})
out = OUT if len(paths)>1 else os.path.join('work','ledger_'+os.path.basename(paths[0]).replace('.xlsx','.json'))
with open(out,'w',encoding='utf-8') as f: json.dump(items,f,ensure_ascii=False)
print(json.dumps({'records':len(items),'output':out},ensure_ascii=False))
