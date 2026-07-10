# -*- coding: utf-8 -*-
"""Generate anonymized test fixtures from a real Shopify orders export.

Usage (Windows):
    py scripts/generate-fixtures.py [--input CSV] [--out-dir DIR]

Reads a classic Shopify orders CSV export (75 columns, one row per line
item, first row of each order carries the full order data) and produces:

  test/fixtures/w47-orders.json   GraphQL-like anonymized orders
  test/fixtures/w47-golden.json   aggregate totals for golden tests
  test/fixtures/README.md         provenance note

Anonymization is deterministic per customer email:
  customer N -> name "Cliente {N:03d}", email "cliente{N:03d}@example.com",
  phone "9{N:08d}", street "Rua Exemplo {N}".
Kept REAL: zip, city, Note Attributes, product names, quantities, prices,
dates, tags, shipping method, financial status, order number.
Stdlib only (csv/json) — no pandas required.
"""

import argparse
import csv
import json
import re
import sys
from collections import OrderedDict
from datetime import datetime, timezone

DEFAULT_INPUT = (
    r"C:\Users\aport\OneDrive - theloop.pt\Desktop\Mental Palace\Trabalho"
    r"\Projetos\Legumes\Legumes\Otimização encomendas\Otimização encomendas"
    r"\w47 - mais completo com varios docs\w47_2025_orders_export.csv"
)
DEFAULT_OUT_DIR = r"C:\Users\aport\dev\Legumes\operacao-semanal\test\fixtures"

ZONE_ATTRIBUTE_KEY = "Horário de entrega"
DAY_ATTRIBUTE_KEY = "Dia de entrega"

# Curated per-order note replacements. Default policy for any OTHER
# non-empty note is to blank it (safe-by-default: fixtures go to GitHub).
# Dish personalizations / PII-free delivery-time preferences are kept;
# personal names, contacts, door instructions and health info are removed.
NOTE_OVERRIDES = {
    "#45174-LoV": "Sem legumes/saladas não cozinhadas.",
    "#45128-LoV": "Parceria",
    "#45116-LoV": "Parceria",
    "#45047-LoV": "Poke com molho sweat chili e sem pepino. \U0001F60A",
    "#45035-LoV": "Parceria",
    "#45029-LoV": "",
    "#45026-LoV": "",
    "#45022-LoV": "Agradecia que a entrega fosse feita antes das 11h30",
    "#45020-LoV": "",
    "#45019-LoV": "Bowl sem pepino. Recolha terça adémia",
    "#45013-LoV": "Parceria",
    "#45003-LoV": "Favor entregar depois das 19:30",
}


class Anonymizer:
    """Deterministic identity mapping. IDs are assigned in file order:
    one per distinct customer email, plus one per distinct billing name
    that does not match the shipping name of the same order."""

    def __init__(self):
        self._by_email = OrderedDict()
        self._by_name = OrderedDict()
        self._next_id = 1

    def _assign(self, mapping, key):
        if key not in mapping:
            mapping[key] = self._next_id
            self._next_id += 1
        return mapping[key]

    def id_for_email(self, email):
        return self._assign(self._by_email, email.strip().lower())

    def id_for_name(self, full_name):
        return self._assign(self._by_name, full_name.strip())

    @staticmethod
    def display_name(n):
        return f"Cliente {n:03d}"

    @staticmethod
    def email(n):
        return f"cliente{n:03d}@example.com"

    @staticmethod
    def phone(n):
        return f"9{n:08d}"

    @staticmethod
    def street(n):
        return f"Rua Exemplo {n}"


def parse_note_attributes(raw):
    """'Chave: valor' per line -> [{key, value}], values kept verbatim."""
    attributes = []
    for line in raw.split("\n"):
        line = line.strip()
        if not line or ":" not in line:
            continue
        key, value = line.split(":", 1)
        attributes.append({"key": key.strip(), "value": value.strip()})
    return attributes


def to_iso(created_at):
    """Shopify '2025-11-22 01:28:43 +0000' -> ISO 8601."""
    parsed = datetime.strptime(created_at.strip(), "%Y-%m-%d %H:%M:%S %z")
    return parsed.isoformat()


def to_money(raw):
    return round(float(raw), 2) if raw.strip() else 0.0


