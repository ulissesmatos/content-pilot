'use client';

import Link from 'next/link';
import { LogOut, Shield } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { logoutAction } from '@/actions/auth';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function UserMenu({ email, isAdmin = false }: { email: string; isAdmin?: boolean }) {
  const t = useTranslations('auth');
  const tn = useTranslations('nav');
  const initials = email.slice(0, 2).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label={email}>
          <Avatar className="size-8">
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate font-normal">{email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isAdmin ? (
          <DropdownMenuItem asChild>
            <Link href="/admin">
              <Shield className="size-4" />
              {tn('admin')}
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={() => logoutAction()}>
          <LogOut className="size-4" />
          {t('logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
