'use client';

import { useRef, useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { cloneTemplateAction } from '@/actions/templates';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface TemplateOption {
  id: string;
  name: string;
}

/**
 * Botão "+" compacto para criar um template sem sair do formulário de job.
 * Clona um template existente (builtin ou próprio) com um novo nome — prompts e
 * schema de extração ficam iguais ao de origem; para customizá-los, edite depois em Templates.
 */
export function QuickCreateTemplateDialog({
  templates,
  onCreated,
}: {
  templates: TemplateOption[];
  onCreated: (template: { id: string; name: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [sourceId, setSourceId] = useState(templates[0]?.id ?? '');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();
  const submittingRef = useRef(false);

  function submit(formData: FormData) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    startTransition(async () => {
      try {
        const name = String(formData.get('name') ?? '').trim();
        const result = await cloneTemplateAction({ id: sourceId, name });
        if (result.ok) {
          toast.success('Template criado — os prompts vieram da origem, edite-os em Templates se quiser customizar.');
          setFieldErrors({});
          setOpen(false);
          onCreated(result.data);
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
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground"
              aria-label="Novo template"
              disabled={templates.length === 0}
            >
              <Plus className="size-3.5" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Novo template</TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo template</DialogTitle>
          <DialogDescription>
            Clona um template existente com um novo nome. Prompts e extração ficam iguais ao de origem —
            customize depois em Templates.
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tpl-name">Nome</Label>
            <Input id="tpl-name" name="name" placeholder="ex.: Códigos Roblox" required />
            {err('name') ? <p className="text-destructive text-xs">{err('name')}</p> : null}
          </div>
          <div className="space-y-2">
            <Label>Baseado em</Label>
            <Select value={sourceId} onValueChange={setSourceId}>
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
          <DialogFooter>
            <Button type="submit" disabled={pending || !sourceId}>
              {pending ? 'Criando...' : 'Criar template'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
