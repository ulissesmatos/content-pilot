# Content Pilot

Painel para pesquisar, gerar e atualizar conteúdo no WordPress, com automações e revisão. Monorepo com Next.js, worker persistente, PostgreSQL e pg-boss.

## Estado para lançamento

Consulte a [revisão de lançamento](docs/launch-review.md) e o [runbook de implantação](docs/runbook.md). O código inclui isolamento por workspace com RLS, mas é necessário aplicar as migrations antes de executar esta versão. O ambiente de produção ainda precisa de validação completa.

## Desenvolvimento

Requisitos: Node.js 22 atualizado, pnpm conforme `packageManager` e Docker.

1. Copie `.env.example` para `.env` e substitua os segredos de exemplo. Nunca sobrescreva um `.env` existente.
2. Execute `pnpm install --frozen-lockfile`.
3. Execute `docker compose up -d` para iniciar o PostgreSQL local.
4. Execute `pnpm db:migrate` e `pnpm db:seed`. Em banco existente, faça backup antes.
5. Execute `pnpm dev` e abra `http://localhost:3000`.

O administrador usa o e-mail reservado em `ADMIN_EMAIL`. Cada cadastro público cria seu próprio workspace. Todo usuário cadastrado usa exclusivamente suas próprias chaves de IA/busca (BYOK) e do WordPress. Só a sua conta ativa, identificada por `ADMIN_EMAIL`, pode usar as chaves de IA/busca do sistema, independentemente de plano ou isenção. A IA e a busca podem ter custos cobrados pelos provedores. O perfil inicial usa OpenRouter; configure os modelos em `/admin/ai/profiles`.

Quem cadastra chave própria de IA **não tem limite de posts nem de tokens** — ele paga o provedor direto. Sites e autopilots continuam limitados pelo plano: eles consomem o worker, não a conta do usuário.

Recuperação de senha e confirmação de e-mail usam o [Resend](https://resend.com). Configure a chave e o remetente em `/admin/settings` (ou `RESEND_API_KEY`/`EMAIL_FROM` no ambiente) e verifique o domínio no Resend. Sem isso o produto funciona, mas ninguém recupera a senha sozinho.

`BILLING_ENABLED=false` é o padrão. A URL WordPress deve ser HTTPS pública e canônica, sem redirecionamentos, query ou fragmento.

## Verificação

```sh
pnpm typecheck
pnpm test
pnpm --filter web lint
pnpm build
pnpm audit --prod
```

Os testes de banco exigem `TEST_DATABASE_URL` para um banco **descartável** com nome terminado em `_test`: `pnpm test:integration`. Veja a criação do banco no runbook. O workflow `.github/workflows/verify.yml` executa essas verificações, incluindo o isolamento entre contas.

## Produção

Dois caminhos, ambos no [runbook](docs/runbook.md):

- **VPS com Docker Compose** — `docker-compose.prod.yml` sobe web, worker, banco e Caddy (TLS próprio).
- **Coolify** — `docker-compose.coolify.yml`, sem Caddy e sem portas publicadas: o proxy do Coolify termina o TLS. Usar o compose de produção no Coolify falha por disputa das portas 80/443.

Consulte o runbook para DNS, segredos, migração, backups e custos. Hospedar apenas o painel não mantém as automações funcionando: o worker precisa permanecer ativo.
