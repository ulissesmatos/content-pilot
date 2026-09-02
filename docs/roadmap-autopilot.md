# Roadmap — Autopilot e produto SaaS

> Documento de intenção. Captura a visão completa para o modo Autopilot e a
> transformação do Content Pilot em produto multi-tenant, dividida em fases
> incrementais que reaproveitam a arquitetura existente.

## A visão

Um modo **Autopilot** que, depois de configurado, toma conta sozinho do blog:

1. **Roda sozinho** — x vezes a cada x tempo (agendamento cron, como os jobs de hoje).
2. **Descobre o que produzir** — busca na web o que está em alta no nicho do site
   (tendências, o que as pessoas estão pesquisando) e decide o tipo de conteúdo:
   evergreen, notícia, lista, guia.
3. **Não se repete** — antes de produzir, consulta o inventário de posts já
   publicados no WordPress e as pautas já geradas, descartando temas duplicados.
4. **Produz conteúdo completo** — artigo otimizado (SEO title, meta description,
   categoria correta, estrutura de headings), com **links externos** para fontes
   confiáveis em pontos naturais do texto.
5. **Ilustra sozinho** — busca imagens relacionadas, **olha a imagem** (visão
   multimodal) para confirmar que faz sentido com o artigo, baixa, faz upload na
   biblioteca de mídia do WordPress e insere no post (featured image + inline).
6. **Publica ou enfileira para revisão** — modo rascunho ou publicação direta,
   como as pautas de hoje.

Tudo isso funcionando bem tanto em modelos econômicos (gpt-4.1-mini,
claude-haiku) quanto em modelos avançados — o que o pipeline atual já garante
via structured outputs + validação determinística fail-safe (nunca confiar no
modelo; sempre verificar).

## Duas versões do produto

| | Cliente (SaaS) | Admin / Business |
|---|---|---|
| Chaves de IA/busca | **Não configura nada** — usa as chaves da plataforma | Chaves da plataforma **ou** as próprias (BYOK) |
| Onboarding | Conecta o WordPress e pronto | Completo (credenciais, templates custom) |
| Cobrança | Assinatura mensal via Stripe, com limites por plano | BYOK pode ser feature do plano mais caro |
| Custo de IA | Absorvido no preço do plano (medido por workspace) | Do próprio bolso quando BYOK |

A versão admin é o sistema atual. A versão cliente é o mesmo sistema com as
credenciais resolvidas em cascata: **workspace → plataforma** (fallback), mais
medição de uso e limites por plano.

## O que já existe e será reaproveitado

| Peça existente | Reuso no Autopilot |
|---|---|
| `briefs` (pautas) + pipeline generate | O Autopilot **gera pautas automaticamente** e as executa — a fábrica de posts já existe |
| `content_jobs` + cron do worker | Mesmo mecanismo de agendamento para o job de descoberta |
| `TavilyClient` | Busca de tendências (search por nicho + notícias) e de fontes para links externos |
| `HttpLlmProvider` (anthropic/openai/openrouter) | Todas as decisões do Autopilot são chamadas estruturadas pequenas — funciona em mini-modelos |
| `validateOutput` + verbatim check | Mesma filosofia fail-safe para títulos, links e imagens |
| `WordPressAdapter` | Ganha `uploadMedia()` e `setFeaturedImage()` — o resto já existe |
| `workspaces` + credenciais AES-256-GCM por workspace | Base do multi-tenant; BYOK já é o modelo atual |
| `runs`/`run_items`/`llm_calls` com custo por chamada | Base da medição de uso por plano |

## Fases

### Fase 0 — Separação visual criação × atualização (feito neste ciclo)
Leigo bate o olho e entende: **Atualizar posts** (azul) e **Criar posts**
(violeta) como seções distintas; coluna "Tipo" nas Execuções com badge colorido.

### Fase 1 — Descoberta de temas (o cérebro do Autopilot) ✅ implementada 2026-07-09
- Tabelas `autopilot_configs` e `discovered_topics`; coluna `autopilot_config_id`
  em `runs` (migração `0002_exotic_shooting_star.sql`).
- Core `packages/core/src/autopilot/`: `runDiscovery` (busca Tavily → 1 chamada
  LLM classifica candidatos → dedup em 2 camadas: Jaccard determinístico +
  LLM semântico). Structured output; fail-safe (o determinístico já barra o
  óbvio; na dúvida mantém). 14 testes unitários.
