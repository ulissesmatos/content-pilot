'use client';

import { useTransition } from 'react';
import { useLocale } from 'next-intl';
import { Languages } from 'lucide-react';
import { setLocaleAction } from '@/actions/locale';
import { LOCALE_LABELS, locales } from '@/i18n/config';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Seletor de idioma do painel (cookie + re-render, sem mudar URL). */
export function LocaleSwitcher() {
  const locale = useLocale();
  const [pending, startTransition] = useTransition();

  return (
    <Select
      value={locale}
      onValueChange={(value) => startTransition(() => setLocaleAction(value))}
      disabled={pending}
    >
      <SelectTrigger className="w-52" aria-label="Idioma / Language">
        <Languages className="size-4 opacity-60" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {locales.map((l) => (
          <SelectItem key={l} value={l}>
            {LOCALE_LABELS[l]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