def sanitize_note(order_name, raw_note):
    note = raw_note.strip()
    if not note:
        return ""
    if order_name in NOTE_OVERRIDES:
        return NOTE_OVERRIDES[order_name]
    return ""  # unknown non-empty note: blank it, never leak


def build_shipping_address(first_row, anon, customer_id):
    has_any = any(
        first_row[col].strip()
        for col in ("Shipping Name", "Shipping Address1", "Shipping City", "Shipping Zip")
    )
    if not has_any:
        return None
    return {
        "name": anon.display_name(customer_id) if first_row["Shipping Name"].strip() else None,
        "address1": anon.street(customer_id) if first_row["Shipping Address1"].strip() else None,
        "zip": first_row["Shipping Zip"].strip() or None,
        "city": first_row["Shipping City"].strip() or None,
        "phone": anon.phone(customer_id) if first_row["Shipping Phone"].strip() else None,
    }


def build_billing_name(first_row, anon, customer_id):
    billing = first_row["Billing Name"].strip()
    if not billing:
        return None
    if billing == first_row["Shipping Name"].strip():
        return anon.display_name(customer_id)
    return anon.display_name(anon.id_for_name(billing))


def build_order(order_name, rows, anon):
    first = rows[0]
    customer_id = anon.id_for_email(first["Email"])
    line_items = [
        {
            "name": row["Lineitem name"],
            "quantity": int(row["Lineitem quantity"]),
            "price": to_money(row["Lineitem price"]),
        }
        for row in rows
    ]
    return {
        "name": order_name,
        "email": anon.email(customer_id),
        "createdAt": to_iso(first["Created at"]),
        "financialStatus": first["Financial Status"].strip(),
        "note": sanitize_note(order_name, first["Notes"]),
        "tags": first["Tags"].strip(),
        "shippingLine": first["Shipping Method"].strip(),
        "customAttributes": parse_note_attributes(first["Note Attributes"]),
        "shippingAddress": build_shipping_address(first, anon, customer_id),
        "billingName": build_billing_name(first, anon, customer_id),
        "subtotalPrice": to_money(first["Subtotal"]),
        "totalPrice": to_money(first["Total"]),
        "lineItems": line_items,
    }


