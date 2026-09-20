# Runbook — Content Pilot em produção

## Deploy inicial numa VPS (Ubuntu/Debian)

1. **Servidor**: uma VM Linux com Docker e memória suficiente para web + worker + PostgreSQL (prefira 2–4 GB; o build pode precisar de mais). Para custo zero, confira a disponibilidade e os limites atuais do Oracle Always Free. Instale Docker:
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
2. **DNS**: aponte um domínio/subdomínio (ex.: `pilot.seudominio.com`) para o IP da VPS (registro A). O Caddy emite o certificado TLS sozinho.
3. **Código**: `git clone` do repositório (ou `rsync` da pasta) para `/opt/content-pilot`.
4. **Variáveis**: crie `/opt/content-pilot/.env`:
   ```bash
   DOMAIN=pilot.seudominio.com
   POSTGRES_PASSWORD=$(openssl rand -hex 24)
   AUTH_SECRET=$(openssl rand -base64 32)
   ADMIN_EMAIL=voce@exemplo.com
   ADMIN_PASSWORD=uma-senha-forte
   VAULT_MASTER_KEYS=k1:$(openssl rand -base64 32)
   VAULT_ACTIVE_KEY_ID=k1
   WORKER_CONCURRENCY=2
   BILLING_ENABLED=false
   ```
   ⚠️ Guarde `VAULT_MASTER_KEYS` fora do servidor também (gerenciador de senhas). Sem ela as credenciais do banco ficam indecifráveis.
5. **Subir**:
   ```bash
   cd /opt/content-pilot
   docker compose -f docker-compose.prod.yml up -d --build
   ```
   O serviço `migrate` roda migrations + seed e termina; `web`, `worker` e `caddy` ficam de pé com `restart: unless-stopped`.
6. Acesse `https://pilot.seudominio.com` e faça login com ADMIN_EMAIL/ADMIN_PASSWORD.
   - **Chaves da plataforma**: `/admin/ai/keys`, exclusivamente para sua conta ativa identificada por `ADMIN_EMAIL`. Todas as outras contas precisam cadastrar chaves próprias em `/credentials`.
   - O provedor da chave deve corresponder ao perfil padrão em `/admin/ai/profiles` (OpenRouter no seed).
   - WordPress precisa de HTTPS público; URLs locais/privadas, portas personalizadas e redirecionamentos são recusados.
   - **Cobrança** opcional: desativada por padrão. Para ativar checkout, configure Stripe em `/admin/settings` e `BILLING_ENABLED=true`.
   - Credenciais do WordPress continuam por site, em Credenciais.

## Deploy no Coolify

Use `docker-compose.coolify.yml`, não o `docker-compose.prod.yml`. A diferença
é o proxy: o Coolify já mantém o dele nas portas 80/443 e emite o TLS. Subir o
Caddy do compose de produção dentro do Coolify faz o deploy falhar por porta
ocupada.

### 1. Servidor e DNS

- Servidor conectado ao Coolify com Docker. O build do Next precisa de memória:
  prefira 4 GB (com 2 GB, ative swap antes de buildar).
- Registro A do domínio (ex.: `pilot.seudominio.com`) apontando para o IP do
  servidor, **antes** do primeiro deploy — o certificado é emitido na subida.

### 2. Criar o recurso

No projeto do Coolify: **+ New** → **Docker Compose** (via repositório Git).

| Campo | Valor |
|---|---|
| Repository | o repositório deste projeto |
| Branch | `main` |
| Docker Compose Location | `/docker-compose.coolify.yml` |
| Base Directory | `/` |

### 3. Variáveis de ambiente

Na aba **Environment Variables** do recurso. Gere os segredos na sua máquina e
guarde-os num gerenciador de senhas antes de colar:

```bash
openssl rand -hex 24      # POSTGRES_PASSWORD (hex, nunca base64 — veja abaixo)
openssl rand -base64 32   # AUTH_SECRET
openssl rand -base64 32   # material da VAULT_MASTER_KEYS (prefixe com "k1:")
```

