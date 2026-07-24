# Documentação — Operação Semanal (LOV)

Índice dos documentos do projeto. Todos vivem em `docs/` (planos, decisões e
referência versionados junto do código).

## Arranque e referência

| Documento | O que é |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Documento de arquitetura — regras de negócio, modelo de dados, módulos do motor, fases. **Ler primeiro.** |
| [DEPLOY.md](DEPLOY.md) | Guia de deployment (Fly.io + Neon), migração SQLite→Postgres, variáveis de ambiente, pós-deploy. |

## Planeamento e estado

| Documento | O que é |
|---|---|
| [CRONOGRAMA.md](CRONOGRAMA.md) | Fases do projeto, datas e estado. |
| [POR-FAZER.md](POR-FAZER.md) | Checklist completo até ao go-live (cliente / Loop / técnico / validação). Fonte única do que falta. |
| [DECISOES-AUTONOMAS.md](DECISOES-AUTONOMAS.md) | Registo das decisões tomadas de forma autónoma durante a ausência do António, com justificação. |

## Input do cliente

| Documento | O que é |
|---|---|
| [RECONCILIACAO-VIDEOS.md](RECONCILIACAO-VIDEOS.md) | Reconciliação dos vídeos/respostas do cliente com o código: o que confirma, acrescenta ou contradiz. |
| [videos-cliente/](videos-cliente/) | Transcrições dos 7 vídeos do processo manual (geradas localmente). |

## Qualidade

| Documento | O que é |
|---|---|
| [AUDITORIA-RED-TEAM.md](AUDITORIA-RED-TEAM.md) | Auditoria red-team (robustez/segurança/performance): achados verificados, o que foi corrigido, o que ficou retido, plano por fases. |

---

> Deliverables para o cliente/Loop (Excel de estado, DOCX de pendências) **não** vivem
> no repositório — estão na pasta do projeto no OneDrive. Dados reais de clientes
> (exports com PII) nunca entram no repo — só fixtures anonimizadas em
> [`operacao-semanal/test/fixtures/`](../operacao-semanal/test/fixtures/).
