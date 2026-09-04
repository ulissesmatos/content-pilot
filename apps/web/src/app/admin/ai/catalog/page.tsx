import { redirect } from 'next/navigation';
import { and, asc, eq, ilike, sql, type SQL } from 'drizzle-orm';
import { getLocale } from 'next-intl/server';
import { Boxes, Eye, Search } from 'lucide-react';
import { getDb, modelCatalog } from '@content-pilot/db';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { DataList } from '@/components/admin/data-list';
import { Pager } from '@/components/admin/pager';
import { SyncCatalogButton } from '@/components/admin/sync-catalog-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatCard } from '@/components/stat-card';
import { requireAdmin } from '@/lib/auth';

export const metadata = { title: 'Modelos disponíveis' };

const PER_PAGE = 25;

function likeLiteral(term: string) {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export default async function AdminCatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; vision?: string }>;
}) {
  const session = await requireAdmin();
  if (!session.isSuperAdmin) redirect('/admin');

  const [params, locale] = await Promise.all([searchParams, getLocale()]);
  const page = Math.max(1, Number(params.page ?? '1') || 1);
  const q = (params.q ?? '').trim().slice(0, 200);
  const onlyVision = params.vision === '1';
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });

  const filters: SQL[] = [eq(modelCatalog.available, true)];
  if (q) filters.push(ilike(modelCatalog.modelId, likeLiteral(q)));
  if (onlyVision) filters.push(eq(modelCatalog.supportsVision, true));

  const db = getDb();
  const [rows, stats] = await Promise.all([
    db
      .select()
      .from(modelCatalog)
      .where(and(...filters))
      .orderBy(asc(modelCatalog.displayName))
      .limit(PER_PAGE + 1)
      .offset((page - 1) * PER_PAGE),
    db
      .select({
        total: sql<number>`count(*) filter (where available)`,
        comPreco: sql<number>`count(*) filter (where available and input_price_per_mtok is not null)`,
        comVisao: sql<number>`count(*) filter (where available and supports_vision)`,
        ultima: sql<Date | null>`max(fetched_at)`,
      })
      .from(modelCatalog),
  ]);

  const hasNext = rows.length > PER_PAGE;
  const visible = rows.slice(0, PER_PAGE);
  type Row = (typeof visible)[number];
  const s = stats[0];

  const price = (v: string | null) => (v === null ? '—' : `US$ ${Number(v).toFixed(3)}`);

  return (
    <>
      <PageHeader
        title="Modelos disponíveis"
        description="Catálogo sincronizado dos provedores. Alimenta a escolha dos perfis e o preço usado no custo de cada chamada."
      >
        <SyncCatalogButton />
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Modelos" value={String(s?.total ?? 0)} icon={Boxes} />
        <StatCard
          title="Com preço"
          value={String(s?.comPreco ?? 0)}
          hint="Sem preço, o custo da chamada fica desconhecido"
          icon={Boxes}
        />
        <StatCard title="Com visão" value={String(s?.comVisao ?? 0)} hint="Elegíveis para a capa" icon={Eye} />
        <StatCard
          title="Última sincronização"
          value={s?.ultima ? dateFmt.format(new Date(s.ultima)) : 'nunca'}
          hint="Automática às 3h"
          icon={Boxes}
        />
      </div>

      <form method="get" className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input name="q" defaultValue={q} placeholder="Filtrar por id" className="pl-8" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="vision" value="1" defaultChecked={onlyVision} className="size-4" />
          Só com visão
        </label>
        <Button type="submit" variant="outline" size="sm">
          Filtrar
        </Button>
      </form>

      {visible.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="Nenhum modelo no catálogo"
          description="Use Sincronizar agora. O OpenRouter é público; OpenAI e Anthropic exigem chave da plataforma."
        />
      ) : (
        <>
          <DataList<Row>
            rows={visible}
            getKey={(r) => r.id}
            columns={[
              {
                key: 'model',
                header: 'Modelo',
                priority: 'primary',
                cell: (r) => (
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate">{r.displayName}</span>
                      {r.supportsVision ? (
                        <Eye className="text-muted-foreground size-3.5 shrink-0" aria-label="visão" />
                      ) : null}
                    </div>
                    <div className="text-muted-foreground truncate font-mono text-xs">{r.modelId}</div>
                  </div>
                ),
              },
              {
                key: 'price',
                header: 'Entrada / saída (1M)',
                cell: (r) => (
                  <span className="tabular-nums">
                    {price(r.inputPricePerMtok)} / {price(r.outputPricePerMtok)}
                  </span>
                ),
              },
              {
                key: 'source',
                header: 'Origem do preço',
                cell: (r) => (
                  <Badge variant={r.priceSource === 'unknown' ? 'destructive' : 'secondary'}>
                    {r.priceSource}
                  </Badge>
                ),
              },
              {
                key: 'context',
                header: 'Contexto',
                priority: 'meta',
                cell: (r) => (r.contextLength ? `${Math.round(r.contextLength / 1000)}k` : '—'),
              },
              {
                key: 'fetched',
                header: 'Sincronizado',
                priority: 'meta',
                cell: (r) => dateFmt.format(r.fetchedAt),
              },
            ]}
          />
          <Pager
            page={page}
            hasNext={hasNext}
            basePath="/admin/ai/catalog"
            params={{ q: q || undefined, vision: onlyVision ? '1' : undefined }}
          />
        </>
      )}
    </>
  );
}
