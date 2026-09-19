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
   POSTGRES_PASSWORD=$(openssl rand -base64 24)
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
openssl rand -base64 24   # POSTGRES_PASSWORD
openssl rand -base64 32   # AUTH_SECRET
openssl rand -base64 32   # material da VAULT_MASTER_KEYS (prefixe com "k1:")
```

| Variável | Valor | Obrigatória |
|---|---|---|
| `POSTGRES_PASSWORD` | senha gerada | sim |
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

⚠️ `VAULT_MASTER_KEYS` precisa decodificar para **exatamente 32 bytes**, e
perdê-la torna todas as credenciais salvas indecifráveis. Guarde fora do
servidor. `ADMIN_EMAIL` é lido pelo worker a cada tarefa: trocá-lo transfere o
acesso às chaves do sistema e exige um workspace com uma única conta ativa.

### 4. Domínio

Nas configurações do serviço **`web`**, campo **Domains**, informe
`https://pilot.seudominio.com`. É o único serviço que recebe domínio —
`postgres`, `worker` e `migrate` ficam sem exposição pública.

O valor precisa ser idêntico ao `AUTH_URL`. Divergência (http vs https, `www`,
barra final) derruba o login com redirecionamento em loop.

Se preferir o domínio gerado pelo Coolify, declare `SERVICE_FQDN_WEB_3000` no
ambiente e use `AUTH_URL=${SERVICE_URL_WEB_3000}` — `SERVICE_URL_*` traz o
esquema, `SERVICE_FQDN_*` só o hostname.

### 5. Deploy

**Deploy**. A ordem é `postgres` (healthy) → `migrate` → `web` + `worker`.

O container `migrate` aplica as migrations e o seed e **sai com código 0**:
vê-lo como `exited` na lista é o comportamento correto, não uma falha. Se o
Coolify marcar o deploy como não saudável por causa dele, desative o health
check daquele container — `web` e `worker` é que precisam ficar de pé.

### 6. Conferir

1. `https://pilot.seudominio.com/api/health` responde `{"ok":true}` — isso
   também confirma que o RLS está ativo (papel `content_pilot_tenant` criado).
2. Login com `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
3. O painel não mostra o aviso "Worker inativo" depois de ~1 minuto.
4. `/admin/ai/keys`: cadastre as chaves do sistema (só a sua conta as usa).
5. `/admin/ai/profiles`: o provedor do perfil padrão precisa bater com a chave.
6. Cadastre uma segunda conta de teste em `/register` e confirme que ela é
   obrigada a trazer chave própria em `/credentials`.
7. Em `/forgot-password`, peça um link para essa conta de teste e confirme que
   o e-mail chega. É o único jeito de saber que o domínio está verificado no
   Resend — a tela responde igual mesmo quando nada é enviado.

### Atualizações

`git push` na branch configurada. Com webhook ativo o Coolify rebuilda sozinho;
senão, **Redeploy**. O `migrate` roda antes de web/worker subirem.

### Backup no Coolify

O PostgreSQL deste compose é um container do stack, então **não entra no backup
automático do Coolify**, que cobre apenas recursos de banco gerenciados por ele.
Duas saídas:

- **Scheduled Task** no recurso, com `pg_dump` para um volume e cópia para fora
  do servidor. Sem a cópia externa, o backup morre junto com a VM.
- **PostgreSQL gerenciado pelo Coolify** como recurso separado (tem backup
  agendado para S3 na interface). Nesse caso remova o serviço `postgres` do
  compose e aponte `DATABASE_URL` para o host interno do banco gerenciado. O
  usuário informado precisa poder criar o papel `content_pilot_tenant` — o
  `postgres` superusuário serve.

Teste a restauração antes de abrir o cadastro ao público.

## Atualizar a aplicação

```bash
cd /opt/content-pilot
git pull
docker compose -f docker-compose.prod.yml up -d --build
```
O `migrate` aplica novas migrations antes de web/worker subirem.

## Backup do banco (diário)

```bash
# /etc/cron.d/content-pilot-backup
0 4 * * * root docker exec $(docker ps -qf name=postgres) pg_dump -U contentpilot contentpilot | gzip > /opt/backups/content-pilot-$(date +\%u).sql.gz
```
Mantém 7 dias em rotação (`%u` = dia da semana). Restaurar:
```bash
gunzip -c backup.sql.gz | docker exec -i $(docker ps -qf name=postgres) psql -U contentpilot contentpilot
```

## Rotação da master key do vault

1. Gere `k2` e adicione ao `.env` **sem remover a k1**:
   `VAULT_MASTER_KEYS=k1:<antiga>,k2:<nova>` e `VAULT_ACTIVE_KEY_ID=k2`
2. Recrie os serviços: `docker compose -f docker-compose.prod.yml up -d`
3. Novas credenciais passam a usar k2; as antigas continuam legíveis pela k1. Para migrar as antigas, re-salve cada credencial no painel (excluir/recriar) e então remova `k1:` do `.env`.
4. As credenciais da **plataforma** também precisam ser re-salvas: `/admin/ai/keys` e `/admin/settings`. Basta colar a chave de novo — o formulário regrava com a chave ativa.

## E-mail transacional (Resend)

Usado em dois lugares: recuperação de senha e confirmação de e-mail. Sem ele o
produto funciona, mas quem esquecer a senha depende de você mexer no banco.

1. Crie uma API key em `resend.com/api-keys` com permissão de envio.
2. Verifique o domínio do remetente no Resend (DNS). **Chave válida com domínio
   não verificado é o erro mais comum:** a API aceita a chave e recusa o envio
   com 403.
3. Configure em `/admin/settings` → Chave do Resend e Remetente. As variáveis
   `RESEND_API_KEY` e `EMAIL_FROM` do ambiente valem como reserva, campo a
   campo, igual ao Stripe.

O painel avisa em `/admin/settings` quando o envio não está configurado. O
aviso de "confirme seu e-mail" no painel do usuário só aparece quando há como
enviar — avisar sem poder reenviar seria pedir uma ação impossível.

**A resposta de `/forgot-password` é sempre a mesma**, exista a conta ou não,
esteja o Resend no ar ou não. Isso é proposital: qualquer diferença
transformaria o formulário num verificador de quem tem conta na instalação. Para
saber se um envio falhou, leia o log do serviço web (`[email:password-reset]`).

Contas suspensas ou banidas não recebem link de recuperação — devolver o acesso
por e-mail desfaria a moderação.

Trocar a senha encerra as sessões abertas em outros aparelhos (`users.sessions_valid_from`).
Como a sessão é JWT e não existe tabela de sessões para apagar, é esse carimbo
que faz a troca valer: sem ele, quem tivesse roubado a conta continuaria dentro
depois da troca.

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
