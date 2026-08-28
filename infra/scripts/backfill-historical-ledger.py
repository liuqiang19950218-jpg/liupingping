#!/usr/bin/env python3
"""Phase 2G.1 - Historical Base V1 backfill into PostgreSQL (recon schema).

Reads the legacy runtime-authoritative verification files:
    public/ledger_keys.json
    public/ledger_invoice_lookup.json
and loads the canonical verification surface into:
    recon.ledger_datasets              (one HISTORICAL_BASE dataset, version 1, active)
    recon.ledger_verification_entries  (bulk COPY)

Canonical surface (must match the OLD runtime verification exactly):
  old validLedgerEntry(entry) matches when EITHER:
    A) lookup[invoice] exists AND entry.date (YYYY-MM-DD) in lookup dates
       AND |lookup.amount - num(entry.amount)| < 0.01
    B) ledger_keys contains  "invoice|YYYYMMDD|amount.toFixed(2)"
  => the authoritative set is the UNION of path A (lookup dates already in
     YYYY-MM-DD) and path B (keyset).  Dedupe by canonical key
     "invoice|YYYYMMDD|amount2dp".

Money is normalized to NUMERIC(18,2) (100 / 100.0 / 100.00 all equal). Invoice
numbers stay TEXT (leading zeros preserved, 18/20-digit numbers never lose
precision). Dates become DATE (canonical YYYYMMDD parsed safely).

Design constraints honored:
  - no fabricated account_set_id / customer_id (the legacy files carry no such
    dimension and the old business rule never matched on them)
  - RUNTIME_VERIFICATION_SOURCE_AVAILABLE = YES, RAW_SOURCE_XLSX_AVAILABLE = NO
    (the original per-账套 xlsx are not on this server; this dataset is the
    runtime-authoritative surface, not a full accounting ledger)
  - bulk COPY, no per-row transactions, no N+1
  - target DB must be an isolated test DB; formal is never touched
"""
import argparse
import json
import re
import subprocess
import sys
import tempfile
import time
from datetime import date

REPO = "/home/liupp/ledger-2g1"
KEYS_PATH = f"{REPO}/public/ledger_keys.json"
LOOKUP_PATH = f"{REPO}/public/ledger_invoice_lookup.json"

DATASET_TYPE = "HISTORICAL_BASE"
VERSION = 1


