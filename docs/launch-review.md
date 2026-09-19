# Revisão para lançamento — 19/09/2026

## Parecer

A base do produto é funcional, mas a versão encontrada não estava pronta para cadastro público. Foram corrigidos problemas de isolamento, cadastro administrativo, tentativas de acesso, saída de rede e dependências. A versão revisada é candidata a um beta controlado **depois de migrar o banco e validar o fluxo completo no ambiente de destino**. Não é uma certificação de segurança nem um deploy realizado.

O foco recomendado é colocar o fluxo existente em uso: credenciais → site WordPress → pauta em rascunho → revisão → publicação. Não adicionar mais automações antes de validar esse caminho e a recuperação de dados.

## O que mudou

| Área | Situação encontrada | Alteração |
|---|---|---|
| Separação de contas | Filtros no código, sem segunda barreira nas consultas | Papel PostgreSQL restrito + RLS em todas as consultas de cliente |
| Relacionamentos | IDs podiam apontar para outra conta caso uma validação faltasse | FKs compostas por workspace, templates validados no banco e propriedade imutável |
| Credenciais e templates | Dados globais e privados na mesma tabela | Chaves globais invisíveis ao papel de cliente; templates builtin apenas para leitura |
| Administração | E-mail reservado podia ser registrado antes do seed | Cadastro público recusa `ADMIN_EMAIL`; seed cria workspace próprio para um novo admin |
| Sessões | Status e cargo ficavam em cache por 60 segundos por processo | Revalidação por request; workspace suspenso não executa ações de escrita |
| Worker | IDs de origem e execução consultados separadamente | Verificação de origem/workspace e estado ativo antes das chamadas externas |
| Abuso | Contadores em memória, sem reserva atômica | Contadores no PostgreSQL, por conta/IP/usuário, com limite global de cadastro |
| Saída de rede | WordPress e imagens podiam acessar URLs internas ou redirecionar | HTTPS público, rejeição de IPs privados/reservados, DNS validado na conexão e redirects bloqueados |
| Imagens | Limite conferido depois de baixar tudo | Leitura limitada a 8 MB durante o download; somente formatos raster aceitos |
| Erros | Mensagens internas de banco podiam chegar ao navegador | Mensagens de negócio explícitas; erros inesperados com referência genérica |
| Gratuidade | Plano grátis usava chaves pagas da plataforma e não aceitava chaves próprias | Todos os demais usuários usam BYOK; chaves do sistema exclusivas do proprietário identificado por ADMIN_EMAIL; checkout desligado por padrão |
| Cotas com BYOK | Quem trazia a própria chave continuava limitado a 5 posts e 1M tokens por mês | Cotas de consumo removidas para quem cadastra chave de IA própria; sites e autopilots seguem limitados por consumirem o worker |
| Acesso perdido | Sem recuperação de senha nem confirmação de e-mail | Fluxo completo via Resend, com token de uso único hasheado, link de 1 hora e encerramento das sessões abertas na troca |
| Retry HTTP | 4xx definitivo era repetido 3 vezes por todos os clientes (Tavily, WordPress, LLM) | Decisão de repetir movida para fora do `try`, que engolia o próprio `throw` |
| Dependências | Auditoria inicial apontou 29 alertas em dependências de produção | Atualização de Next.js/Auth.js e dependências relacionadas, seguida de nova auditoria |
| Regressões | Testes existentes não tentavam cruzar contas | Testes com duas contas em PostgreSQL real, verificações de rede e workflow de CI |

Detalhes de migração e implantação: [runbook](runbook.md).

## O que significa gratuito

- O software não cobra dos usuários com `BILLING_ENABLED=false`.
- IA e Tavily podem cobrar pela utilização; todo usuário que não é o proprietário fornece suas chaves. A interface informa isso em Credenciais.
- O plano free mantém 1 site e 1 autopilot. As cotas de 5 posts/mês e 1 milhão de tokens/mês valem apenas para quem NÃO traz chave própria de IA — na prática, só o proprietário, já que os demais são obrigatoriamente BYOK. O administrador do seed tem workspace explicitamente isento.
- As chaves globais de IA e busca são exclusivas do workspace da conta ativa identificada por `ADMIN_EMAIL`. Assinaturas pagas, cargo de admin e isenção de cotas não concedem esse acesso. Todos os planos permitem BYOK. O worker revalida essa identidade antes de resolver uma chave global, inclusive por ID explícito; sem configuração de proprietário, o acesso é negado. Workspaces com mais de uma conta não excluída também não usam chaves globais.
- O modelo/provedor ainda é escolhido pelo administrador. A chave de IA do usuário precisa corresponder ao perfil (OpenRouter na configuração inicial). Escolha de modelos por usuário é uma melhoria futura.

## Hospedagem sem mensalidade

O projeto usa web Next.js, PostgreSQL, pg-boss, scheduler e um worker persistente. A opção com menor mudança de arquitetura é uma VM Linux elegível ao Oracle Always Free rodando o Docker Compose existente. A disponibilidade depende da região/capacidade, e instâncias ociosas podem ser recuperadas pelo provedor; portanto, mantenha backup fora da VM. Consulte as condições atuais, sem considerar créditos temporários como gratuidade permanente: [Oracle Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).