- Worker `autopilot.discover` + varredura no `scheduler-tick` (mesmo padrão dos
  jobs). Cada tema sobrevivente vira uma pauta (brief) — status `pending`
  (revisar) ou `queued` (autoQueue → enfileira `brief.generate`).
- Dedup consulta títulos recentes do WP (`listRecentPostTitles`, leve) + pautas
  + temas já descobertos (memória entre ciclos).
- UI: página `/autopilot` (config + feed de descobertos/descartados), link na
  sidebar (ponto âmbar), badge "Descoberta" nas Execuções.
- **Pendente**: aplicar a migração (`pnpm --filter @content-pilot/db migrate`)
  com o Postgres no ar e smoke test ao vivo.

### Fase 2 — Links externos e SEO ✅ implementada 2026-07-09
- Módulo `packages/core/src/html/external-links.ts`: `sanitizeExternalLinks`
  remove qualquer `<a href>` externo cujo URL não conste nas fontes da busca
  (anti-alucinação, mantendo o texto). Links internos/relativos/do próprio site
  passam intactos. Só roda em geração de conteúdo novo (em update, links
  pré-existentes do post não estão nas fontes de hoje e não podem ser removidos).
- Envelope da resposta ganhou `metaDescription` e `category` (strict mode).
  Pipeline: guardrail determinístico `resolveCategory` só aceita categoria que
  exista de fato na lista real do site; retorna `metaDescription`/`category`/
  `externalLinks` no resultado.
- Config do template: blocos `seo { metaDescription, chooseCategory }` e
  `externalLinks { enabled, min, max }`. Habilitados no `generic-article`,
  desligados no `game-codes` (fluxo especializado).
- Prompt de geração do genérico pede N links para fontes reais + meta
  description + categoria dentre `{{categories}}`.
- Worker `brief-generate`: busca `listCategories` quando o template pede, passa
  `availableCategories` + `siteBaseUrl` ao pipeline, mapeia a categoria escolhida
  (nome→ID do WP) e usa `metaDescription` como excerpt do post.
- Posts do Autopilot herdam tudo isso automaticamente (usam o mesmo
  `brief.generate`). 8 testes novos (external-links + validate-output SEO).

### Fase 3 — Imagens ✅ implementada 2026-07-09
- `packages/core/src/images/openverse.ts`: `OpenverseClient` (agregador CC do
  WordPress.org, **sem API key** — cliente SaaS não configura nada), filtra por
  uso comercial + conteúdo seguro, preserva atribuição. Sem scraping.
- `packages/core/src/images/illustrate.ts`: busca candidatas → 1 chamada LLM
  **com visão** (miniaturas anexadas) escolhe a mais relevante ou -1 (nenhuma) e
  gera alt text. Fail-safe: nada relevante / modelo sem visão / download falhou →
  post publica sem imagem (nunca imagem errada).
- Cliente LLM ganhou suporte multimodal: `LlmCompleteRequest.images` → blocos
  `image`/`image_url` por provedor (Anthropic url source, OpenAI/OpenRouter
  image_url).
- WordPress: `uploadMedia` (POST binário + alt/caption) e `featured_media` no
  `createPost`. Worker `brief-generate`: `illustratePost` baixa a imagem
  escolhida, faz upload e define como destacada (reusa o modelo de geração para
  a visão). Config `images { enabled, candidates }` no template (ligado no
  generic-article). 8 testes novos.
- **Requer modelo com visão** (claude-haiku-4-5, gpt-4.1-mini): modelo sem visão
  (ex.: deepseek-v4-flash) gera o post mas sem imagem. Verificado ao vivo:
  Openverse retorna candidatas reais e o LLM de visão escolhe corretamente com
  alt text específico.
- Futuro (não nesta fase): imagens inline no corpo, além da destacada.

### Fase 4 — Autopilot completo (orquestração) ✅ implementada 2026-07-12
- O ciclo 1→2→3 já era encadeado via `autoQueue`; esta fase adicionou o
  controle: coluna `limits` em `autopilot_configs` (`autopilotLimitsSchema`:
  monthlyBudgetUsd, maxPostsPerDay, generationTokenBudget), migração `0003`.