def norm_date_to8(value):
    m = re.match(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$", value)
    if m:
        return f"{m.group(1)}{int(m.group(2)):02d}{int(m.group(3)):02d}"
    if re.match(r"^\d{8}$", value):
        return value
    return None


def canonical_date_to_iso(d8):
    return f"{d8[:4]}-{d8[4:6]}-{d8[6:8]}"


def psql(db, sql_or_stdin, stdin_data=None, on_error_stop=True):
    """Run psql against the target DB inside the postgres container.

    sql_or_stdin: SQL text; when stdin_data is provided the SQL is prepended to
    the piped stdin (COPY ... FROM STDIN pattern) in a single psql invocation.
    """
    cmd = [
        "docker", "exec", "-i", "quarterly-postgres",
        "psql", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1",
        "-At", "-q",
    ]
    if not on_error_stop:
        cmd = ["docker", "exec", "-i", "quarterly-postgres", "psql", "-U", "postgres", "-d", db]
    feed = sql_or_stdin
    if stdin_data is not None:
        feed = sql_or_stdin + "\n" + stdin_data
    proc = subprocess.run(cmd, input=feed, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"psql failed (rc={proc.returncode}): {proc.stderr[-2000:]}")
    return proc.stdout


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="quarterly_recon_ledger_runtime_test_20260828")
    ap.add_argument("--commit-dataset", action="store_true",
                    help="insert dataset row + entries (default: --dry-run)")
    ap.add_argument("--dry-run", action="store_true", default=True)
    args = ap.parse_args()
    db = args.db
    do_write = args.commit_dataset

    print(f"[1/5] reading legacy files from {REPO}")
    with open(KEYS_PATH) as f:
        keys = json.load(f)
    with open(LOOKUP_PATH) as f:
        lookup = json.load(f)
    print(f"  ledger_keys.json: {len(keys)} keys")
    print(f"  ledger_invoice_lookup.json: {len(lookup)} invoices")

    # canonical union
    print("[2/5] building canonical union (path A lookup + path B keyset)")
    canonical = {}
    malformed = 0
    for k in keys:
        p = k.split("|")
        if len(p) != 3:
            malformed += 1
            continue
        inv_raw, d8, amt2 = p[0], p[1], p[2]
        d8n = norm_date_to8(d8)
        if d8n is None or not re.match(r"^\d{8}$", d8n) or not re.match(r"^-?\d+(\.\d{2})$", amt2):
            malformed += 1
            continue
        ck = f"{inv_raw.strip()}|{d8n}|{amt2}"
        canonical[ck] = (inv_raw.strip(), d8n, amt2)
    # path A: lookup dates already YYYY-MM-DD (old runtime compared entry.date
    # which is YYYY-MM-DD from the date input)
    for inv, v in lookup.items():
        amt2 = f"{float(v['amount']):.2f}"
        for d in v.get("dates", []):
            if not re.match(r"^\d{4}-\d{2}-\d{2}$", d):
                continue
            d8n = norm_date_to8(d)
            ck = f"{inv.strip()}|{d8n}|{amt2}"
            canonical[ck] = (inv.strip(), d8n, amt2)

    rows = list(canonical.values())
    print(f"  canonical union: {len(rows)} rows (malformed skipped: {malformed})")

    # sanity: all dates valid calendar dates
    invalid_dates = 0
    for inv, d8, amt2 in rows:
        try:
            date(int(d8[:4]), int(d8[4:6]), int(d8[6:8]))
        except ValueError:
            invalid_dates += 1
    if invalid_dates:
        raise SystemExit(f"FATAL: {invalid_dates} rows have invalid calendar dates")
    print("  all dates are valid calendar dates")

    # deterministic source checksum over the CANONICAL set (not the raw JSON, so
    # a rebuild is byte-stable even if the raw JSON has unrelated extra fields)
    canonical_json = json.dumps(sorted(canonical.keys()), ensure_ascii=False, separators=(",", ":")).encode()
    import hashlib
    source_sha256 = hashlib.sha256(canonical_json).hexdigest()
    print(f"  canonical source_sha256: {source_sha256}")

    if not do_write:
        print("[dry-run] no DB write performed.")
        print(f"  RESULT source_rows={len(rows)} invalid={invalid_dates} malformed={malformed}")
        return

    # [3/5] dataset row (idempotent re-run: replace same-sha historical base;
    # refuse to overwrite a different active historical base)
    print(f"[3/5] inserting dataset (type={DATASET_TYPE} version={VERSION}) into {db}")
    existing = psql(db, f"""
      SELECT id, source_sha256, is_active FROM recon.ledger_datasets
      WHERE dataset_type='{DATASET_TYPE}'
    """).strip()
    if existing:
        for line in existing.splitlines():
            did, dsha, active = line.split("|")
            if dsha == source_sha256:
                psql(db, f"DELETE FROM recon.ledger_datasets WHERE id='{did}'")
                print(f"  removed same-sha previous dataset {did} (idempotent re-run)")
            elif active == "t":
                raise SystemExit(
                    f"FATAL: active HISTORICAL_BASE {did} has a different sha; "
                    "refusing to overwrite. Remove/version it explicitly first."
                )
    dataset_sql = f"""
    INSERT INTO recon.ledger_datasets
      (dataset_type, year, quarter_id, version, is_active,
       source_file_name, source_sha256, source_payload, row_count, imported_at)
    VALUES
      ('{DATASET_TYPE}', 0, NULL, {VERSION}, true,
       'ledger_keys.json + ledger_invoice_lookup.json',
       '{source_sha256}',
       '{{"sources": ["public/ledger_keys.json", "public/ledger_invoice_lookup.json"], "raw_source_xlsx_available": false, "runtime_verification_source_available": true, "canonical_surface": "union(pathA lookup YYYY-MM-DD, pathB keyset)", "legacy_sha256_keys": "c976856e8aeb75df594e5ac3b04232012da2f50fce03c9d6e7ca34267c70d688", "legacy_sha256_lookup": "02684e895398c0c57a04b051285d9c584212097a8b981340f187e894028e638d"}}'::jsonb,
       {len(rows)}, now())
    RETURNING id;"""
    dataset_id = psql(db, dataset_sql).strip()
    if not dataset_id:
        raise RuntimeError("failed to retrieve dataset id")
    print(f"  dataset id: {dataset_id}")

    # [4/5] bulk COPY
    print(f"[4/5] COPY {len(rows)} entries (bulk, no per-row transactions)")
    copy_sql = (
        "COPY recon.ledger_verification_entries "
        "(dataset_id, source_row_key, invoice_no_raw, invoice_no_normalized, "
        " invoice_date_raw, invoice_date, invoice_amount) FROM STDIN WITH (FORMAT csv, DELIMITER E'\\t', NULL '');"
    )
    t0 = time.time()
    buf = []
    written = [0]
    def flush():
        if not buf:
            return
        data = "\n".join(buf) + "\n"
        psql(db, copy_sql, stdin_data=data)
        written[0] += len(buf)
        buf.clear()
    for inv, d8, amt2 in rows:
        iso = canonical_date_to_iso(d8)
        ck = f"{inv}|{d8}|{amt2}"
        buf.append(f"{dataset_id}\t{ck}\t{inv}\t{inv}\t{d8}\t{iso}\t{amt2}")
        if len(buf) >= 20000:
            flush()
    flush()
    elapsed = time.time() - t0
    print(f"  inserted {written[0]} rows in {elapsed:.1f}s")

    # [5/5] independent verification (never trust the importer self-report)
    print("[5/5] independent SQL verification")
    ver = psql(db, f"""
      SELECT
        (SELECT count(*) FROM recon.ledger_verification_entries WHERE dataset_id='{dataset_id}') AS entries,
        (SELECT count(DISTINCT source_row_key) FROM recon.ledger_verification_entries WHERE dataset_id='{dataset_id}') AS distinct_keys,
        (SELECT count(DISTINCT invoice_no_normalized) FROM recon.ledger_verification_entries WHERE dataset_id='{dataset_id}') AS distinct_invoices,
        (SELECT min(invoice_date)::text FROM recon.ledger_verification_entries WHERE dataset_id='{dataset_id}') AS min_date,
        (SELECT max(invoice_date)::text FROM recon.ledger_verification_entries WHERE dataset_id='{dataset_id}') AS max_date,
        (SELECT min(invoice_amount)::text FROM recon.ledger_verification_entries WHERE dataset_id='{dataset_id}') AS min_amount,
        (SELECT max(invoice_amount)::text FROM recon.ledger_verification_entries WHERE dataset_id='{dataset_id}') AS max_amount
    """).strip()
    print("  verification:", ver)
    entries, distinct_keys, distinct_invoices = ver.split("|")[0], ver.split("|")[1], ver.split("|")[2]
    if int(entries) != len(rows) or int(distinct_keys) != len(rows):
        raise SystemExit(f"FATAL: entries={entries} distinct_keys={distinct_keys} != source {len(rows)}")
    print("  BACKFILL_VALIDATED entries==source_rows, all canonical keys distinct")
    print(f"  RESULT dataset_id={dataset_id} rows={entries} distinct_invoices={distinct_invoices} "
          f"min_date={ver.split('|')[3]} max_date={ver.split('|')[4]} elapsed={elapsed:.1f}s")


if __name__ == "__main__":
    main()
