import { sanitizeExternalLinks } from '../html/external-links';
import type { TemplateConfig } from '../templates/schema';

/**
 * Portão fail-safe determinístico — porta exata do "Code - Validate Output"
 * do n8n, generalizado: as listas verbatim vêm do template em vez de
 * activeCodes/expiredCodes fixos. Qualquer erro → não publica.
 */

export interface ValidateOutputInput {
  hasChanges: boolean;
  noDataFound: boolean;
  newTitle: string;
  updatedHtml: string | null;
  data: Record<string, unknown>;
  searchContext: string;
  resultsCount: number;
  /** URLs das fontes da busca — base para a checagem anti-alucinação de links. */
  allowedUrls?: string[];
  /** Domínio do próprio site (links internos são sempre permitidos). */
  siteBaseUrl?: string;
  /**
   * Sanitizar links externos alucinados. Só faz sentido em geração de conteúdo
   * novo — em update, links pré-existentes do post não estão nas fontes de hoje
   * e não podem ser removidos.
   */
  sanitizeLinks?: boolean;
}

export interface DroppedItem {
  list: string;
  value: string;
  reason: string;
}

export interface ValidateOutputResult {
  ok: boolean;
  errors: string[];
  /** data com itens reprovados na checagem verbatim removidos. */
  data: Record<string, unknown>;
  dropped: DroppedItem[];
  /** HTML final (com links externos alucinados removidos, quando aplicável). */
  html: string;
  /** Diagnóstico dos links externos: mantidos + hrefs removidos. */
  externalLinks: { kept: number; stripped: string[] };
}

export function validateOutput(input: ValidateOutputInput, cfg: TemplateConfig): ValidateOutputResult {
  const errs: string[] = [];
  const extraction = cfg.extraction;

  // Sanitização anti-alucinação de links externos (antes das demais checagens,
  // para que tudo valide o HTML que de fato será publicado).
  let html = input.updatedHtml ?? '';
  let externalLinks = { kept: 0, stripped: [] as string[] };
  if (input.sanitizeLinks) {
    const san = sanitizeExternalLinks(html, input.allowedUrls ?? [], { siteBaseUrl: input.siteBaseUrl });
    html = san.html;
    externalLinks = { kept: san.kept, stripped: san.stripped };
  }

  // Sem fontes não dá para atualizar nem afirmar "sem dados"
  // (protege contra falha transitória da busca virar aviso errado no site)
  if (extraction.enabled && input.resultsCount === 0) {
    errs.push('busca web sem resultados — sem base para atualizar o post');
  }

  if (!html || html.length < cfg.validation.htmlMinChars) {
    errs.push(`updatedHtml vazio ou curto demais (${html.length} chars)`);
  }
  if (html.includes('```')) errs.push('updatedHtml contém cerca de código markdown');
  if (html.toUpperCase().includes('[AQUI')) errs.push('updatedHtml contém placeholder');

  const opens = (html.match(/<!-- wp:/g) ?? []).length;
  const closes = (html.match(/<!-- \/wp:/g) ?? []).length;
  if (opens === 0) errs.push('updatedHtml sem blocos Gutenberg');
  if (opens !== closes) errs.push(`blocos Gutenberg desbalanceados (${opens} aberturas, ${closes} fechamentos)`);
  if (/<script\b|<style\b/i.test(html)) errs.push('updatedHtml contém <script>/<style> (proibido — o bloco gerenciado é injetado depois)');
  if (cfg.managedBlock.enabled) {
    const signatures = [cfg.managedBlock.markerPrefix, ...cfg.managedBlock.legacySignatures];
    if (signatures.some((s) => s && html.includes(s))) {
      errs.push('updatedHtml contém o bloco gerenciado (proibido — é injetado pelo sistema)');
    }
  }

  const t = String(input.newTitle ?? '');
  if (t.length < cfg.validation.titleMin || t.length > cfg.validation.titleMax) {
    errs.push(`título com tamanho inválido (${t.length} chars)`);
  }
  if (/[#*`<>]/.test(t)) errs.push('título contém markdown/HTML');

  const data: Record<string, unknown> = { ...input.data };
  const dropped: DroppedItem[] = [];

  if (extraction.enabled && extraction.verbatimLists.length > 0) {
    // Checagem determinística anti-alucinação: todo valor publicado precisa
    // aparecer literalmente no texto das fontes da busca.
    const ctx = String(input.searchContext ?? '').toLowerCase().replace(/\s+/g, '');
    let valueRe: RegExp;
    try {
      valueRe = new RegExp(extraction.valuePattern);
    } catch {
      valueRe = /^[\s\S]{1,200}$/;
    }
    const seen = new Set<string>();
    let totalBefore = 0;
    let totalAfter = 0;

    for (const listCfg of extraction.verbatimLists) {
      const list = Array.isArray(data[listCfg.path]) ? (data[listCfg.path] as Array<Record<string, unknown>>) : [];
      totalBefore += list.length;
      const kept = list.filter((item) => {
        const value = String(item?.[listCfg.valueField] ?? '').trim();
        const key = value.toLowerCase();
        if (!valueRe.test(value)) {
          dropped.push({ list: listCfg.path, value, reason: 'formato inválido' });
          return false;
        }
        if (seen.has(key)) {
          dropped.push({ list: listCfg.path, value, reason: 'duplicado' });
          return false;
        }
        if (!ctx.includes(key)) {
          dropped.push({ list: listCfg.path, value, reason: 'não aparece nas fontes (possível alucinação)' });
          return false;
        }
        seen.add(key);
        return true;
      });
      data[listCfg.path] = kept;
      totalAfter += kept.length;
    }

    if (input.noDataFound && input.resultsCount < extraction.minSourcesForEmptyClaim) {
      errs.push(
        `noDataFound com menos de ${extraction.minSourcesForEmptyClaim} fontes — evidência fraca para publicar aviso de "sem dados"`,
      );
    }
    if (!input.noDataFound && totalBefore > 0 && totalAfter === 0) {
      errs.push('todos os itens candidatos foram reprovados na verificação — não publicar');
    }
    if (!input.noDataFound && totalBefore === 0) {
      errs.push('extração habilitada sem nenhum item e sem noDataFound — resposta inconsistente');
    }
  }

  return { ok: errs.length === 0, errors: errs, data, dropped, html, externalLinks };
}
