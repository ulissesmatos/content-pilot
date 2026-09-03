'use client';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type SecretSource = 'db' | 'env' | 'none';

/**
 * Campo de segredo somente-escrita: o valor guardado NUNCA volta ao
 * navegador, só a máscara dos últimos 4 caracteres. Deixar em branco mantém o
 * que já está salvo — é o que permite girar uma chave sem reenviar as outras.
 */
export function SecretField({
  id,
  label,
  description,
  source,
  maskedHint,
  error,
  placeholder,
}: {
  id: string;
  label: string;
  description?: string;
  source: SecretSource;
  maskedHint?: string | null;
  error?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={id}>{label}</Label>
        {source === 'db' ? (
          <Badge variant="secondary">
            Salvo no cofre{maskedHint ? ` · ${maskedHint}` : ''}
          </Badge>
        ) : source === 'env' ? (
          <Badge variant="outline">Vindo do .env</Badge>
        ) : (
          <Badge variant="destructive">Não configurado</Badge>
        )}
      </div>
      <Input
        id={id}
        name={id}
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder ?? (source === 'none' ? 'Cole a chave' : 'Deixe em branco para manter')}
      />
      {description ? <p className="text-muted-foreground text-xs">{description}</p> : null}
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}
