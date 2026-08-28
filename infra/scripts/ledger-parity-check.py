#!/usr/bin/env python3
"""Phase 2G.1 - Ledger verification parity: legacy JSON rules vs PostgreSQL.

Samples:
  - 100 real matched invoices (drawn from the union surface)
  - 20 deliberately not_found probes
  - 5+ A-only, 5+ B-only, 5+ intersection from the source union

For each sample the legacy rule (validLedgerEntry / findLedgerMatch union) is
evaluated on the raw JSON, and the PostgreSQL server rule (the same canonical
key lookup) is evaluated by querying the target DB directly with the exact SQL
the server uses. Parity requires both to agree 100%.
"""
import argparse
import json
import random
import re
import subprocess
import sys

REPO = "/home/liupp/ledger-2g1"
KEYS_PATH = f"{REPO}/public/ledger_keys.json"
LOOKUP_PATH = f"{REPO}/public/ledger_invoice_lookup.json"


def norm_date_to8(value):
    m = re.match(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$", value)
    if m:
        return f"{m.group(1)}{int(m.group(2)):02d}{int(m.group(3)):02d}"
    if re.match(r"^\d{8}$", value):
        return value
    return None


def to_cents(value):
    try:
        return f"{float(str(value).replace(',', '')):.2f}"
    except Exception:
        return "0.00"


def legacy_valid(invoice, date8, amount, keys, lookup):
    """Replicates QuarterlyReconciliation.tsx validLedgerEntry (union of paths A+B)."""
    inv = str(invoice).strip()
    d8 = norm_date_to8(str(date8)) or ""
    amt = to_cents(amount)
    # Path A: lookup has invoice AND date present in YYYY-MM-DD AND |amount - lookup|<0.01
    lu = lookup.get(inv)
    iso = None
    if len(d8) == 8:
        iso = f"{d8[:4]}-{d8[4:6]}-{d8[6:8]}"
    if lu and iso and iso in lu.get("dates", []):
        if abs(float(lu["amount"]) - float(amount or 0)) < 0.01:
            return True
    # Path B: keyset has invoice|YYYYMMDD|amount2dp
    if len(d8) == 8:
        key = f"{inv}|{d8}|{amt}"
        if key in keys:
            return True
    return False


def pg_verify(db, invoice, date8, amount):
    """Runs the exact server verification query (same SQL as ledger.ts)."""
    iso = f"{date8[:4]}-{date8[4:6]}-{date8[6:8]}" if len(date8) == 8 else None
    amt = to_cents(amount)
    if not iso:
        return False, "no-date"
    sql = (
        "SELECT 1 FROM recon.ledger_verification_entries e "
        "JOIN recon.ledger_datasets d ON d.id = e.dataset_id "
        "WHERE e.invoice_no_normalized = $1 AND e.invoice_date = $2 "
        "AND e.invoice_amount = $3 AND d.is_active = true "
        "AND (d.dataset_type='HISTORICAL_BASE' OR (d.dataset_type='CURRENT_YEAR_QUARTER')) "
        "LIMIT 1"
    )
    # cannot bind params via -c; inline with quoting (test DB only, controlled input)
    inv = invoice.replace("'", "''")
    sql = sql.replace("$1", f"'{inv}'").replace("$2", f"'{iso}'").replace("$3", f"'{amt}'")
    out = subprocess.run(
        ["docker", "exec", "quarterly-postgres", "psql", "-U", "postgres", "-d", db, "-At", "-c", sql],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        raise RuntimeError(f"pg_verify failed: {out.stderr[-500:]}")
    return out.stdout.strip() == "1", out.stdout.strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="quarterly_recon_ledger_runtime_test_20260828")
    ap.add_argument("--seed", type=int, default=20260828)
    ap.add_argument("--matched", type=int, default=100)
    ap.add_argument("--notfound", type=int, default=20)
    args = ap.parse_args()
    db = args.db
    rng = random.Random(args.seed)

    print(f"[load] {KEYS_PATH} + {LOOKUP_PATH}")
    with open(KEYS_PATH) as f:
        keys = json.load(f)
    with open(LOOKUP_PATH) as f:
        lookup = json.load(f)
    keyset = set(keys)

    # Build the canonical union + partition for A-only / B-only / intersection.
    union = {}
    for k in keys:
        p = k.split("|")
        if len(p) == 3:
            union[k] = ("B", p[0], p[1], p[2])
    for inv, v in lookup.items():
        amt2 = f"{float(v['amount']):.2f}"
        for d in v.get("dates", []):
            if not re.match(r"^\d{4}-\d{2}-\d{2}$", d):
                continue
            d8 = norm_date_to8(d)
            ck = f"{inv.strip()}|{d8}|{amt2}"
            if ck in union:
                union[ck] = ("I", inv.strip(), d8, amt2)  # intersection
            else:
                union[ck] = ("A", inv.strip(), d8, amt2)  # A-only (lookup only)
    print(f"union={len(union)}")

    a_only = [v for v in union.values() if v[0] == "A"]
    b_only = [v for v in union.values() if v[0] == "B"]
    inter = [v for v in union.values() if v[0] == "I"]
    print(f"A-only={len(a_only)} B-only={len(b_only)} intersection={len(inter)}")

    # Deterministic sampling
    matched_pool = list(union.values())
    rng.shuffle(matched_pool)
    matched_sample = matched_pool[: args.matched]
    a_sample = rng.sample(a_only, 5)
    b_sample = rng.sample(b_only, 5)
    i_sample = rng.sample(inter, 5)

    all_checks = []

    def check(inv, d8, amt, kind, expect_match):
        legacy = legacy_valid(inv, d8, amt, keyset, lookup)
        pg, raw = pg_verify(db, inv, d8, amt)
        ok = (legacy == expect_match) and (pg == expect_match)
        all_checks.append(ok)
        if not ok:
            print(f"  MISMATCH kind={kind} inv={inv!r} d8={d8} amt={amt} legacy={legacy} pg={pg} expect={expect_match}")
        return ok

    print(f"[parity] {len(matched_sample)} matched samples")
    for (kind, inv, d8, amt) in matched_sample:
        check(inv, d8, amt, kind, True)

    print("[parity] A-only sample (5)")
    for (kind, inv, d8, amt) in a_sample:
        check(inv, d8, amt, "A-only", True)
    print("[parity] B-only sample (5)")
    for (kind, inv, d8, amt) in b_sample:
        check(inv, d8, amt, "B-only", True)
    print("[parity] intersection sample (5)")
    for (kind, inv, d8, amt) in i_sample:
        check(inv, d8, amt, "intersection", True)

    # not_found: deliberately crafted probes absent from both legacy + PG
    print(f"[parity] {args.notfound} not_found probes")
    notfound = 0
    while notfound < args.notfound:
        inv = f"NF{100000 + rng.randint(0, 999999)}"
        d8 = "20240115"
        amt = to_cents(rng.randint(1, 999999) / 100)
        if inv in lookup or any(k.startswith(inv + "|") for k in keyset):
            continue
        # ensure legacy says not found (no key, not in lookup)
        if legacy_valid(inv, d8, amt, keyset, lookup):
            continue
        check(inv, d8, amt, "not_found", False)
        notfound += 1

    ok_count = sum(all_checks)
    total = len(all_checks)
    print(f"\nRESULT checks={total} ok={ok_count} failed={total - ok_count}")
    if ok_count != total:
        print("LEDGER_VERIFICATION_PARITY = FAIL")
        sys.exit(1)
    print("LEDGER_VERIFICATION_PARITY = PASS")


if __name__ == "__main__":
    main()
