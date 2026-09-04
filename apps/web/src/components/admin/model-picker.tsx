'use client';

import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Check, Eye, Search } from 'lucide-react';
import { setProfileEntryAction } from '@/actions/admin/model-profiles';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface CatalogOption {
  provider: 'anthropic' | 'openai' | 'openrouter';
  modelId: string;
  displayName: string;
  inputPricePerMtok: number | null;
  outputPricePerMtok: number | null;
  supportsVision: boolean;
}

/**
 * Escolha de modelo a partir do catálogo.
 *
 * São 400+ modelos, então filtro por texto e lista rolável — sem biblioteca de
 * combobox, que seria dependência nova para um caso só. Quando a etapa exige
 * visão, os modelos sem visão nem aparecem: o servidor recusa de qualquer
 * forma, e mostrar opção que não pode ser escolhida só gera erro.
 */
export function ModelPicker({
  profileId,
  purpose,
  purposeLabel,
  current,
  options,
  requiresVision,
}: {
  profileId: string;
  purpose: string;
  purposeLabel: string;
  current: { provider: string; modelId: string } | null;
  options: CatalogOption[];
  requiresVision: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pending, startTransition] = useTransition();

  const eligible = useMemo(
    () => (requiresVision ? options.filter((o) => o.supportsVision) : options),
    [options, requiresVision],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? eligible.filter(
          (o) => o.modelId.toLowerCase().includes(q) || o.displayName.toLowerCase().includes(q),
        )
      : eligible;
    return base.slice(0, 200);
  }, [eligible, query]);

  function choose(option: CatalogOption) {
    startTransition(async () => {
      const result = await setProfileEntryAction({
        profileId,
        purpose,
        provider: option.provider,
        modelId: option.modelId,
      });
      if (result.ok) {
        toast.success(`${purposeLabel}: ${option.displayName}`);
        setOpen(false);
        setQuery('');
      } else {
        toast.error(result.error);
      }
    });
  }

  const price = (o: CatalogOption) =>
    o.inputPricePerMtok === null
      ? 'preço desconhecido'
      : `US$ ${o.inputPricePerMtok.toFixed(2)} / ${(o.outputPricePerMtok ?? 0).toFixed(2)} por 1M`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-full justify-start font-mono text-xs">
          <span className="truncate">{current?.modelId ?? 'escolher modelo'}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{purposeLabel}</DialogTitle>
          <DialogDescription>
            {requiresVision
              ? 'Só modelos com visão: esta etapa envia imagem ao modelo.'
              : `${eligible.length} modelos no catálogo.`}
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrar por nome ou id"
            className="pl-8"
          />
        </div>

        <div className="max-h-[60svh] space-y-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              Nenhum modelo encontrado. Sincronize o catálogo se a lista estiver vazia.
            </p>
          ) : (
            filtered.map((o) => {
              const active = current?.modelId === o.modelId && current?.provider === o.provider;
              return (
                <button
                  key={`${o.provider}:${o.modelId}`}
                  type="button"
                  disabled={pending}
                  onClick={() => choose(o)}
                  className="hover:bg-accent flex w-full items-start gap-2 rounded-md px-2 py-2 text-left disabled:opacity-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{o.displayName}</span>
                      {o.supportsVision ? (
                        <Eye className="text-muted-foreground size-3.5 shrink-0" aria-label="tem visão" />
                      ) : null}
                    </div>
                    <div className="text-muted-foreground truncate font-mono text-xs">{o.modelId}</div>
                    <div className="text-muted-foreground text-xs">{price(o)}</div>
                  </div>
                  {active ? <Check className="size-4 shrink-0" /> : null}
                </button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
