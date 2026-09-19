'use client';

import { useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { CONTENT_TYPE_LABELS, CONTENT_TYPES, CRON_PRESETS, type ContentType } from '@content-pilot/core/client';
import { createAutopilotAction, updateAutopilotAction } from '@/actions/autopilot';
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

interface Option {
  id: string;
  name: string;
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
          language: String(formData.get('language') ?? '').trim() || 'pt-BR',
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
        <form action={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ap-name">Nome</Label>
            <Input
              id="ap-name"
              name="name"
              placeholder="ex.: Autopilot DeepGames"
              defaultValue={initial?.name}
              required
            />
            {err('name') ? <p className="text-destructive text-xs">{err('name')}</p> : null}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Site</Label>
                <QuickCreateSiteDialog
                  wordpressCredentials={wordpressCredentials}
                  onCreated={(site) => {
                    setExtraSites((prev) => [...prev, site]);
                    setSiteId(site.id);
                  }}
                />
              </div>
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
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Template</Label>
                <QuickCreateTemplateDialog
                  templates={templateOptions}
                  onCreated={(template) => {
                    setExtraTemplates((prev) => [...prev, template]);
                    setTemplateId(template.id);
                  }}
                />
              </div>
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
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ap-seeds">Temas do nicho (um por linha ou separados por vírgula)</Label>
            <Textarea
              id="ap-seeds"
              name="seedTopics"
              rows={3}
              placeholder={'ex.: códigos de Roblox\nnovidades de jogos mobile\natualizações de Fortnite'}
              defaultValue={initial?.seedTopics}
              required
            />
            <p className="text-muted-foreground text-xs">
              Guiam a busca de tendências. Podem ser games ou qualquer assunto de blog.
            </p>
            {err('seedTopics') ? <p className="text-destructive text-xs">{err('seedTopics')}</p> : null}
          </div>

          <div className="space-y-2">
            <Label>Tipos de conteúdo permitidos</Label>
            <div className="flex flex-wrap gap-1">
              {CONTENT_TYPES.map((t) => (
                <Button
                  key={t}
                  type="button"
                  size="sm"
                  variant={allowedTypes.includes(t) ? 'default' : 'outline'}
                  onClick={() => toggleType(t)}
                >
                  {CONTENT_TYPE_LABELS[t]}
                </Button>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">Nenhum selecionado = todos permitidos.</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Frequência</Label>
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
            </div>
            <div className="space-y-2">
              <Label htmlFor="ap-per-cycle">Posts por ciclo</Label>
              <Input
                id="ap-per-cycle"
                name="postsPerCycle"
                type="number"
                defaultValue={initial?.postsPerCycle ?? 3}
                min={1}
                max={20}
              />
            </div>
          </div>


          <input type="hidden" name="discoverTokenBudget" value={60000} />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ap-budget">Orçamento mensal de IA (US$)</Label>
              <Input
                id="ap-budget"
                name="monthlyBudgetUsd"
                type="number"
                step="0.01"
                min={1}
                max={10000}
                defaultValue={initial?.monthlyBudgetUsd ?? 20}
              />
              <p className="text-muted-foreground text-xs">
                Atingido o valor, o autopilot pausa até o mês virar.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ap-max-day">Máx. de pautas por dia</Label>
              <Input
                id="ap-max-day"
                name="maxPostsPerDay"
                type="number"
                min={1}
                max={50}
                defaultValue={initial?.maxPostsPerDay ?? 5}
              />
              <p className="text-muted-foreground text-xs">
                Freio de segurança mesmo se a descoberta encontrar muitos temas.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Gerar automaticamente</p>
              <p className="text-muted-foreground text-xs">
                Ligado: cria e já escreve os posts. Desligado: só sugere pautas para você revisar antes.
              </p>
            </div>
            <Switch checked={autoQueue} onCheckedChange={setAutoQueue} />
          </div>

          {autoQueue ? (
            <div className="space-y-2">
              <Label>Ao gerar</Label>
              <Select value={publishMode} onValueChange={(v) => setPublishMode(v as 'draft' | 'publish')}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Salvar como rascunho no WordPress</SelectItem>
                  <SelectItem value="publish">Publicar direto</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <DialogFooter>
            <Button type="submit" disabled={pending || disabled || !siteId || !templateId}>
              {pending ? 'Salvando...' : isEdit ? 'Salvar alterações' : 'Criar autopilot'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
