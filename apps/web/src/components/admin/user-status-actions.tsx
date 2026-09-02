'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Ban, ShieldCheck, ShieldOff } from 'lucide-react';
import { setUserStatusAction } from '@/actions/admin/users';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Status = 'active' | 'suspended' | 'banned';

/**
 * `locked` = super admin ou a própria conta do operador. O botão desabilitado
 * é só cortesia visual; quem barra de verdade é a action no servidor.
 */
export function UserStatusActions({
  id,
  email,
  status,
  locked,
  lockedReason,
}: {
  id: string;
  email: string;
  status: Status;
  locked: boolean;
  lockedReason?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<Status | null>(null);
  const [reason, setReason] = useState('');

  if (locked) {
    return (
      <span className="text-muted-foreground text-xs" title={lockedReason}>
        {lockedReason ?? 'Protegido'}
      </span>
    );
  }

  const run = (next: Status) => {
    startTransition(async () => {
      const res = await setUserStatusAction({ id, status: next, reason: reason || undefined });
      if (res.ok) {
        toast.success(next === 'active' ? 'Conta reativada.' : 'Conta bloqueada.');
        setTarget(null);
        setReason('');
      } else {
        toast.error(res.error);
      }
    });
  };

  const isBlocked = status !== 'active';

  return (
    <>
      {isBlocked ? (
        <Button variant="outline" size="sm" disabled={pending} onClick={() => run('active')}>
          <ShieldCheck className="size-4" />
          Reativar
        </Button>
      ) : (
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => setTarget('suspended')}
          >
            <ShieldOff className="size-4" />
            Suspender
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Banir ${email}`}
            disabled={pending}
            onClick={() => setTarget('banned')}
          >
            <Ban className="size-4" />
          </Button>
        </>
      )}

      <AlertDialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {target === 'banned' ? 'Banir conta' : 'Suspender conta'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {target === 'banned'
                ? `${email} perderá o acesso definitivamente. A conta e o histórico continuam no banco.`
                : `${email} perderá o acesso até ser reativado. O efeito vale já na próxima requisição.`}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Label htmlFor="reason">Motivo (registrado na auditoria)</Label>
            <Input
              id="reason"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: inadimplência, abuso de uso"
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                if (target) run(target);
              }}
            >
              {pending ? 'Aplicando...' : target === 'banned' ? 'Banir' : 'Suspender'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
