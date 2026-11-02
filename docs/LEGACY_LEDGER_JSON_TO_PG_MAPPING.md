# Legacy Ledger JSON → PostgreSQL Mapping

说明两个旧核验 JSON 与 PostgreSQL ledger 运行时数据模型的映射、去重规则与插入条数。

## 两个源文件

| 文件 | 结构 | 角色 |
|------|------|------|
| public/ledger_keys.json | `string[]`，每项 `"invoice|YYYYMMDD|amount2dp"` | Path B：canonical key 集合 |
| public/ledger_invoice_lookup.json | `{ invoice: { amount: float, dates: string[] } }` | Path A：invoice → 可能 dates + amount 查找 |

## 两条旧核验路径（validLedgerEntry / findLedgerMatch）

- **Path A（lookup）**：`lookup[invoice.trim()]` 存在 且 `dates.includes(entry.date)`（entry.date 为 YYYY-MM-DD）且 `|lookup.amount - num(entry.amount)| < 0.01`。
- **Path B（keyset）**：`keys.has("invoice.trim()|YYYYMMDD|amount.toFixed(2)")`。

`validLedgerEntry` 返回真 = Path A 或 Path B 任一命中 → **权威核验面 = A ∪ B 的 UNION**。

## 为什么不能只导一个文件

- ledger_keys.json（B）含 347,012 条 canonical key，其中 38,255 条是 lookup 未覆盖的（B-only，多为 keyset 独有/负金额/多行同票）。
- lookup（A）含 325,756 条 date 记录，其中 8,903 条不在 keyset（A-only，如 `'退货款`、0 金额等）。
- 只导任一个都会导致旧系统能命中的发票在新系统不命中 → 破坏 parity。
- 因此取 UNION，dedupe by canonical key `invoice|YYYYMMDD|amount2dp`。

## 分区与最终插入数

| 分区 | 数量 |
|------|------|
| ledger_keys (B) | 347,012 |
| lookup date 记录 (A) | 325,756 |
| A ∩ B | 308,757 |
| A-only（仅 lookup） | 8,903 |
| B-only（仅 keyset） | 38,255 |
| **UNION canonical** | **355,915** |

（注：lookup 中 8,096 条 YYYY/MM/DD 格式日期在旧 Path A 中不会被 YYYY-MM-DD 的 entry.date 命中，只有与 keyset 对应的部分参与；上面 A 集合按旧行为只取 YYYY-MM-DD。）

## 规范化（服务器，与旧行为一致）

| 字段 | 规则 |
|------|------|
| invoice_no | trim；text 存储；前导 0 保留；18/20 位不转 number（无精度损失） |
| invoice_date | YYYY-MM-DD / YYYY/MM/DD / 8位数字 → DATE（canonical YYYYMMDD 安全解析） |
| invoice_amount | numeric(18,2)；100 / 100.0 / 100.00 等值；无 float 误差 |

## 为什么不伪造 accountSet / customer

- 旧 JSON 无账套/客户维度；旧业务核验本就不匹配客户、不强制匹配账套。
- recon.ledger_invoices 要求 account_set_id/customer_id 且 UNIQUE(account_set_id, invoice_no) —— 强行塞入会伪造维度、数据污染。
- 2G.1 采用独立数据集模型（ledger_datasets + ledger_verification_entries），不需要不存在的维度。旧表 ledger_invoices 保留但不用于本核验运行时。

## 插入目标（2G.1）

- `recon.ledger_datasets`：一行 HISTORICAL_BASE V1（active，source_sha256=aedb62474d9c285a7485cf62100f80facdbffd37fc47a8fe5fdd9092ea7c594d，source_file_name 记录两源文件，source_payload 记录 RAW_SOURCE_XLSX_AVAILABLE=false / RUNTIME_VERIFICATION_SOURCE_AVAILABLE=true 及 legacy SHA）。
- `recon.ledger_verification_entries`：355,915 行，source_row_key = canonical key，UNIQUE(dataset_id, source_row_key)。

## 完整性核对（backfill 后独立 SQL）

- entries = distinct source_row_key = 355,915；distinct invoice_no_normalized = 323,215；min 2008-11-06 / max 2026-06-30。
- parity 实测（见 infra/scripts/ledger-parity-check.py）：100 matched + 20 not_found + A-only/B-only/intersection 各 5 = 135/135 一致，LEDGER_VERIFICATION_PARITY = PASS。
