'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  CreditCard,
  Globe,
  History,
  KeyRound,
  LayoutDashboard,
  LayoutTemplate,
  PenLine,
  RefreshCw,
  Rocket,
  Settings,
  Sparkles,
} from 'lucide-react';
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

const NAV_CONTENT = [
  { key: 'overview', href: '/', icon: LayoutDashboard },
  { key: 'autopilot', href: '/autopilot', icon: Sparkles, dotClass: 'bg-amber-500' },
  { key: 'updatePosts', href: '/jobs', icon: RefreshCw, dotClass: 'bg-sky-500' },
  { key: 'createPosts', href: '/briefs', icon: PenLine, dotClass: 'bg-violet-500' },
  { key: 'runs', href: '/runs', icon: History },
] as const;

const NAV_CONFIG = [
  { key: 'sites', href: '/sites', icon: Globe },
  { key: 'templates', href: '/templates', icon: LayoutTemplate },
  { key: 'credentials', href: '/credentials', icon: KeyRound },
  { key: 'billing', href: '/billing', icon: CreditCard },
  { key: 'settings', href: '/settings', icon: Settings },
] as const;

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar() {
  const pathname = usePathname();
  const t = useTranslations('nav');
  const tc = useTranslations('common');

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <div className="bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <Rocket className="size-4" />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold">{tc('appName')}</span>
                  <span className="text-muted-foreground truncate text-xs">{tc('tagline')}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t('groupContent')}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_CONTENT.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={isActive(pathname, item.href)} tooltip={t(item.key)}>
                    <Link href={item.href}>
                      <item.icon />
                      <span>{t(item.key)}</span>
                      {'dotClass' in item && item.dotClass ? (
                        <span aria-hidden className={`ml-auto size-1.5 rounded-full ${item.dotClass}`} />
                      ) : null}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>{t('groupSettings')}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_CONFIG.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={isActive(pathname, item.href)} tooltip={t(item.key)}>
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
      </SidebarContent>
      <SidebarFooter />
    </Sidebar>
  );
}
