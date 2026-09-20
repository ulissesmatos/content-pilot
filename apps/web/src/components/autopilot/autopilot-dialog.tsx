'use client';

import { useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { CONTENT_TYPE_LABELS, CONTENT_TYPES, CRON_PRESETS, type ContentType } from '@content-pilot/core/client';
import { createAutopilotAction, updateAutopilotAction } from '@/actions/autopilot';
import { ChoiceCards, Field, FormSection, MoreOptions, SwitchRow, TemplateChips, stickyFooterClass } from '@/components/form-layout';
import { QuickCreateSiteDialog } from '@/components/sites/quick-create-site-dialog';
import { QuickCreateTemplateDialog } from '@/components/templates/quick-create-template-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { LANGUAGES } from '@/lib/languages';

interface Option {
  id: string;
  name: string;
  /** O que o template faz (revisão, imagens, embeds). */
  summary?: string[];
}

export interface AutopilotInitial {
  id: string;
  name: string;
  siteId: string;
  templateId: string;
  /** Já unidos por quebra de linha para o textarea. */
  seedTopics: string;
  language: string;
  scheduleCron: string;
  autoQueue: boolean;
  publishMode: 'draft' | 'publish';
  postsPerCycle: number;
  allowedTypes: ContentType[];
  monthlyBudgetUsd: number;
  maxPostsPerDay: number;
}

/**
 * Dialog compartilhado de criação/edição de autopilot. Passe `initial` para
 * editar (o mesmo formulário faz create ou update) e `trigger` para o botão.
 */
export function AutopilotDialog({
  sites,
  templates,
  wordpressCredentials,
  trigger,
  initial,
}: {
  sites: Option[];
  templates: Option[];
  wordpressCredentials: Option[];
  trigger: ReactNode;
  initial?: AutopilotInitial;
}) {
  const isEdit = !!initial;
  const [open, setOpen] = useState(false);
  const [extraSites, setExtraSites] = useState<Option[]>([]);
  const [extraTemplates, setExtraTemplates] = useState<Option[]>([]);
  const [siteId, setSiteId] = useState(initial?.siteId ?? '');
  const [templateId, setTemplateId] = useState(initial?.templateId ?? '');
  const [language, setLanguage] = useState(initial?.language ?? 'pt-BR');
  const [cronPreset, setCronPreset] = useState<string>(initial?.scheduleCron ?? CRON_PRESETS[1].value);
  const [allowedTypes, setAllowedTypes] = useState<ContentType[]>(initial?.allowedTypes ?? []);
  const [autoQueue, setAutoQueue] = useState(initial?.autoQueue ?? false);
  const [publishMode, setPublishMode] = useState<'draft' | 'publish'>(initial?.publishMode ?? 'draft');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();
  const submittingRef = useRef(false);

  const siteOptions = useMemo(() => [...sites, ...extraSites], [sites, extraSites]);
  const templateOptions = useMemo(() => [...templates, ...extraTemplates], [templates, extraTemplates]);
  const disabled = siteOptions.length === 0 || templateOptions.length === 0;

  function toggleType(t: ContentType) {
    setAllowedTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  function submit(formData: FormData) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    startTransition(async () => {
      try {
        const payload = {
          name: formData.get('name'),
          siteId,
          templateId,
          seedTopics: formData.get('seedTopics'),
          language,
          scheduleCron: cronPreset,
          timezone: 'America/Sao_Paulo',
          autoQueue,
          publishMode,
          postsPerCycle: formData.get('postsPerCycle'),
          allowedTypes,
          discoverTokenBudget: formData.get('discoverTokenBudget'),
          monthlyBudgetUsd: formData.get('monthlyBudgetUsd'),
          maxPostsPerDay: formData.get('maxPostsPerDay'),
        };
        const result = isEdit
          ? await updateAutopilotAction({ ...payload, id: initial!.id })
          : await createAutopilotAction(payload);
        if (result.ok) {
          toast.success(isEdit ? 'Autopilot atualizado.' : 'Autopilot criado e agendado.');
          setFieldErrors({});
          setOpen(false);
        } else {
          setFieldErrors(result.fieldErrors ?? {});
          toast.error(result.error);
        }
      } finally {
        submittingRef.current = false;
      }
    });
  }

  const err = (field: string) => fieldErrors[field]?.[0];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar autopilot' : 'Novo autopilot'}</DialogTitle>
          <DialogDescription>
            {disabled
              ? 'Cadastre um site e tenha ao menos um template antes de criar um autopilot.'
              : 'O sistema descobre temas em alta no nicho, evita repetir o que já existe e cria pautas sozinho.'}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="space-y-6">
          <FormSection title="Identificação">
            <Field label="Nome" htmlFor="ap-name" error={err('name')}>
              <Input id="ap-name" name="name" placeholder="ex.: Autopilot DeepGames" defaultValue={initial?.name} required />
            </Field>
          </FormSection>

          <FormSection title="Onde publicar">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Site"
                action={
                  <QuickCreateSiteDialog
                    wordpressCredentials={wordpressCredentials}
                    onCreated={(site) => {
                      setExtraSites((prev) => [...prev, site]);
                      setSiteId(site.id);
                    }}
                  />
                }
              >
                <Select value={siteId} onValueChange={setSiteId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {siteOptions.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field
                label="Template"
                action={
                  <QuickCreateTemplateDialog
                    templates={templateOptions}
                    onCreated={(template) => {
                      setExtraTemplates((prev) => [...prev, template]);
                      setTemplateId(template.id);
                    }}
                  />
                }
              >
                <Select value={templateId} onValueChange={setTemplateId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {templateOptions.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <TemplateChips chips={templateOptions.find((t) => t.id === templateId)?.summary} />
            <Field label="Idioma dos artigos" hint="Descoberta e geração saem inteiramente nesse idioma.">
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => (
                    <SelectItem key={l.value} value={l.value}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FormSection>

          <FormSection
            title="O que descobrir"
            description="O autopilot procura temas em alta nesses assuntos e evita repetir o que o site já tem."
          >
            <Field
              label="Temas do nicho"
              htmlFor="ap-seeds"
              hint="Um por linha ou separados por vírgula. Podem ser games ou qualquer assunto de blog."
              error={err('seedTopics')}
            >
              <Textarea
                id="ap-seeds"
                name="seedTopics"
                rows={3}
                placeholder={'ex.: códigos de Roblox\nnovidades de jogos mobile\natualizações de Fortnite'}
                defaultValue={initial?.seedTopics}
                required
              />
            </Field>
            <Field label="Tipos de conteúdo permitidos" hint="Nenhum selecionado = todos permitidos.">
              <div className="flex flex-wrap gap-1">
                {CONTENT_TYPES.map((t) => (
                  <Button
                    key={t}
                    type="button"
                    size="sm"
                    variant={allowedTypes.includes(t) ? 'default' : 'outline'}
                    aria-pressed={allowedTypes.includes(t)}
                    onClick={() => toggleType(t)}
                  >
                    {CONTENT_TYPE_LABELS[t]}
                  </Button>
                ))}
              </div>
            </Field>
          </FormSection>

          <FormSection title="Quando e quanto">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Frequência">
                <Select value={cronPreset} onValueChange={setCronPreset}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CRON_PRESETS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                    {initial && !CRON_PRESETS.some((p) => p.value === initial.scheduleCron) ? (
                      <SelectItem value={initial.scheduleCron}>Personalizado ({initial.scheduleCron})</SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Posts por ciclo" htmlFor="ap-per-cycle" hint="Quantos temas viram pauta a cada rodada.">
                <Input
                  id="ap-per-cycle"
                  name="postsPerCycle"
                  type="number"
                  defaultValue={initial?.postsPerCycle ?? 3}
                  min={1}
                  max={20}
                />
              </Field>
            </div>
          </FormSection>

          <FormSection title="Ao encontrar temas">
            <SwitchRow
              label="Gerar os artigos automaticamente"
              description="Ligado: escreve os posts sozinho. Desligado: só sugere pautas para você revisar antes de gerar."
              checked={autoQueue}
              onCheckedChange={setAutoQueue}
            />
            {autoQueue ? (
              <ChoiceCards
                label="Ao gerar"
                value={publishMode}
                onChange={setPublishMode}
                options={[
                  {
                    value: 'draft',
                    label: 'Salvar como rascunho',
                    description: 'Você revisa cada artigo no sistema e publica com um clique. Recomendado.',
                  },
                  {
                    value: 'publish',
                    label: 'Publicar direto',
                    description: 'Vai ao ar assim que terminar. Sem capa, o post continua como rascunho.',
                  },
                ]}
              />
            ) : null}
          </FormSection>

          <MoreOptions label="Limites de segurança: orçamento e pautas por dia">
            <input type="hidden" name="discoverTokenBudget" value={60000} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Orçamento mensal de IA (US$)"
                htmlFor="ap-budget"
                hint="Atingido o valor, o autopilot pausa até o mês virar."
                error={err('monthlyBudgetUsd')}
              >
                <Input
                  id="ap-budget"
                  name="monthlyBudgetUsd"
                  type="number"
                  step="0.01"
                  min={1}
                  max={10000}
                  defaultValue={initial?.monthlyBudgetUsd ?? 20}
                />
              </Field>
              <Field
                label="Máx. de pautas por dia"
                htmlFor="ap-max-day"
                hint="Freio de segurança mesmo se a descoberta achar muitos temas."
                error={err('maxPostsPerDay')}
              >
                <Input
                  id="ap-max-day"
                  name="maxPostsPerDay"
                  type="number"
                  min={1}
                  max={50}
                  defaultValue={initial?.maxPostsPerDay ?? 5}
                />
              </Field>
            </div>
          </MoreOptions>

          <DialogFooter className={stickyFooterClass}>
            <Button type="submit" disabled={pending || disabled || !siteId || !templateId}>
              {pending ? 'Salvando...' : isEdit ? 'Salvar alterações' : 'Criar autopilot'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