Vercel pode hospedar o painel, mas funções têm duração limitada. **Inferência para esta arquitetura:** Vercel sozinho não substitui o worker persistente e o scheduler existentes; seria necessário outro serviço ou redesenhar o processamento. [Limites de Functions](https://vercel.com/docs/functions/limitations).

Domínio próprio pode ter custo separado. Usar apenas recursos gratuitos da hospedagem não garante custo zero para as APIs de IA/busca.

## Antes de abrir ao público

1. Fazer backup do banco e guardar as chaves do cofre fora do servidor; testar restauração. A migração de isolamento bloqueia relações antigas inconsistentes sem apagar dados automaticamente.
2. Aplicar as migrations e o seed com web/worker antigos parados. Validar `/api/health`: ele também confirma que a conexão consegue ativar RLS.
3. Configurar DNS, HTTPS, segredos fortes, firewall e Caddy como única entrada pública. Não expor PostgreSQL nem a porta interna da web. Não habilitar RLS apenas no papel proprietário: donos de tabelas normalmente contornam as políticas; o cliente usa um papel separado de propósito. [Políticas PostgreSQL](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).
4. Testar no ambiente final: cadastro/login/logout, duas contas, site e credenciais separados, geração de rascunho, revisão/publicação, cancelamento, reinício do worker e recuperação de backup. Chamadas reais aos provedores não foram feitas nesta revisão.
5. Configurar o Resend (chave + domínio verificado) e testar um pedido real em `/forgot-password`. A recuperação de senha e a confirmação de e-mail já existem, mas sem envio configurado o formulário responde normalmente e nenhuma mensagem sai — e a recuperação autônoma volta a não existir.
6. Definir contato de suporte, política de privacidade, retenção, exclusão/exportação de dados e limites de armazenamento. O sistema ainda não oferece esses fluxos completos.
7. Implementar reserva atômica das cotas de posts/tokens para controlar tarefas simultâneas. Os contadores de uso existentes são consultados antes das tarefas, mas tarefas paralelas podem ultrapassar o saldo. Nenhuma conta de terceiros pode recorrer às chaves do sistema, mesmo com plano pago ou isenção.

## Melhorias seguintes, em ordem

1. Rotina de limpeza periódica de `auth_tokens` (hoje a poda é oportunista, no próprio pedido de recuperação).
2. Onboarding que mostre os passos pendentes e teste as chaves exigidas pelo perfil de IA.
3. Reserva de cotas sob concorrência; limites de quantidade para jobs, templates, credenciais e histórico; limpeza periódica dos dados antigos.
4. Exportar/excluir a própria conta e documentar prazos de retenção.
5. Garantias adicionais de idempotência na publicação: falha entre gravar no WordPress e confirmar no banco ainda merece um teste de recuperação específico para evitar duplicação.
6. Monitoramento de falhas do worker, alertas e teste de carga representativo do plano de hospedagem escolhido.

## Limites da proteção

As consultas normais do painel usam uma conexão lógica restrita, inclusive quando esquecem um filtro. Admin, cadastro, autenticação e worker mantêm acesso privilegiado no servidor para executar suas funções. Isso não protege contra vazamento da senha do banco ou execução arbitrária dentro do servidor; esses acessos devem continuar restritos. FKs e guardas também verificam as relações usadas pelo worker.

O rate limit por IP depende do proxy confiável; ele não substitui verificação de e-mail, proteção contra bots ou limites globais de infraestrutura. A restrição de saída exige URL HTTPS canônica: sites locais e instalações que redirecionam para outro hostname precisam ajustar a URL informada.

## Validações

Resultados executados nesta revisão:

| Verificação | Resultado |
|---|---|
| `pnpm typecheck` | Aprovado nos quatro pacotes |
| `pnpm test` | 192 testes aprovados |
| `pnpm test:integration` | 12 testes aprovados em PostgreSQL 17 descartável |
| `pnpm --filter web lint` | Aprovado |
| `pnpm build` | Web e worker compilados; 24 rotas da web geradas |
| `pnpm audit --prod` | Zero alertas conhecidos (antes: 29) |
| `git diff --check` | Sem erros de whitespace |
| Cadastro/login na aplicação em execução | Pendente: a revisão automática de aprovação bloqueou o comando de inicialização local com o retorno `blocked by policy`, sem detalhar a causa |

A suíte de integração verificou duas contas, consultas sem filtro, joins, escrita/exclusão por ID alheio, credenciais globais invisíveis, templates globais somente leitura, acesso a cobrança/admin negado, relações cruzadas rejeitadas pelo banco, preservação de histórico, concorrência, rollback, contexto ausente, rate limit atômico, payload de fila incompatível, chaves globais bloqueadas para free e workspace suspenso.

Não houve chamadas reais a IA, busca ou WordPress, teste de carga, publicação externa nem alteração do banco pessoal. A migração ainda precisa ser aplicada nesse banco. O CI foi adicionado ao repositório, mas não foi executado remotamente nesta revisão. O build mantém um aviso de depreciação da convenção `middleware` em favor de `proxy`; ele não impediu a compilação.

Referências dos avisos que motivaram as atualizações: [Next.js em Windows](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36), [correção Auth.js](https://github.com/nextauthjs/next-auth/security/advisories/GHSA-8fpg-xm3f-6cx3).