def read_orders(csv_path):
    """Group CSV rows by order Name, preserving file order."""
    grouped = OrderedDict()
    with open(csv_path, encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            grouped.setdefault(row["Name"], []).append(row)
    return grouped


def attribute_value(order, key):
    for attribute in order["customAttributes"]:
        if attribute["key"] == key:
            return attribute["value"]
    return None


def build_golden(orders):
    units_by_day = {}
    orders_by_day = {}
    orders_without_zone = 0
    distinct_products = set()
    total_units = 0
    total_line_items = 0
    total_revenue = 0.0
    for order in orders:
        day = attribute_value(order, DAY_ATTRIBUTE_KEY) or "<sem dia>"
        zone = attribute_value(order, ZONE_ATTRIBUTE_KEY)
        if not zone:
            orders_without_zone += 1
        orders_by_day[day] = orders_by_day.get(day, 0) + 1
        order_units = sum(item["quantity"] for item in order["lineItems"])
        units_by_day[day] = units_by_day.get(day, 0) + order_units
        total_units += order_units
        total_line_items += len(order["lineItems"])
        total_revenue += order["totalPrice"]
        distinct_products.update(item["name"] for item in order["lineItems"])
    return {
        "orders": len(orders),
        "lineItems": total_line_items,
        "totalUnits": total_units,
        "unitsByDia": units_by_day,
        "ordersByDia": orders_by_day,
        "ordersSemZona": orders_without_zone,
        "distinctProducts": len(distinct_products),
        "totalRevenue": round(total_revenue, 2),
    }


def collect_store_addresses(grouped):
    """Pickup-point (store) addresses from 'Endereço de Ponto de Recolha'.
    On Store Pickup orders Shopify copies the STORE address into the
    shipping address columns — that is business info, not customer PII,
    and it legitimately stays verbatim inside Note Attributes."""
    stores = set()
    for rows in grouped.values():
        for line in rows[0]["Note Attributes"].split("\n"):
            if line.strip().startswith("Endereço de Ponto de Recolha:"):
                stores.add(line.split(":", 1)[1].strip().lower())
    return stores


def collect_pii_terms(grouped):
    """Real emails, phones, full names and street addresses from the CSV."""
    store_addresses = collect_store_addresses(grouped)
    terms = set()
    for rows in grouped.values():
        for row in rows:
            for col in ("Email",):
                value = row[col].strip().lower()
                if value:
                    terms.add(value)
            for col in ("Billing Name", "Shipping Name"):
                value = row[col].strip()
                if len(value) >= 4:
                    terms.add(value.lower())
            for col in ("Billing Address1", "Shipping Address1", "Billing Street", "Shipping Street"):
                value = row[col].strip().lower()
                is_store = any(value in store for store in store_addresses)
                if len(value) >= 6 and not is_store:
                    terms.add(value)
            for col in ("Billing Phone", "Shipping Phone", "Phone"):
                digits = re.sub(r"\D", "", row[col])
                if len(digits) >= 9:
                    terms.add(digits[-9:])
    return terms


def scan_for_pii(json_text, terms):
    haystack = json_text.lower()
    return sorted(term for term in terms if term in haystack)


def write_readme(path, csv_path, order_count, line_item_count):
    today = datetime.now(timezone.utc).date().isoformat()
    lines = [
        "# Fixtures w47 (anonimizadas)",
        f"Origem: export Shopify real `w47_2025_orders_export.csv` ({order_count} encomendas, {line_item_count} line items).",
        "Anonimização determinística por email: nomes → `Cliente NNN`, emails → `clienteNNN@example.com`, telefones → `9NNNNNNNN`, moradas → `Rua Exemplo N`; notes com PII limpas. Mantidos reais: zip, cidade, Note Attributes, produtos, quantidades, preços, datas, tags, shipping method, estado financeiro, nº de encomenda.",
        f"Gerado em {today} por `scripts/generate-fixtures.py` (verificação anti-PII incluída no gerador).",
        "Nunca editar à mão — regenerar com `py scripts/generate-fixtures.py`.",
    ]
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(lines) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default=DEFAULT_INPUT)
    parser.add_argument("--out-dir", default=DEFAULT_OUT_DIR)
    args = parser.parse_args()

    import os

    os.makedirs(args.out_dir, exist_ok=True)
    grouped = read_orders(args.input)

    anon = Anonymizer()
    orders = [build_order(name, rows, anon) for name, rows in grouped.items()]
    golden = build_golden(orders)

    orders_path = os.path.join(args.out_dir, "w47-orders.json")
    golden_path = os.path.join(args.out_dir, "w47-golden.json")
    readme_path = os.path.join(args.out_dir, "README.md")

    orders_json = json.dumps(orders, ensure_ascii=False, indent=2)
    with open(orders_path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(orders_json + "\n")
    with open(golden_path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(golden, ensure_ascii=False, indent=2) + "\n")
    write_readme(readme_path, args.input, golden["orders"], golden["lineItems"])

    # --- validation -------------------------------------------------------
    with open(orders_path, encoding="utf-8") as handle:
        reloaded = json.load(handle)  # raises if invalid JSON
    with open(golden_path, encoding="utf-8") as handle:
        json.load(handle)
    csv_line_items = sum(len(rows) for rows in grouped.values())
    assert len(reloaded) == len(grouped), "order count mismatch vs CSV"
    assert golden["lineItems"] == csv_line_items, "line item count mismatch vs CSV"

    pii_hits = scan_for_pii(orders_json, collect_pii_terms(grouped))
    if pii_hits:
        print("PII LEAK DETECTED — fixture NOT safe:", file=sys.stderr)
        for hit in pii_hits[:20]:
            print(f"  {hit}", file=sys.stderr)
        sys.exit(1)

    print(f"orders={golden['orders']} lineItems={golden['lineItems']} "
          f"totalUnits={golden['totalUnits']} ordersSemZona={golden['ordersSemZona']} "
          f"distinctProducts={golden['distinctProducts']} totalRevenue={golden['totalRevenue']}")
    print(f"unitsByDia={golden['unitsByDia']}")
    print(f"ordersByDia={golden['ordersByDia']}")
    print(f"PII scan: 0 hits across {len(collect_pii_terms(grouped))} real terms "
          f"(emails, nomes, moradas, telefones)")
    print(f"written: {orders_path}")
    print(f"written: {golden_path}")
    print(f"written: {readme_path}")


if __name__ == "__main__":
    main()
