'use client';

import { useId, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

/**
 * Peças de formulário compartilhadas pelos diálogos de geração e pelo editor de
 * template: seção com título, campo com dica e erro, escolha em cartões, linha com
 * interruptor e bloco recolhível para o que quase ninguém precisa mudar.
 */

/** Um grupo de campos com título e uma frase do que ele decide. */
export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-3', className)}>
      <div className="space-y-0.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? <p className="text-muted-foreground text-xs">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Rótulo, controle, dica e erro. A dica some quando há erro, para não empilhar texto. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  action,
  optional,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  /** Ação ao lado do rótulo (ex.: "novo site"). */
  action?: ReactNode;
  optional?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={htmlFor}>
          {label}
          {optional ? <span className="text-muted-foreground font-normal"> (opcional)</span> : null}
        </Label>
        {action}
      </div>
      {children}
      {error ? <p className="text-destructive text-xs">{error}</p> : hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

export interface Choice<T extends string> {
  value: T;
  label: string;
  description: string;
}

/** Escolha única em cartões: cada opção diz o que acontece, em vez de só um nome curto. */
export function ChoiceCards<T extends string>({
  value,
  onChange,
  options,
  label,
  disabled,
  columns = 2,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<Choice<T>>;
  /** Nome acessível do grupo. */
  label: string;
  disabled?: boolean;
  columns?: 1 | 2;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('grid gap-2', columns === 2 && 'sm:grid-cols-2')}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-lg border p-3 text-left transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50',
              selected ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
            )}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <span
                aria-hidden
                className={cn(
                  'flex size-3.5 shrink-0 items-center justify-center rounded-full border',
                  selected ? 'border-primary' : 'border-muted-foreground/50',
                )}
              >
                {selected ? <span className="bg-primary size-1.5 rounded-full" /> : null}
              </span>
              {o.label}
            </span>
            <span className="text-muted-foreground mt-1 block pl-[1.375rem] text-xs leading-snug">{o.description}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Linha com título, explicação e interruptor. */
export function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        {description ? <p className="text-muted-foreground text-xs">{description}</p> : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}

/** Bloco recolhido por padrão para o que raramente muda. Nativo (details): funciona sem JS e com teclado. */
export function MoreOptions({
  label,
  children,
  defaultOpen,
  onToggle,
}: {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Avisa quando abre ou fecha (ex.: carregar dados só quando o bloco é aberto). */
  onToggle?: (open: boolean) => void;
}) {
  return (
    <details
      className="group rounded-lg border"
      open={defaultOpen}
      onToggle={onToggle ? (e) => onToggle((e.currentTarget as HTMLDetailsElement).open) : undefined}
    >
      <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-sm select-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden />
        {label}
      </summary>
      <div className="space-y-4 border-t p-3">{children}</div>
    </details>
  );
}

/** Rodapé de diálogo que continua visível enquanto o formulário rola. */
export const stickyFooterClass = 'bg-background sticky -bottom-6 -mx-6 -mb-6 border-t px-6 pt-4 pb-6';

/** Resumo em etiquetas do que um template faz (revisão, imagens, embeds...). */
export function TemplateChips({ chips }: { chips?: string[] }) {
  if (!chips || chips.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1" aria-label="O que este template faz">
      {chips.map((c) => (
        <li key={c} className="bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 text-[11px] leading-none">
          {c}
        </li>
      ))}
    </ul>
  );
}
