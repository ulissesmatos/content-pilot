import 'server-only';
import { and, count, eq, inArray, isNull, or } from 'drizzle-orm';
import {
  credentials,
  getDb,
  getWorkspaceAiSettings,
  modelCatalog,
  resolveTaskModel,
  sites,
  type LlmProviderName,
} from '@content-pilot/db';
import { LLM_PURPOSES, PURPOSE_LABEL, VISION_PURPOSES, type LlmPurpose } from '@content-pilot/core';
import { isSuperAdmin } from '@/lib/super-admin';

/**
 * O que impede este workspace de rodar o pipeline, decidido ANTES de o usuário
 * apertar qualquer botão.
 *
 * LIMITE IMPORTANTE: `model_catalog` é o catálogo da INSTALAÇÃO — ele só tem
 * modelos nativos dos provedores para os quais existe chave da plataforma (ver
 * catalog-sync). Ele não sabe o que a chave BYOK de um cliente enxerga. Por
 * isso a conferência de modelo só vale para provedores que o catálogo cobre;
 * fora disso a resposta é "não sei", e "não sei" nunca bloqueia. Quem confere
 * o modelo de um BYOK é o salvamento em /credentials, que pergunta à própria
 * chave do usuário, e o preflight do worker antes de gastar.
 *
 * Existe porque o worker só descobria isso durante a execução: o run nascia,
 * aparecia como "Executando" e morria com "HTTP 400" ou "nenhuma credencial" —
 * já com crédito de busca gasto e sem dizer o que consertar. Aqui a mesma
 * conclusão sai do banco local, em milissegundos, e vira um aviso com link.
 *
 * Só consulta o banco: `model_catalog` já tem os modelos de cada provedor, e é
 * ele que responde "esse modelo existe nessa conta?" sem chamar ninguém. O
 * preflight do worker continua valendo como última barreira — ele fala com o
 * provedor de verdade e pega o que só a API sabe (chave revogada, modelo
 * removido depois da última sincronização).
 */

export interface ReadinessIssue {
  /** Estável, para testes e para não depender do texto. */
  code:
    | 'no-model-profile'
    | 'missing-credential'
    | 'model-not-in-catalog'
    | 'model-without-vision'
    | 'catalog-empty'
    | 'no-site';
  message: string;
  fix: { label: string; href: string };
  /**
   * Impede a execução. Falso quando o problema é "não consigo verificar" em
   * vez de "está quebrado" — catálogo vazio deixa os modelos sem conferência,
   * mas eles podem estar perfeitamente certos, e travar o produto por uma
   * dúvida nossa seria pior que deixar o worker tentar.
   */
  blocking: boolean;
}

export interface WorkspaceReadiness {
  /** Nenhum problema BLOQUEANTE. Avisos informativos não derrubam isto. */
  ok: boolean;
  issues: ReadinessIssue[];
}