| Variável | Valor | Obrigatória |
|---|---|---|
| `POSTGRES_PASSWORD` | senha gerada com `openssl rand -hex 24` | sim |
| `AUTH_SECRET` | segredo gerado | sim |
| `AUTH_URL` | `https://pilot.seudominio.com` — https, sem barra final | sim |
| `ADMIN_EMAIL` | o seu e-mail; define quem é o super admin e a única conta com acesso às chaves do sistema | sim |
| `ADMIN_PASSWORD` | senha forte do primeiro login | sim |
| `VAULT_MASTER_KEYS` | `k1:<base64 de 32 bytes>` | sim |
| `VAULT_ACTIVE_KEY_ID` | `k1` | não (padrão `k1`) |
| `RESEND_API_KEY` | `re_…` do resend.com/api-keys | não, mas sem ela não há recuperação de senha |
| `EMAIL_FROM` | `Content Pilot <no-reply@seudominio.com>` | junto com a de cima |
| `BILLING_ENABLED` | `false` | não (padrão `false`) |
| `WORKER_CONCURRENCY` | `2` | não (padrão `2`) |
| `POSTGRES_USER` / `POSTGRES_DB` | `contentpilot` | não |

⚠️ **`POSTGRES_PASSWORD` em hexadecimal, não base64.** O compose monta o
`DATABASE_URL` com a senha crua; uma `/` (comum em base64, ~40% das senhas de 24
bytes) vira `Invalid URL` e o `migrate` falha sem apontar a senha como causa.
Evite também `@`, `#`, `?`, `:` e espaços se for escolher a senha à mão.

⚠️ `VAULT_MASTER_KEYS` precisa decodificar para **exatamente 32 bytes**, e
perdê-la torna todas as credenciais salvas indecifráveis. Guarde fora do
servidor. `ADMIN_EMAIL` é lido pelo worker a cada tarefa: trocá-lo transfere o
acesso às chaves do sistema e exige um workspace com uma única conta ativa.

### 4. Domínio

Nas configurações do serviço **`web`**, campo **Domains**, informe
`https://pilot.seudominio.com:3000`. **A porta `:3000` é obrigatória**: é a porta
interna do container, e é ela que diz ao proxy para onde rotear. Ela não aparece
na URL pública — o acesso continua em `https://pilot.seudominio.com`. É o único
serviço que recebe domínio; `postgres`, `worker` e `migrate` ficam sem exposição.

O `AUTH_URL` é a mesma URL **sem a porta** (`https://pilot.seudominio.com`).
Divergência entre ele e o domínio público (http vs https, `www`, barra final)
derruba o login com redirecionamento em loop.

Se preferir o domínio gerado pelo Coolify, declare `SERVICE_FQDN_WEB_3000` no
ambiente e use `AUTH_URL=${SERVICE_URL_WEB_3000}` — `SERVICE_URL_*` traz o
esquema, `SERVICE_FQDN_*` só o hostname.

### 5. Deploy

**Deploy**. A ordem é `postgres` (healthy) → `migrate` → `web` + `worker`.

O container `migrate` aplica as migrations e o seed e **sai com código 0**:
vê-lo como `exited` na lista é o comportamento correto, não uma falha.

### Sobre o status "running:unknown"

Um container sem healthcheck declarado não reporta saúde alguma, e o Coolify
agrega isso como `unknown` no recurso inteiro — mesmo com os demais saudáveis.
Era o caso do `worker`. Hoje os três serviços de vida longa declaram health:

| Serviço | Checagem |
|---|---|
| `postgres` | `pg_isready` |
| `web` | `GET /api/health` (confirma banco e RLS ativos) |
| `worker` | `GET :3001/health` — confirma que o `scheduler.tick` concluiu há menos de 3 minutos |

O do worker é a parte que faltava e é a mais útil: processo vivo não é o mesmo
que worker funcionando. Um pool esgotado ou um pg-boss preso deixava o
container "up" com as filas paradas em silêncio.

O `migrate` sai com código 0 e não declara health — é esperado.

