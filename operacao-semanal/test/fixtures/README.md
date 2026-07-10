# Fixtures w47 (anonimizadas)
Origem: export Shopify real `w47_2025_orders_export.csv` (185 encomendas, 1028 line items).
Anonimização determinística por email: nomes → `Cliente NNN`, emails → `clienteNNN@example.com`, telefones → `9NNNNNNNN`, moradas → `Rua Exemplo N`; notes com PII limpas. Mantidos reais: zip, cidade, Note Attributes, produtos, quantidades, preços, datas, tags, shipping method, estado financeiro, nº de encomenda.
Gerado em 2026-07-10 por `scripts/generate-fixtures.py` (verificação anti-PII incluída no gerador).
Nunca editar à mão — regenerar com `py scripts/generate-fixtures.py`.
