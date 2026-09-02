'use client';

import { Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AutopilotDialog, type AutopilotInitial } from './autopilot-dialog';

interface Option {
  id: string;
  name: string;
}

export function CreateAutopilotDialog(props: {
  sites: Option[];
  templates: Option[];
  wordpressCredentials: Option[];
}) {
  return (
    <AutopilotDialog
      {...props}
      trigger={
        <Button>
          <Plus className="size-4" />
          Novo autopilot
        </Button>
      }
    />
  );
}

export function EditAutopilotDialog({
  initial,
  ...props
}: {
  sites: Option[];
  templates: Option[];
  wordpressCredentials: Option[];
  initial: AutopilotInitial;
}) {
  return (
    <AutopilotDialog
      {...props}
      initial={initial}
      trigger={
        <Button variant="outline" size="sm" aria-label={`Editar ${initial.name}`}>
          <Pencil className="size-4" />
          Editar
        </Button>
      }
    />
  );
}
