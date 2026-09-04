import { redirect } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { AlertTriangle, Sparkles } from 'lucide-react';
import {
  getDb,
  getPriceTable,
  modelCatalog,
  modelProfileEntries,
  modelProfiles,
} from '@content-pilot/db';
import {
  estimatePostCost,
  LLM_PURPOSES,
  PURPOSE_LABEL,
  VISION_PURPOSES,
  type LlmPurpose,
} from '@content-pilot/core';
import { PageHeader } from '@/components/page-header';
import { ModelPicker, type CatalogOption } from '@/components/admin/model-picker';
import { SetDefaultProfileButton } from '@/components/admin/set-default-profile-button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireAdmin } from '@/lib/auth';

export const metadata = { title: 'Perfis de modelo' };

export default async function AdminModelProfilesPage() {
  const session = await requireAdmin();
  if (!session.isSuperAdmin) redirect('/admin');

  const db = getDb();
  const [profiles, entries, catalog, prices] = await Promise.all([
    db.select().from(modelProfiles).orderBy(asc(modelProfiles.slug)),
    db.select().from(modelProfileEntries),
    db
      .select({
        provider: modelCatalog.provider,
        modelId: modelCatalog.modelId,
        displayName: modelCatalog.displayName,
        inputPricePerMtok: modelCatalog.inputPricePerMtok,
        outputPricePerMtok: modelCatalog.outputPricePerMtok,
        supportsVision: modelCatalog.supportsVision,
      })
      .from(modelCatalog)
      .where(eq(modelCatalog.available, true))
      .orderBy(asc(modelCatalog.displayName)),
    getPriceTable(db),
  ]);

  const options: CatalogOption[] = catalog.map((c) => ({
    provider: c.provider,
    modelId: c.modelId,
    displayName: c.displayName,
    inputPricePerMtok: c.inputPricePerMtok === null ? null : Number(c.inputPricePerMtok),
    outputPricePerMtok: c.outputPricePerMtok === null ? null : Number(c.outputPricePerMtok),
    supportsVision: c.supportsVision,
  }));

  const money = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
  });

  return (
    <>
      <PageHeader
        title="Perfis de modelo"
        description="Qual modelo o pipeline usa em cada etapa. O cliente não escolhe e não vê — por isso o custo por post é conhecido."
      />

      {options.length === 0 ? (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertTitle>Catálogo vazio</AlertTitle>
          <AlertDescription>
            <p>Sincronize o catálogo em Modelos disponíveis antes de escolher.</p>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-6">
        {profiles.map((profile) => {
          const mine = entries.filter((e) => e.profileId === profile.id);
          const byPurpose = new Map(mine.map((e) => [e.purpose as LlmPurpose, e]));
          const cost = estimatePostCost(
            Object.fromEntries(mine.map((e) => [e.purpose, e.modelId])),
            prices,
          );

          return (
            <Card key={profile.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      {profile.name}
                      <code className="text-muted-foreground text-xs">{profile.slug}</code>
                      {profile.isDefault ? <Badge>Padrão</Badge> : null}
                    </CardTitle>
                    <CardDescription>{profile.description}</CardDescription>
                  </div>
                  {!profile.isDefault ? <SetDefaultProfileButton profileId={profile.id} /> : null}
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {LLM_PURPOSES.map((purpose) => {
                    const entry = byPurpose.get(purpose);
                    return (
                      <div key={purpose} className="min-w-0 space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium">{PURPOSE_LABEL[purpose]}</span>
                          {VISION_PURPOSES.has(purpose) ? (
                            <Badge variant="outline" className="shrink-0">
                              visão
                            </Badge>
                          ) : null}
                        </div>
                        <ModelPicker
                          profileId={profile.id}
                          purpose={purpose}
                          purposeLabel={PURPOSE_LABEL[purpose]}
                          current={entry ? { provider: entry.provider, modelId: entry.modelId } : null}
                          options={options}
                          requiresVision={VISION_PURPOSES.has(purpose)}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Guarda-corpo: é aqui que se vê um modelo que consome mais
                    em IA do que a mensalidade do plano, ANTES de salvar. */}
                <div className="bg-muted/50 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-md p-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">Custo de IA por post: </span>
                    <span className="font-medium tabular-nums">{money.format(cost.totalUsd)}</span>
                  </div>
                  <div className="text-muted-foreground">
                    21 posts/mês: <span className="tabular-nums">{money.format(cost.totalUsd * 21)}</span>
                  </div>
                  <div className="text-muted-foreground">
                    87 posts/mês: <span className="tabular-nums">{money.format(cost.totalUsd * 87)}</span>
                  </div>
                  {cost.unknown.length > 0 ? (
                    <Badge variant="destructive">
                      sem preço: {cost.unknown.join(', ')}
                    </Badge>
                  ) : null}
                </div>
                <p className="text-muted-foreground text-xs">
                  <Sparkles className="mr-1 inline size-3" />
                  Estimativa por tokens médios do pipeline, sem contar a busca (Tavily). O custo real
                  medido aparece em cada execução.
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
