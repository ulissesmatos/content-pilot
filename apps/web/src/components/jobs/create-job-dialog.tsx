'use client';

import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { CRON_PRESETS } from '@content-pilot/core';
import { createJobAction } from '@/actions/jobs';
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

interface Option {
  id: string;
  name: string;
}

export function CreateJobDialog({ sites, templates }: { sites: Option[]; templates: Option[] }) {
  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [cronPreset, setCronPreset] = useState<string>(CRON_PRESETS[0].value);
  const [provider, setProvider] = useState('anthropic');
  const [mode, setMode] = useState<'eco' | 'full'>('eco');
  const [searchDepth, setSearchDepth] = useState<'auto' | 'basic' | 'advanced'>('auto');
  const [skipUnchanged, setSkipUnchanged] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  const disabled = sites.length === 0 || templates.length === 0;

  function submit(formData: FormData) {
    startTransition(async () => {
      const customCron = String(formData.get('customCron') ?? '').trim();
      const result = await createJobAction({
        name: formData.get('name'),
        siteId,
        templateId,
        scheduleCron: cronPreset === 'custom' ? customCron : cronPreset,
        timezone: 'America/Sao_Paulo',
        language: String(formData.get('language') ?? '').trim() || undefined,
        tags: formData.get('tags') ?? '',
        categories: formData.get('categories') ?? '',
        provider,
        model: formData.get('model'),
        maxPostsPerRun: formData.get('maxPostsPerRun'),
        tokenBudgetPerRun: formData.get('tokenBudgetPerRun'),
        skipIfSourcesUnchanged: skipUnchanged,
        mode,
        searchDepth,
      });
      if (result.ok) {
        toast.success('Job criado e agendado.');
        setFieldErrors({});
        setOpen(false);
      } else {
        setFieldErrors(result.fieldErrors ?? {});
        toast.error(result.error);
      }
    });
  }

  const err = (field: string) => fieldErrors[field]?.[0];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          Novo job
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo job de atualização</DialogTitle>
          <DialogDescription>
            {disabled
              ? 'Cadastre um site e tenha ao menos um template antes de criar jobs.'
              : 'Atualiza periodicamente os posts do filtro usando o template escolhido.'}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="job-name">Nome</Label>
            <Input id="job-name" name="name" placeholder="ex.: Códigos Roblox 2x/dia" required />
            {err('name') ? <p className="text-destructive text-xs">{err('name')}</p> : null}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Site</Label>
              <Select value={siteId} onValueChange={setSiteId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {sites.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Template</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="job-tags">IDs de tags (WP)</Label>
              <Input id="job-tags" name="tags" placeholder="ex.: 114" />
              <p className="text-muted-foreground text-xs">Separe por vírgula. Vazio = todas.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="job-cats">IDs de categorias (WP)</Label>
              <Input id="job-cats" name="categories" placeholder="ex.: 5, 12" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Agendamento</Label>
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
                <SelectItem value="custom">Cron personalizado…</SelectItem>
              </SelectContent>
            </Select>
            {cronPreset === 'custom' ? (
              <Input name="customCron" placeholder="ex.: 30 6 * * 1-5" className="font-mono" />
            ) : null}
            {err('scheduleCron') ? <p className="text-destructive text-xs">{err('scheduleCron')}</p> : null}
          </div>
          <div className="space-y-2">
            <Label>Modo de execução</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as 'eco' | 'full')}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="eco">Econômico — pré-checagem sem IA; chama o LLM só quando os códigos mudam</SelectItem>
                <SelectItem value="full">Completo — extract avançado + 2 chamadas LLM por post (mais caro/lento)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              No econômico, sem mudança nas fontes o sistema só atualiza a data do widget (zero tokens).
            </p>
          </div>
          <div className="space-y-2">
            <Label>Busca Tavily</Label>
            <Select value={searchDepth} onValueChange={(v) => setSearchDepth(v as 'auto' | 'basic' | 'advanced')}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Automática — basic no econômico, advanced no completo</SelectItem>
                <SelectItem value="basic">Basic — 1 crédito por busca, conteúdo mais raso</SelectItem>
                <SelectItem value="advanced">Advanced — 2 créditos por busca, fontes mais completas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Provedor de IA</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="openrouter">OpenRouter</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="job-model">Modelo</Label>
              <Input id="job-model" name="model" defaultValue="claude-haiku-4-5" className="font-mono text-sm" required />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="job-max">Posts por execução</Label>
              <Input id="job-max" name="maxPostsPerRun" type="number" defaultValue={10} min={1} max={100} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="job-budget">Orçamento (tokens)</Label>
              <Input id="job-budget" name="tokenBudgetPerRun" type="number" defaultValue={500000} step={1000} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="job-lang">Idioma (opcional)</Label>
              <Input id="job-lang" name="language" placeholder="padrão do site" />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Pular se as fontes não mudaram</p>
              <p className="text-muted-foreground text-xs">Evita chamadas de IA quando a web não trouxe nada novo.</p>
            </div>
            <Switch checked={skipUnchanged} onCheckedChange={setSkipUnchanged} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || disabled || !siteId || !templateId}>
              {pending ? 'Criando...' : 'Criar job'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
