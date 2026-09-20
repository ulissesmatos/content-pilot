'use client';

import { useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { CRON_PRESETS } from '@content-pilot/core/client';
import { createJobAction, updateJobAction } from '@/actions/jobs';
import { ChoiceCards, Field, FormSection, MoreOptions, SwitchRow, stickyFooterClass } from '@/components/form-layout';
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
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Option {
  id: string;
  name: string;
}

/** Valores iniciais para o modo edição. */
export interface JobFormInitial {
  id: string;
  name: string;
  siteId: string;
  templateId: string;
  scheduleCron: string;
  language: string;
  tags: string;
  categories: string;
  maxPostsPerRun: number;
  tokenBudgetPerRun: number;
  skipIfSourcesUnchanged: boolean;
  mode: 'eco' | 'full';
  searchDepth: 'auto' | 'basic' | 'advanced';
}

const MODE_HINTS: Record<'eco' | 'full', string> = {
  eco: 'Uma pré-checagem sem IA compara as fontes com o que está publicado, e o modelo só é chamado quando os códigos mudam. Sem mudança, só a data do widget é atualizada (zero tokens).',
  full: 'Extração avançada das fontes e 2 chamadas de IA por post (geração e verificação). Mais completo, porém mais caro e lento.',
};

const SEARCH_DEPTH_HINTS: Record<'auto' | 'basic' | 'advanced', string> = {
  auto: 'Usa basic no modo econômico e advanced no completo.',
  basic: '1 crédito por busca — conteúdo mais raso.',
  advanced: '2 créditos por busca — fontes mais completas.',
};

const WEEKDAYS = [
  { value: 0, label: 'Dom' },
  { value: 1, label: 'Seg' },
  { value: 2, label: 'Ter' },
  { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' },
  { value: 6, label: 'Sáb' },
];

function JobDialog({
  sites,
  templates,
  wordpressCredentials,
  initial,
  trigger,
}: {
  sites: Option[];
  templates: Option[];
  wordpressCredentials: Option[];
  initial?: JobFormInitial;
  trigger: ReactNode;
}) {
  const isEdit = !!initial;
  const initialIsPreset = initial ? CRON_PRESETS.some((p) => p.value === initial.scheduleCron) : true;
  const [open, setOpen] = useState(false);
  const [extraSites, setExtraSites] = useState<Option[]>([]);
  const [extraTemplates, setExtraTemplates] = useState<Option[]>([]);
  const [siteId, setSiteId] = useState(initial?.siteId ?? '');
  const [templateId, setTemplateId] = useState(initial?.templateId ?? '');
  const [cronPreset, setCronPreset] = useState<string>(
    initial ? (initialIsPreset ? initial.scheduleCron : 'custom') : CRON_PRESETS[0].value,
  );
  const [customFreq, setCustomFreq] = useState<'daily' | 'weekly'>('daily');
  const [customDays, setCustomDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [customTime, setCustomTime] = useState('07:00');
  const [useRawCron, setUseRawCron] = useState(!!initial && !initialIsPreset);
  const [rawCron, setRawCron] = useState(initial && !initialIsPreset ? initial.scheduleCron : '');
  const [mode, setMode] = useState<'eco' | 'full'>(initial?.mode ?? 'eco');
  const [searchDepth, setSearchDepth] = useState<'auto' | 'basic' | 'advanced'>(initial?.searchDepth ?? 'auto');
  const [skipUnchanged, setSkipUnchanged] = useState(initial?.skipIfSourcesUnchanged ?? true);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();
  const submittingRef = useRef(false);

  const siteOptions = useMemo(() => [...sites, ...extraSites], [sites, extraSites]);
  const templateOptions = useMemo(() => [...templates, ...extraTemplates], [templates, extraTemplates]);
  const disabled = siteOptions.length === 0 || templateOptions.length === 0;

  const composedCron = useMemo(() => {
    const [hh, mm] = customTime.split(':').map((n) => parseInt(n, 10) || 0);
    const days = customFreq === 'daily' || customDays.length === 7 ? '*' : [...customDays].sort().join(',');
    return `${mm} ${hh} * * ${days}`;
  }, [customFreq, customDays, customTime]);

  function toggleDay(day: number) {
    setCustomDays((prev) => {
      if (prev.includes(day)) {
        if (prev.length === 1) return prev;
        return prev.filter((d) => d !== day);
      }
      return [...prev, day].sort();
    });
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
          scheduleCron: cronPreset === 'custom' ? (useRawCron ? rawCron.trim() : composedCron) : cronPreset,
          timezone: 'America/Sao_Paulo',
          language: String(formData.get('language') ?? '').trim() || undefined,
          tags: formData.get('tags') ?? '',
          categories: formData.get('categories') ?? '',
          maxPostsPerRun: formData.get('maxPostsPerRun'),
          tokenBudgetPerRun: formData.get('tokenBudgetPerRun'),
          skipIfSourcesUnchanged: skipUnchanged,
          mode,
          searchDepth,
        };
        const result = isEdit
          ? await updateJobAction({ ...payload, id: initial.id })
          : await createJobAction(payload);
        if (result.ok) {
          toast.success(isEdit ? 'Job atualizado.' : 'Job criado e agendado.');
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
          <DialogTitle>{isEdit ? 'Editar job' : 'Novo job de atualização'}</DialogTitle>
          <DialogDescription>
            {disabled
              ? 'Cadastre um site e tenha ao menos um template antes de criar jobs.'
              : isEdit
                ? 'As mudanças valem a partir do próximo disparo (recalculado se o job estiver ativo).'
                : 'Atualiza periodicamente os posts do filtro usando o template escolhido.'}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="space-y-6">
          <FormSection title="Identificação">
            <Field label="Nome" htmlFor="job-name" error={err('name')}>
              <Input id="job-name" name="name" placeholder="ex.: Códigos Roblox 2x/dia" defaultValue={initial?.name} required />
            </Field>
          </FormSection>

          <FormSection title="O que atualizar" description="Os posts que já estão no site, escolhidos por tag ou categoria.">
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
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="IDs de tags (WP)" htmlFor="job-tags" optional hint="Separe por vírgula. Vazio = todos os posts.">
                <Input id="job-tags" name="tags" placeholder="ex.: 114" defaultValue={initial?.tags} />
              </Field>
              <Field label="IDs de categorias (WP)" htmlFor="job-cats" optional hint="Separe por vírgula.">
                <Input id="job-cats" name="categories" placeholder="ex.: 5, 12" defaultValue={initial?.categories} />
              </Field>
            </div>
          </FormSection>

          <FormSection title="Quando">
            <Field label="Agendamento" error={err('scheduleCron')}>
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
                  <SelectItem value="custom">Personalizado</SelectItem>
                </SelectContent>
              </Select>
            {cronPreset === 'custom' ? (
              <div className="space-y-3 rounded-lg border p-3">
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={customFreq === 'daily' ? 'default' : 'outline'}
                    onClick={() => setCustomFreq('daily')}
                  >
                    Todo dia
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={customFreq === 'weekly' ? 'default' : 'outline'}
                    onClick={() => setCustomFreq('weekly')}
                  >
                    Dias específicos
                  </Button>
                </div>
                {customFreq === 'weekly' ? (
                  <div className="flex flex-wrap gap-1">
                    {WEEKDAYS.map((d) => (
                      <Button
                        key={d.value}
                        type="button"
                        size="sm"
                        variant={customDays.includes(d.value) ? 'default' : 'outline'}
                        className="w-14 px-0"
                        onClick={() => toggleDay(d.value)}
                      >
                        {d.label}
                      </Button>
                    ))}
                  </div>
                ) : null}
                <div className="flex items-center gap-2">
                  <Label htmlFor="cron-time" className="text-muted-foreground text-xs font-normal">
                    Horário
                  </Label>
                  <Input
                    id="cron-time"
                    type="time"
                    value={customTime}
                    onChange={(e) => setCustomTime(e.target.value)}
                    className="w-32"
                  />
                </div>
                {useRawCron ? (
                  <Input
                    value={rawCron}
                    onChange={(e) => setRawCron(e.target.value)}
                    placeholder="ex.: 30 6 * * 1-5"
                    className="font-mono"
                  />
                ) : (
                  <p className="text-muted-foreground font-mono text-xs">{composedCron}</p>
                )}
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
                  onClick={() => setUseRawCron((v) => !v)}
                >
                  {useRawCron ? 'Usar construtor visual' : 'Prefiro digitar o cron manualmente'}
                </button>
              </div>
            ) : null}
            </Field>
          </FormSection>

          <FormSection title="Como atualizar">
            <ChoiceCards
              label="Modo de execução"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'eco', label: 'Econômico', description: MODE_HINTS.eco },
                { value: 'full', label: 'Completo', description: MODE_HINTS.full },
              ]}
            />
            <SwitchRow
              label="Pular se as fontes não mudaram"
              description="Evita chamadas de IA quando a web não trouxe nada novo."
              checked={skipUnchanged}
              onCheckedChange={setSkipUnchanged}
            />
          </FormSection>

          <MoreOptions label="Limites, busca e idioma">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Posts por execução" htmlFor="job-max">
                <Input id="job-max" name="maxPostsPerRun" type="number" defaultValue={initial?.maxPostsPerRun ?? 10} min={1} max={100} />
              </Field>
              <Field label="Orçamento (tokens)" htmlFor="job-budget" hint="Por execução. A execução para quando chega no limite.">
                <Input id="job-budget" name="tokenBudgetPerRun" type="number" defaultValue={initial?.tokenBudgetPerRun ?? 500000} step={1000} />
              </Field>
              <Field label="Busca Tavily" hint={SEARCH_DEPTH_HINTS[searchDepth]}>
                <Select value={searchDepth} onValueChange={(v) => setSearchDepth(v as 'auto' | 'basic' | 'advanced')}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Automática</SelectItem>
                    <SelectItem value="basic">Basic</SelectItem>
                    <SelectItem value="advanced">Advanced</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Idioma" htmlFor="job-lang" optional hint="Vazio = idioma padrão do template.">
                <Input id="job-lang" name="language" placeholder="ex.: pt-BR" defaultValue={initial?.language} />
              </Field>
            </div>
          </MoreOptions>

          <DialogFooter className={stickyFooterClass}>
            <Button type="submit" disabled={pending || disabled || !siteId || !templateId}>
              {pending ? 'Salvando...' : isEdit ? 'Salvar alterações' : 'Criar job'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CreateJobDialog({
  sites,
  templates,
  wordpressCredentials,
}: {
  sites: Option[];
  templates: Option[];
  wordpressCredentials: Option[];
}) {
  return (
    <JobDialog
      sites={sites}
      templates={templates}
      wordpressCredentials={wordpressCredentials}
      trigger={
        <Button>
          <Plus className="size-4" />
          Novo job
        </Button>
      }
    />
  );
}

export function EditJobButton({
  sites,
  templates,
  initial,
}: {
  sites: Option[];
  templates: Option[];
  initial: JobFormInitial;
}) {
  return (
    <JobDialog
      sites={sites}
      templates={templates}
      wordpressCredentials={[]}
      initial={initial}
      trigger={
        <Button variant="ghost" size="icon" aria-label={`Editar ${initial.name}`}>
          <Pencil className="size-4" />
        </Button>
      }
    />
  );
}
