# Runbook — Content Pilot em produção

## Deploy inicial numa VPS (Ubuntu/Debian)

1. **Servidor**: qualquer VPS com ~1 GB de RAM (Hetzner CX22, Contabo, Oracle Free). Instale Docker:
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
   ```
   ⚠️ Guarde `VAULT_MASTER_KEYS` fora do servidor também (gerenciador de senhas). Sem ela as credenciais do banco ficam indecifráveis.
5. **Subir**:
   ```bash
   cd /opt/content-pilot
   docker compose -f docker-compose.prod.yml up -d --build
   ```
   O serviço `migrate` roda migrations + seed e termina; `web`, `worker` e `caddy` ficam de pé com `restart: unless-stopped`.
6. Acesse `https://pilot.seudominio.com` e faça login com ADMIN_EMAIL/ADMIN_PASSWORD.
   - **Chaves da plataforma** (IA e busca, usadas por quem não traz chave própria): `/admin/ai/keys`.
   - **Cobrança** (chave secreta e webhook do Stripe): `/admin/settings`.
   - Credenciais do WordPress continuam por site, em Credenciais.

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

## Custos de referência

- VPS 1–2 GB: US$ 4–8/mês · Tavily: cota gratuita de 1000 créditos/mês (busca basic = 1, advanced = 2, extract = 1/URL)
- IA: modo **econômico** só chama o LLM quando a pré-checagem detecta mudança nos códigos; posts sem novidade custam 0 tokens. Acompanhe em Visão geral → "Custo de IA no mês".
