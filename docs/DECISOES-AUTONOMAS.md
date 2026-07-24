# Decisões autónomas — período de ausência do António

> Durante uma ausência do António (a partir de 20 jul 2026, fim do dia), fica acordado:
> nos pontos de decisão que normalmente lhe perguntaria, escolho e executo a opção que
> recomendaria, registando-a aqui com uma linha de justificação. **Exceção (continua a
> esperar por ele):** ações irreversíveis ou viradas para fora — enviar mensagens ao
> Miguel/parceiros, apagar dados, alterar produção.
>
> Alterações de código (commits no repo) contam como reversíveis e revisíveis, logo entram
> no âmbito autónomo. Cada entrada abaixo é para revisão quando voltar.

| # | Data | Decisão | Justificação |
|---|---|---|---|
| 1 | 20/07 | Auditoria red-team adaptada ao alvo: corridas as frentes de robustez/segurança/performance; **omitidas** as personas de SEO, conteúdo e CRO. | O alvo é uma app admin embebida interna (1 operador, sem público nem conversão nem indexação) — essas dimensões não se aplicam; corrê-las produziria achados fabricados. |
| 2 | 20/07 | Auditoria feita estática + ao nível do motor, **sem personas de browser**. | A app não está deployed e não arranca sem credenciais Shopify; não há instância para navegar. Os vetores reais (dados de cliente → exports/BD) testam-se pelo código e pelo motor. |
| 3 | 20/07 | Fixes de segurança CONFIRMADOS pela verificação adversarial serão **aplicados** (com testes+commit), não apenas reportados. | Instrução do António de usar bom senso na sua ausência; fixes de código são reversíveis via git. Design/ambíguo fica como recomendação. |
| 4 | 20/07 | Aplicado o guard de formula-injection só no **CSV DPD**, não nos xlsx. | Tecnicamente o exceljs escreve células de texto tipado que o Excel não avalia — o vetor real é só o CSV. Evita regressão cosmética (plica visível) nos xlsx. |
| 5 | 20/07 | **Retido** o fix da janela de encomendas no-op (bugs-1, ALTO) — entregue como proposta. | Toca o caminho *live* não-testável sem credenciais e interage com o modo demo/CSV (base dos golden tests); é pré-produção e o default coincide hoje com o cutoff real. Melhor o António rever a abordagem. |
| 6 | 20/07 | Aplicados: guard zona-sem-estafeta (pipeline), clamp de quantidade [0,500] no CSV, scope `read_orders`, `dev.sqlite` no .dockerignore. | Todos seguros, inequívocos, com testes; corrigem 1 ALTO de silêncio + 1 ALTO de segurança + higiene de deploy. |
| 7 | 20/07 | **Retido** multi-tenant/AppDistribution (pii-1) e demais MÉDIO/BAIXO. | Decisão de arquitetura (recomendo SingleMerchant) — não é urgente nem inequívoca. |
| 8 | 20/07 | O guard de fórmula introduziu uma **regressão no telemóvel DPD** (apanhada por testes existentes: `+351...` ganhava plica e o indicativo não era removido). Corrigido separando `stripCsvControls` (base, usada pelo telefone) do `cleanTextField` (base+guard, texto livre). | Fix da correção; 390 testes verdes. Prova de que os testes existentes protegem contra os meus próprios erros. |