Se mesmo assim o recurso ficar em `unknown`, é limitação conhecida do Coolify
para compose: ele não faz o polling dos healthchecks declarados no compose
([#9524](https://github.com/coollabsio/coolify/issues/9524)), e
`exclude_from_hc` não é respeitado nesse modo
([#6591](https://github.com/coollabsio/coolify/issues/6591)). A verificação
que sempre vale é externa:

```sh
curl https://pilot.seudominio.com/api/health   # {"ok":true}
```

Aponte um monitor externo (UptimeRobot, Better Stack, healthchecks.io) para
essa URL — é o que gera alerta de verdade.

## Segredos: cofre x .env

As chaves do Stripe são lidas **primeiro do cofre** (credencial de plataforma, tabela `credentials` com `workspace_id NULL`) e só depois das variáveis `STRIPE_*` do `.env`, campo a campo. Consequências práticas:

- Dá para girar a chave em `/admin/settings` sem deploy.
- Uma instalação antiga que só tem `.env` continua funcionando sem migração.
- Depois de salvar pelo painel, o valor do `.env` fica ignorado para aquele campo — o painel mostra a origem de cada um.
- Toda gravação carimba a versão da config; o worker enxerga a chave nova em até 30 segundos.

Nenhum segredo aparece na auditoria: `/admin/audit` registra quais campos mudaram, nunca o valor.

## Diagnóstico

| Sintoma | Checagem |
|---|---|
| Banner "Worker inativo" no painel | `docker compose -f docker-compose.prod.yml logs worker --tail 50` — o worker loga `[worker] pronto` ao subir e o scheduler roda a cada minuto |
| Execução presa em "Executando" | Worker caiu no meio — suba-o de novo; o botão "Parar execução" cancela o run e libera a fila |
| Custo "—" nos runs | Modelo fora da tabela de preços e provedor sem custo na resposta — OpenRouter devolve custo real automaticamente |
| 502 no domínio | `docker compose -f docker-compose.prod.yml logs caddy web --tail 50`; confira o healthcheck `/api/health` |
| Migrations falhando | `docker compose -f docker-compose.prod.yml logs migrate` |

## Gratuidade e limites

O aplicativo não cobra enquanto `BILLING_ENABLED=false`. Todas as contas de terceiros usam chaves próprias e não acessam as chaves globais.

Os limites de `packages/core/src/billing/plans.ts` se dividem em dois grupos:

- **Consumo** (posts/mês, tokens/mês): medem o que a plataforma financia. **Somem para quem cadastra chave própria de IA** — quem paga o provedor direto não tem volume limitado por nós.
- **Estrutural** (sites, autopilots): medem o que roda no nosso worker e valem para todos, BYOK ou não. Um autopilot ativo executa sozinho pelo scheduler, sem ninguém pedir; é o limite que protege o servidor. Somente o workspace da sua conta ativa (`ADMIN_EMAIL`) pode usar chaves do sistema. Isenção de cotas, cargo de admin ou plano pago não dão essa permissão. A identidade é revalidada no worker, inclusive nas automações. Se o workspace tiver mais de uma conta não excluída, o acesso global é bloqueado.

Consulte o [relatório de lançamento](launch-review.md) para limitações, opções de hospedagem e validações ainda necessárias.

## Antes de executar: o que o painel bloqueia

O pipeline falhava só durante a execução: o run nascia, ficava "Executando" e
morria com `HTTP 400` ou "nenhuma credencial" — já com crédito de busca gasto e
sem dizer o que consertar.

Agora `getWorkspaceReadiness` decide isso antes, a partir do banco local (sem
chamar provedor nenhum, em milissegundos) e confere:

- cada etapa do perfil tem modelo configurado;
- existe credencial do provedor que a etapa resolve (chave da plataforma só
  conta para o dono da instalação — a mesma regra do worker);
- o modelo está no `model_catalog` daquele provedor e marcado como disponível;
- o modelo de `illustrate` aceita imagem;
- existe chave Tavily e ao menos um site conectado.

O resultado vira um aviso com link de conserto no topo de Autopilot e Jobs, e
desabilita os botões de execução. **O bloqueio de verdade é no servidor**:
`assertWorkspaceReady` roda dentro de `runJobNowAction`,
`runAutopilotNowAction` e `generateTopicNowAction`, então chamar a action
direto também é recusado.

**O que a prontidão NÃO consegue saber.** `model_catalog` é o catálogo da
INSTALAÇÃO: ele só recebe modelos nativos dos provedores para os quais existe
chave da **plataforma** (ver `catalog-sync`). Ele não enxerga o que a chave BYOK
de um cliente tem. Por isso a conferência de modelo só vale para provedores que
o catálogo cobre — fora disso a resposta é "não sei", e "não sei" nunca
bloqueia. Quem confere o modelo de um BYOK é o salvamento em `/credentials`,
que pergunta à própria chave do usuário, e o preflight do worker antes de
gastar.

O `preflightLlmTasks` do worker continua existindo e é complementar: ele fala
com o provedor de verdade e pega o que só a API sabe — chave revogada, modelo
removido depois da última sincronização do catálogo.

**Catálogo vazio.** Sem catálogo não há como conferir modelo nem escolher outro
em `/admin/ai/profiles`. Ele sincronizava só às 3h ou por clique manual, o que
deixava uma instalação nova sem opção alguma justamente durante a configuração.
Agora o worker sincroniza no boot quando a tabela está vazia — o endpoint de
listagem do OpenRouter é público e funciona sem chave.

## Id de modelo: formato do OpenRouter x nativo

O OpenRouter endereça modelos como `fornecedor/modelo` ("openai/gpt-4o-mini").
As APIs nativas da OpenAI e da Anthropic só aceitam o id nu ("gpt-4o-mini") e
respondem **HTTP 400 apenas na execução** — o salvamento passa, o job falha.

Os perfis semeados usam ids do OpenRouter, então trocar só o provedor da etapa
em `/admin/ai/profiles` deixa o id antigo para trás. Foi assim que a falha
apareceu em produção.

`checkProviderModel` (em `packages/core/src/llm/model-id.ts`) separa dois casos
que se escondem atrás da mesma barra:

| Situação | O que é feito |
|---|---|
| `openai/gpt-4o-mini` com provedor **openai** — o prefixo só repete o provedor | Prefixo removido. A credencial escolhida é mantida. |
| `anthropic/claude-x` com provedor **openai** — id de **outro** fornecedor | Não há correção segura: inventar um id nativo seria pior. O salvamento é recusado; numa linha já gravada, o provedor passa a openrouter. |
| Qualquer id com provedor **openrouter** | Intocado — ali o prefixo é o endereço do modelo. |

A regra vale em quatro pontos: no salvamento do perfil do admin, no salvamento
da escolha BYOK em `/credentials`, no reparo do seed (todo deploy) e, como
última defesa, na resolução do worker — assim a execução funciona mesmo antes
de o banco ser limpo.

**Reparo de instalações afetadas.** Uma versão anterior corrigia isso trocando o
provedor para openrouter em vez de remover o prefixo, o que aponta a etapa para
uma chave que a instalação pode não ter. O seed desfaz isso, mas só quando a
configuração atual é comprovadamente inutilizável: não existe credencial
OpenRouter da plataforma **e** existe credencial do fornecedor que está no
prefixo. Quem usa OpenRouter de verdade não é tocado.

Isso conserta as etapas cujo modelo é da OpenAI/Anthropic. Etapas apontando para
modelos sem equivalente nativo (DeepSeek, Z-AI) continuam exigindo chave
OpenRouter — troque o modelo em `/admin/ai/profiles` ou cadastre a chave.

## Cache de configuração

Perfis de modelo, planos e settings são lidos por `cachedConfig`: TTL de 30s
mais um carimbo de versão em `platform_settings.__version`. Quando o carimbo
não muda, o valor em memória é revalidado **sem recarregar** — o que significa
que uma mutação que esquece de carimbar nunca chega ao worker, nem depois do
TTL. Só reiniciando o processo.

Foi o que aconteceu com `setProfileEntryAction`: trocar o modelo em
`/admin/ai/profiles` não tinha efeito no worker. Por isso o carimbo saiu das
actions individuais e passou para `runAdminAction`, na mesma transação da
auditoria: toda mutação administrativa passa por lá, então a garantia é
estrutural em vez de lembrete.

Gravações fora desse caminho (scripts, SQL manual) continuam precisando de
`bumpConfigVersion` — ou de reiniciar web e worker.

## Migrações desta versão

`0009_email_auth.sql` cria `auth_tokens` (links de troca de senha e confirmação,
guardados só como SHA-256) e adiciona `users.email_verified_at` e
`users.sessions_valid_from`. Não exige janela de manutenção nem toca em dados
existentes. A tabela não recebe GRANT para `content_pilot_tenant` e tem RLS
ligada: o papel de cliente não a enxerga.

## Migração de isolamento entre contas

A migração `0008_tenant_isolation.sql` precisa rodar **antes** desta versão da web. Ela cria o papel PostgreSQL `content_pilot_tenant`, políticas RLS, restrições de relacionamento, propriedade imutável e contadores de tentativas. A conexão de migração precisa poder criar esse papel e concedê-lo ao usuário da aplicação. O Compose fornecido usa o mesmo proprietário para migração e serviços. Em banco gerenciado com usuários diferentes, conceda explicitamente o papel ao login de execução; não desative as políticas para contornar erros.

Faça backup antes de migrar. Relacionamentos antigos entre contas diferentes causam falha da migração e precisam ser corrigidos individualmente; a migração não move nem apaga esses dados. Nunca use `drizzle-kit push` em produção: as políticas, grants e triggers são gerenciados pelo SQL das migrations.

Todas as páginas e ações de cliente usam `getTenantDb(workspaceId)` a partir da sessão verificada. Cada consulta assume um papel sem privilégios administrativos e define o workspace com `SET LOCAL`, dentro de transação. Consultas sem filtro continuam restritas ao workspace. Templates builtin são compartilhados apenas para leitura. Assinaturas, custos, logs, usuários e configurações globais não ganham permissão de escrita pelo papel de cliente.

Autenticação, cadastro, administração, fila e worker ainda usam uma conexão privilegiada no servidor. Essa é uma fronteira de confiança: RLS protege as consultas de cliente, não um servidor comprometido. As relações compostas e guardas de fila também protegem gravações do worker. Nunca entregue `DATABASE_URL` ao navegador. Não adicione `getDb` às ações/páginas de cliente (o ESLint barra esse uso).

## Limites de tentativas e proxy

Os contadores são atômicos no PostgreSQL e persistem entre réplicas/reinícios: login conta todas as tentativas antes do bcrypt; cadastro tem teto por IP e global; ações autenticadas têm teto por usuário. O Caddy deve ser a única entrada pública. Não exponha a porta da web diretamente: o IP vem de `X-Forwarded-For` sobrescrito pelo proxy confiável. Sem IP, as tentativas dividem o bucket `unknown`, sem desativar o limite.

## Teste automatizado de isolamento

Use um banco descartável cujo nome termine em `_test` (nunca o banco pessoal):

```bash
docker run --rm -d --name content-pilot-test -e POSTGRES_PASSWORD=test-only -e POSTGRES_DB=contentpilot_test -p 127.0.0.1:55439:5432 postgres:17-alpine
TEST_DATABASE_URL=postgres://postgres:test-only@localhost:55439/contentpilot_test pnpm test:integration
docker stop content-pilot-test
```

No PowerShell, defina `$env:TEST_DATABASE_URL` antes de executar `pnpm test:integration`. O teste aplica as migrations e cria fixtures; remova o container descartável ao terminar. Também rode `pnpm typecheck`, `pnpm test`, `pnpm --filter web lint`, `pnpm build` e `pnpm audit --prod`.
