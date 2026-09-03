'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft, KeyRound, ScrollText, Settings, Shield, ShieldCheck, Users } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';

/**
 * Navegação do painel admin. Separada da AppSidebar de propósito: é outro
 * contexto mental (dados de terceiros, ações irreversíveis) e não deve se
 * misturar com a navegação do cliente.
 */
const NAV_PLATFORM = [
  { key: 'navUsers', href: '/admin/users', icon: Users },
  { key: 'navAudit', href: '/admin/audit', icon: ScrollText },
] as const;

/** Só o super admin: chaves e cobrança movimentam dinheiro da operação. */
const NAV_CONFIG = [
  { key: 'navAiKeys', href: '/admin/ai/keys', icon: KeyRound },
  { key: 'navSettings', href: '/admin/settings', icon: Settings },
] as const;

function isActive(pathname: string, href: string) {
  if (href === '/admin') return pathname === '/admin';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminSidebar({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const pathname = usePathname();
  const t = useTranslations('admin');

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/admin">
                <div className="bg-foreground text-background flex aspect-square size-8 items-center justify-center rounded-lg">
                  {isSuperAdmin ? <ShieldCheck className="size-4" /> : <Shield className="size-4" />}
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold">{t('title')}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {isSuperAdmin ? t('roleSuperAdmin') : t('roleAdmin')}
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t('groupPlatform')}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isActive(pathname, '/admin')}
                  tooltip={t('navOverview')}
                >
                  <Link href="/admin">
                    <Shield />
                    <span>{t('navOverview')}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {NAV_PLATFORM.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(pathname, item.href)}
                    tooltip={t(item.key)}
                  >
                    <Link href={item.href}>
                      <item.icon />
                      <span>{t(item.key)}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {isSuperAdmin ? (
          <SidebarGroup>
            <SidebarGroupLabel>{t('groupConfig')}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV_CONFIG.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive(pathname, item.href)}
                      tooltip={t(item.key)}
                    >
                      <Link href={item.href}>
                        <item.icon />
                        <span>{t(item.key)}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={t('backToApp')}>
              <Link href="/">
                <ArrowLeft />
                <span>{t('backToApp')}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