- Kill-switches determinísticos no `autopilot.discover`, ANTES de gastar IA:
  (1) plano do workspace permite gerar? (2) orçamento mensal da config
  (custo LLM real via `llm_calls`) atingido → ciclo cancelado com motivo;
  (3) máx. de pautas em 24h → `postsPerCycle` é capado ao restante.
- Atribuição de custo: runs de geração disparados pelo autopilot carregam
  `autopilotConfigId` — o orçamento mensal soma descoberta + geração + visão.
- Painel: cards (pautas aguardando revisão, pautas no mês, custo de IA no mês),
  coluna "Custo no mês" com barra de orçamento por config, campos de orçamento
  e máx./dia no formulário. Rascunho continua sendo o default.

### Fase 5 — SaaS multi-tenant ✅ implementada 2026-07-12
- **Chaves da plataforma**: `credentials.workspaceId` agora é NULL para
  credenciais globais (AAD do vault usa o escopo fixo `platform`). Resolução em
  cascata no worker: chave do workspace → chave da plataforma. Admin cria/vê
  as globais na página de credenciais (badge "Plataforma").
- **Planos**: `packages/core/src/billing/plans.ts` — free/starter/pro/unlimited
  com limites (posts/mês, tokens/mês, sites, autopilots, BYOK). Limites vivem
  no código; o banco só guarda o plano. Enforcement determinístico no worker
  (`plan-guard.ts`: brief.generate e job.run) e nas actions (criar site,
  criar autopilot, criar credencial de IA sem BYOK).
- **Stripe** (stripe-node v22): checkout de assinatura + portal do cliente
  (`actions/billing.ts`), webhook assinado em `/api/stripe/webhook`
  (checkout.session.completed, customer.subscription.*, invoice.payment_failed),
  tabela `subscriptions` (workspace único, plano, status, período). Envs:
  STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_STARTER/PRO.
  Página `/billing` com plano atual, uso do mês (barras) e upgrade.
- **Papéis**: `users.role` (owner|admin) na sessão/JWT; admin = plano
  `unlimited` + credenciais da plataforma. Seed promove o usuário admin.
- **Onboarding cliente**: `/register` cria workspace + owner no plano free e
  autentica — sem pedir chave de IA nenhuma (usa as da plataforma).
- Segurança adicionada nesta fase: rate limit de login (5 falhas/15min),
  validação de posse de template em todas as actions (cross-tenant), escopo de
  workspace na credencial do site no worker.

### Extras entregues junto (2026-07-12)
- **i18n**: next-intl com pt-BR e en (cookie + Accept-Language, sem prefixo de
  URL); catálogos em `apps/web/messages/*.json`; seletor de idioma em
  Configurações. Para adicionar idioma: criar `messages/<locale>.json` e
  registrar em `src/i18n/config.ts`. Pendente: textos internos dos dialogs de
  criação/edição (ainda pt-BR).
- **Otimização de IA sem perder qualidade**:
  - Dedup semântico só na banda de incerteza (Jaccard 0.25–0.6): candidatos
    claramente novos não gastam a chamada; prompt de dedup só recebe títulos
    minimamente parecidos (era até 300).
  - Ilustração: pool 12+ do Openverse (grátis) + pré-rank determinístico por
    sobreposição de tokens → a visão continua decidindo, mas sobre candidatas
    melhores.
- **Desempenho**: cache de extract filtra por URL (antes carregava o cache
  inteiro do workspace), inserts em lote em `llm_calls`/`discovered_topics`,
  cancelamento de execução agora alcança também filas brief.generate e
  autopilot.discover.

## Princípios (valem para todas as fases)

1. **Nunca confiar no LLM** — toda afirmação publicável (código, link, imagem,
   categoria) passa por validação determinística contra dados reais.
2. **Decisões pequenas e estruturadas** — cada passo do Autopilot é uma chamada
   com JSON schema e propósito único; é isso que faz mini-modelos funcionarem.
3. **Custo visível** — cada fase registra tokens/custo em `llm_calls` como hoje.
4. **Rascunho por default** — automação nova nasce conservadora; publicação
   direta é opt-in.
5. **Escopo por workspace em tudo** — nenhuma query nova sem `workspaceId`.
