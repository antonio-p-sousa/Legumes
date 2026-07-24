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