export async function getWorkspaceReadiness(
  workspaceId: string,
  email: string,
): Promise<WorkspaceReadiness> {
  const db = getDb();
  const issues: ReadinessIssue[] = [];

  // Chaves da plataforma só contam para o dono da instalação — a mesma regra
  // que o worker aplica em canUsePlatformKeys. Para todos os outros, é BYOK.
  const owner = isSuperAdmin(email);
  const rows = await db
    .select({ type: credentials.type, workspaceId: credentials.workspaceId })
    .from(credentials)
    .where(
      owner
        ? or(eq(credentials.workspaceId, workspaceId), isNull(credentials.workspaceId))
        : eq(credentials.workspaceId, workspaceId),
    );
  const available = new Set(rows.map((r) => r.type));

  const [[catalogSize], override, [site]] = await Promise.all([
    db.select({ total: count() }).from(modelCatalog).where(eq(modelCatalog.available, true)),
    getWorkspaceAiSettings(db, workspaceId),
    db.select({ id: sites.id }).from(sites).where(eq(sites.workspaceId, workspaceId)).limit(1),
  ]);

  // Catálogo vazio significa "não sei", não "modelo inválido": acusar cada
  // etapa seria ruído. O aviso é um só, e sobre a causa real.
  const catalogKnown = Number(catalogSize?.total ?? 0) > 0;
  if (!catalogKnown) {
    issues.push({
      code: 'catalog-empty',
      message:
        'O catálogo de modelos está vazio, então não dá para conferir os modelos configurados nem escolher outros.',
      fix: { label: 'Sincronizar catálogo', href: '/admin/ai/catalog' },
      blocking: false,
    });
  }

  // Resolve as etapas antes de tocar no catálogo: assim a consulta pede as
  // 5 linhas em uso, e não as 400+ disponíveis, a cada render da página.
  const resolved = new Map<LlmPurpose, { provider: LlmProviderName; model: string }>();
  for (const purpose of LLM_PURPOSES) {
    try {
      const task = await resolveTaskModel(db, workspaceId, purpose as LlmPurpose);
      let provider = task.provider;
      let model = task.model;
      // A escolha do cliente BYOK vence o perfil do admin — mesma ordem do worker.
      if (override?.provider && override.model && available.has(override.provider)) {
        provider = override.provider;
        model = override.model;
      }
      resolved.set(purpose as LlmPurpose, { provider, model });
    } catch {
      issues.push({
        code: 'no-model-profile',
        message: `Nenhum modelo configurado para "${PURPOSE_LABEL[purpose]}".`,
        fix: { label: 'Configurar perfil', href: '/admin/ai/profiles' },
        blocking: true,
      });
    }
  }

  const inUse = [...resolved.values()];
  const providersInUse = [...new Set(inUse.map((r) => r.provider))];

  // Quais provedores o catálogo realmente cobre. Sem isto, um workspace BYOK
  // em OpenAI (sem chave OpenAI da plataforma) receberia "modelo não existe"
  // em todas as etapas — o catálogo simplesmente não tem linha alguma desse
  // provedor para comparar.
  const covered = new Set(
    (
      await db
        .selectDistinct({ provider: modelCatalog.provider })
        .from(modelCatalog)
        .where(and(eq(modelCatalog.available, true), inArray(modelCatalog.provider, providersInUse)))
    ).map((r) => r.provider),
  );

  const catalogRows = inUse.length > 0 && catalogKnown
    ? await db
        .select({
          provider: modelCatalog.provider,
          modelId: modelCatalog.modelId,
          supportsVision: modelCatalog.supportsVision,
        })
        .from(modelCatalog)
        .where(
          and(
            eq(modelCatalog.available, true),
            inArray(modelCatalog.modelId, [...new Set(inUse.map((r) => r.model))]),
          ),
        )
    : [];
  const byKey = new Map(catalogRows.map((c) => [`${c.provider}:${c.modelId}`, c]));

  const seenMissing = new Set<string>();
  for (const [purpose, { provider, model }] of resolved) {
    if (!available.has(provider)) {
      // Uma credencial faltando aparece em todas as etapas; o aviso é um só.
      if (!seenMissing.has(provider)) {
        seenMissing.add(provider);
        issues.push({
          code: 'missing-credential',
          message: `As etapas configuradas usam ${providerLabel(provider)}, mas não há chave desse provedor cadastrada.`,
          fix: { label: 'Cadastrar credencial', href: '/credentials' },
          blocking: true,
        });
      }
      continue;
    }

    // Provedor fora do catálogo = não dá para conferir. Silêncio é melhor que
    // um alarme falso por etapa: quem valida esse caso é o save em
    // /credentials e o preflight do worker.
    if (!catalogKnown || !covered.has(provider)) continue;
    const entry = byKey.get(`${provider}:${model}`);
    if (!entry) {
      issues.push({
        code: 'model-not-in-catalog',
        message: `"${model}" não está disponível na conta ${providerLabel(provider)} — usado em "${PURPOSE_LABEL[purpose]}".`,
        fix: { label: 'Escolher outro modelo', href: '/admin/ai/profiles' },
        blocking: true,
      });
    } else if (VISION_PURPOSES.has(purpose) && !entry.supportsVision) {
      issues.push({
        code: 'model-without-vision',
        message: `"${model}" não aceita imagem e é usado em "${PURPOSE_LABEL[purpose]}" — todo post sairia sem capa.`,
        fix: { label: 'Escolher modelo com visão', href: '/admin/ai/profiles' },
        blocking: true,
      });
    }
  }

  if (!available.has('tavily')) {
    issues.push({
      code: 'missing-credential',
      message: 'A busca de fontes usa o Tavily, e não há chave cadastrada.',
      fix: { label: 'Cadastrar credencial', href: '/credentials' },
      blocking: true,
    });
  }

  if (!site) {
    issues.push({
      code: 'no-site',
      message: 'Nenhum site WordPress conectado — não há para onde publicar.',
      fix: { label: 'Conectar site', href: '/sites' },
      blocking: true,
    });
  }

  return { ok: !issues.some((i) => i.blocking), issues };
}

function providerLabel(provider: LlmProviderName): string {
  return provider === 'openai' ? 'OpenAI' : provider === 'anthropic' ? 'Anthropic' : 'OpenRouter';
}

/**
 * Barra a execução quando a configuração não permite terminar.
 *
 * O botão desabilitado no painel é conforto; isto é o bloqueio. Sem esta
 * checagem no servidor, qualquer chamada direta da action criaria um run que
 * nasce condenado — e gastaria busca antes de morrer.
 */
export async function assertWorkspaceReady(workspaceId: string, email: string): Promise<void> {
  const { ok, issues } = await getWorkspaceReadiness(workspaceId, email);
  if (ok) return;
  const { UserFacingError } = await import('@/lib/errors');
  throw new UserFacingError(
    `Não dá para executar ainda: ${issues.filter((i) => i.blocking).map((i) => i.message).join(' ')}`,
    'workspace.notReady',
  );
}
