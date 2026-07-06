'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { createBriefAction } from '@/actions/briefs';
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
import { Textarea } from '@/components/ui/textarea';

interface Option {
  id: string;
  name: string;
}

const LANGUAGES = [
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'es-ES', label: 'Español (España)' },
];

export function CreateBriefDialog({ sites, templates }: { sites: Option[]; templates: Option[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [language, setLanguage] = useState('pt-BR');
  const [publishMode, setPublishMode] = useState<'draft' | 'publish'>('draft');
  const [provider, setProvider] = useState('openrouter');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  const disabled = sites.length === 0 || templates.length === 0;

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await createBriefAction({
        topic: formData.get('topic'),
        siteId,
        templateId,
        language,
        keywords: formData.get('keywords') ?? '',
        targetCategoryWpId: formData.get('categoryId') ?? '',
        extraInstructions: formData.get('extraInstructions') ?? '',
        publishMode,
        provider,
        model: formData.get('model'),
      });
      if (result.ok) {
        toast.success('Pauta criada — geração iniciada.');
        setFieldErrors({});
        setOpen(false);
        router.push(`/runs/${result.data.runId}`);
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
          Nova pauta
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova pauta</DialogTitle>
          <DialogDescription>
            {disabled
              ? 'Cadastre um site e tenha ao menos um template antes de criar pautas.'
              : 'O artigo é escrito com base em fontes reais pesquisadas na web e criado no WordPress.'}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="brief-topic">Tópico / assunto</Label>
            <Input id="brief-topic" name="topic" placeholder='ex.: códigos de "Anime Vanguards"' required />
            {err('topic') ? <p className="text-destructive text-xs">{err('topic')}</p> : null}
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
              <Label>Idioma</Label>
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
            </div>
            <div className="space-y-2">
              <Label htmlFor="brief-category">ID da categoria WP (opcional)</Label>
              <Input id="brief-category" name="categoryId" placeholder="ex.: 5" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="brief-keywords">Palavras-chave (opcional, separadas por vírgula)</Label>
            <Input id="brief-keywords" name="keywords" placeholder="ex.: códigos anime vanguards, resgatar" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="brief-extra">Instruções extras (opcional)</Label>
            <Textarea
              id="brief-extra"
              name="extraInstructions"
              rows={3}
              placeholder="ex.: foque em jogadores iniciantes; mencione a atualização de julho"
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Ao terminar</Label>
              <Select value={publishMode} onValueChange={(v) => setPublishMode(v as 'draft' | 'publish')}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Salvar como rascunho</SelectItem>
                  <SelectItem value="publish">Publicar direto</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
              <Label htmlFor="brief-model">Modelo</Label>
              <Input id="brief-model" name="model" defaultValue="z-ai/glm-5.2" className="font-mono text-sm" required />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || disabled || !siteId || !templateId}>
              {pending ? 'Criando...' : 'Criar e gerar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
