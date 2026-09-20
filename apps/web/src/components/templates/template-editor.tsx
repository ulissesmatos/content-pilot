'use client';

import { useMemo, useState, useTransition } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { updateTemplateAction } from '@/actions/templates';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ImagesSettings, TextQualitySettings, type Block } from '@/components/templates/template-quality-tabs';

/**
 * Editor de template. O estado-fonte é o objeto `cfg` (config completo);
 * as abas Geral/Prompts/Buscas/Fontes editam campos estruturados e a aba
 * JSON expõe o config inteiro (extração, bloco gerenciado, validação).
 * A validação de verdade acontece no servidor via zod do core.
 */

interface QueryRow {
  name: string;
  locale: string;
  template: string;
}

interface PromptSet {
  update?: string;
  generate?: string;
  verify?: string;
}

type Cfg = Record<string, unknown> & {
  defaultLanguage?: string;
  prompts?: Record<string, PromptSet>;
  queries?: QueryRow[];
  sources?: Record<string, unknown> & { blocklist?: string[]; trustlist?: string[] };
};

const PROMPT_FIELDS: Array<{ key: keyof PromptSet; label: string; hint: string }> = [
  { key: 'update', label: 'Prompt de atualização', hint: 'Usado pelos jobs de atualização de posts.' },
  { key: 'generate', label: 'Prompt de geração', hint: 'Usado pelas pautas (posts novos). Opcional.' },
  { key: 'verify', label: 'Prompt de verificação', hint: 'Segunda chamada (temp 0) que audita os dados extraídos. Opcional.' },
];

const PROMPT_VARS =
  '{{today}} {{monthYear}} {{prevMonthYear}} {{topic}} {{postTitle}} {{currentHtml}} {{searchContext}} {{siteName}} {{extraInstructions}} {{candidatesJson}}';

