'use client';

import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { deletePlatformKeyAction, savePlatformKeyAction } from '@/actions/admin/platform-keys';
import { SecretField } from '@/components/admin/secret-field';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export type ProviderType = 'openai' | 'openrouter' | 'anthropic' | 'tavily';

export function PlatformKeyCard({
  type,
  label,
  description,
  maskedHint,
  updatedAt,
}: {
  type: ProviderType;
  label: string;
  description: string;
  maskedHint: string | null;
  updatedAt: string | null;
}) {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const submittingRef = useRef(false);
  const configured = maskedHint !== null || updatedAt !== null;

  function submit(formData: FormData) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    startTransition(async () => {
      try {
        const result = await savePlatformKeyAction({ type, apiKey: formData.get(type) });
        if (result.ok) {
          toast.success(`Chave ${label} salva no cofre.`);
          setFieldErrors({});
          (document.getElementById(`form-${type}`) as HTMLFormElement | null)?.reset();
        } else {
          setFieldErrors(result.fieldErrors ?? {});
          toast.error(result.error);
        }
      } finally {
        submittingRef.current = false;
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deletePlatformKeyAction({ type });
      if (result.ok) {
        toast.success(`Chave ${label} removida.`);
        setConfirmDelete(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{label}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form id={`form-${type}`} action={submit} className="space-y-4">
          <SecretField
            id={type}
            label="API key"
            source={configured ? 'db' : 'none'}
            maskedHint={maskedHint}
            description={updatedAt ? `Atualizada em ${updatedAt}.` : undefined}
            error={fieldErrors.apiKey?.[0]}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? 'Salvando...' : configured ? 'Substituir chave' : 'Salvar chave'}
            </Button>
            {configured ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remover chave ${label}`}
                disabled={pending}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="size-4" />
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Remover a chave {label}?</AlertDialogTitle>
            <AlertDialogDescription>
              Todo workspace que não tem chave própria depende desta como reserva. Sem ela, as
              execuções que usam {label} passam a falhar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                remove();
              }}
            >
              {pending ? 'Removendo...' : 'Remover'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
