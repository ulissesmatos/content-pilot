'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Star } from 'lucide-react';
import { setDefaultProfileAction } from '@/actions/admin/model-profiles';
import { Button } from '@/components/ui/button';

export function SetDefaultProfileButton({ profileId }: { profileId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await setDefaultProfileAction({ profileId });
          if (res.ok) toast.success('Perfil padrão atualizado.');
          else toast.error(res.error);
        })
      }
    >
      <Star className="size-4" />
      {pending ? 'Aplicando...' : 'Tornar padrão'}
    </Button>
  );
}