export function TemplateEditor({
  id,
  initialName,
  initialDescription,
  initialConfig,
  readOnly,
}: {
  id: string;
  initialName: string;
  initialDescription: string;
  initialConfig: Record<string, unknown>;
  readOnly: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [cfg, setCfg] = useState<Cfg>(initialConfig as Cfg);
  const [jsonDraft, setJsonDraft] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const locales = useMemo(() => Object.keys(cfg.prompts ?? {}), [cfg.prompts]);
  const [locale, setLocale] = useState(locales[0] ?? 'pt-BR');
  const [newLocale, setNewLocale] = useState('');

  const patchCfg = (patch: Partial<Cfg>) => setCfg((prev) => ({ ...prev, ...patch }));

  // Só o campo mudado é gravado no bloco: o que o template não define continua valendo o padrão do worker.
  const patchBlock = (key: Block, patch: Record<string, unknown>) =>
    setCfg((prev) => ({ ...prev, [key]: { ...((prev[key] as object | undefined) ?? {}), ...patch } }));

  const setPrompt = (field: keyof PromptSet, value: string) => {
    setCfg((prev) => {
      const prompts = { ...(prev.prompts ?? {}) };
      prompts[locale] = { ...(prompts[locale] ?? {}), [field]: value };
      return { ...prev, prompts };
    });
  };

  const addLocale = () => {
    const code = newLocale.trim();
    if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(code)) {
      toast.error('Use um código como pt-BR, en-US, es-ES.');
      return;
    }
    setCfg((prev) => {
      const prompts = { ...(prev.prompts ?? {}) };
      if (!prompts[code]) {
        const base = prompts[locale] ?? Object.values(prompts)[0] ?? { update: '' };
        prompts[code] = { ...base };
      }
      return { ...prev, prompts };
    });
    setLocale(code);
    setNewLocale('');
  };

  const removeLocale = (code: string) => {
    setCfg((prev) => {
      const prompts = { ...(prev.prompts ?? {}) };
      delete prompts[code];
      return { ...prev, prompts };
    });
    setLocale((prev) => (prev === code ? Object.keys(cfg.prompts ?? {}).find((l) => l !== code) ?? 'pt-BR' : prev));
  };

  const setQuery = (index: number, patch: Partial<QueryRow>) => {
    setCfg((prev) => {
      const queries = [...(prev.queries ?? [])];
      queries[index] = { ...queries[index]!, ...patch };
      return { ...prev, queries };
    });
  };

  const listToText = (list?: string[]) => (list ?? []).join('\n');
  const textToList = (text: string) =>
    text
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

  const setSourceField = (field: string, value: unknown) => {
    setCfg((prev) => ({ ...prev, sources: { ...(prev.sources ?? {}), [field]: value } }));
  };

  const applyJsonDraft = (raw: string) => {
    setJsonDraft(raw);
    try {
      const parsed = JSON.parse(raw) as Cfg;
      setCfg(parsed);
      setJsonError(null);
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : 'JSON inválido');
    }
  };

  const save = () => {
    startTransition(async () => {
      const result = await updateTemplateAction({
        id,
        name,
        description,
        configJson: JSON.stringify(cfg),
      });
      if (result.ok) {
        toast.success('Template salvo.');
        setJsonDraft(null);
      } else {
        toast.error(result.error);
      }
    });
  };

  const prompts = cfg.prompts?.[locale] ?? {};
  const queries = cfg.queries ?? [];

  return (
    <div className="space-y-4">
      <Tabs defaultValue="geral">
        <TabsList>
          <TabsTrigger value="geral">Geral</TabsTrigger>
          <TabsTrigger value="imagens">Imagens</TabsTrigger>
          <TabsTrigger value="qualidade">Texto e revisão</TabsTrigger>
          <TabsTrigger value="prompts">Prompts</TabsTrigger>
          <TabsTrigger value="buscas">Buscas</TabsTrigger>
          <TabsTrigger value="fontes">Fontes</TabsTrigger>
          <TabsTrigger value="json">JSON avançado</TabsTrigger>
        </TabsList>

        <TabsContent value="geral">
          <Card>
            <CardContent className="space-y-4 pt-2">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="tpl-name">Nome</Label>
                  <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} disabled={readOnly} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tpl-lang">Idioma padrão</Label>
                  <Input
                    id="tpl-lang"
                    value={String(cfg.defaultLanguage ?? 'pt-BR')}
                    onChange={(e) => patchCfg({ defaultLanguage: e.target.value })}
                    disabled={readOnly}
                    className="font-mono"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tpl-desc">Descrição</Label>
                <Textarea
                  id="tpl-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={readOnly}
                  rows={2}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="imagens">
          <ImagesSettings cfg={cfg} patch={patchBlock} readOnly={readOnly} />
        </TabsContent>

        <TabsContent value="qualidade">
          <TextQualitySettings cfg={cfg} patch={patchBlock} readOnly={readOnly} />
        </TabsContent>

        <TabsContent value="prompts">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Prompts por idioma</CardTitle>
                  <CardDescription className="mt-1 max-w-2xl font-mono text-[11px] leading-relaxed">
                    Variáveis: {PROMPT_VARS}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Select value={locale} onValueChange={setLocale}>
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {locales.map((l) => (
                        <SelectItem key={l} value={l}>
                          {l}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!readOnly ? (
                    <>
                      <Input
                        value={newLocale}
                        onChange={(e) => setNewLocale(e.target.value)}
                        placeholder="es-ES"
                        className="w-24 font-mono text-sm"
                      />
                      <Button type="button" variant="outline" size="icon" onClick={addLocale} aria-label="Adicionar idioma">
                        <Plus className="size-4" />
                      </Button>
                      {locales.length > 1 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeLocale(locale)}
                          aria-label={`Remover ${locale}`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {PROMPT_FIELDS.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label>{f.label}</Label>
                  <p className="text-muted-foreground text-xs">{f.hint}</p>
                  <Textarea
                    value={prompts[f.key] ?? ''}
                    onChange={(e) => setPrompt(f.key, e.target.value)}
                    disabled={readOnly}
                    rows={f.key === 'update' ? 16 : 10}
                    className="font-mono text-xs leading-relaxed"
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="buscas">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Queries de busca</CardTitle>
              <CardDescription>
                Uma busca Tavily por linha. O locale formata {'{{monthYear}}'}/{'{{prevMonthYear}}'} da query.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {queries.map((q, i) => (
                <div key={i} className="flex items-start gap-2">
                  <Input
                    value={q.name}
                    onChange={(e) => setQuery(i, { name: e.target.value })}
                    disabled={readOnly}
                    className="w-36 font-mono text-xs"
                    placeholder="nome"
                  />
                  <Input
                    value={q.locale}
                    onChange={(e) => setQuery(i, { locale: e.target.value })}
                    disabled={readOnly}
                    className="w-24 font-mono text-xs"
                    placeholder="pt-BR"
                  />
                  <Textarea
                    value={q.template}
                    onChange={(e) => setQuery(i, { template: e.target.value })}
                    disabled={readOnly}
                    rows={1}
                    className="min-h-9 flex-1 font-mono text-xs"
                  />
                  {!readOnly ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remover query"
                      onClick={() => patchCfg({ queries: queries.filter((_, j) => j !== i) })}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  ) : null}
                </div>
              ))}
              {!readOnly ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    patchCfg({ queries: [...queries, { name: `query-${queries.length + 1}`, locale: 'pt-BR', template: '{{topic}} {{monthYear}}' }] })
                  }
                >
                  <Plus className="size-4" />
                  Adicionar query
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="fontes">
          <Card>
            <CardContent className="grid gap-4 pt-2 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Blocklist (um domínio por linha)</Label>
                <Textarea
                  value={listToText(cfg.sources?.blocklist)}
                  onChange={(e) => setSourceField('blocklist', textToList(e.target.value))}
                  disabled={readOnly}
                  rows={12}
                  className="font-mono text-xs"
                />
                <p className="text-muted-foreground text-xs">Fontes ignoradas (redes sociais, sites de cupom…).</p>
              </div>
              <div className="space-y-2">
                <Label>Trustlist (um domínio por linha)</Label>
                <Textarea
                  value={listToText(cfg.sources?.trustlist)}
                  onChange={(e) => setSourceField('trustlist', textToList(e.target.value))}
                  disabled={readOnly}
                  rows={12}
                  className="font-mono text-xs"
                />
                <p className="text-muted-foreground text-xs">Fontes priorizadas na seleção e no contexto.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="json">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Config completo (JSON)</CardTitle>
              <CardDescription>
                Inclui extração de dados (dataSchema, verbatimLists), bloco gerenciado e limites de validação. Validado
                pelo schema do core ao salvar.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Textarea
                value={jsonDraft ?? JSON.stringify(cfg, null, 2)}
                onChange={(e) => applyJsonDraft(e.target.value)}
                disabled={readOnly}
                rows={24}
                className="font-mono text-xs leading-relaxed"
              />
              {jsonError ? <p className="text-destructive text-xs">JSON inválido: {jsonError}</p> : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {!readOnly ? (
        <div className="flex justify-end">
          <Button onClick={save} disabled={pending || Boolean(jsonError)}>
            <Save className="size-4" />
            {pending ? 'Salvando...' : 'Salvar template'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
