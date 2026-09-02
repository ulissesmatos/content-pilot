import { redirect } from 'next/navigation';
import { AdminSidebar } from '@/components/admin/admin-sidebar';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from '@/components/user-menu';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { requireAdmin } from '@/lib/auth';

/**
 * Gate real do /admin. O middleware também redireciona, mas ele decide pelo
 * JWT — que não revalida e fica velho depois de um rebaixamento. Aqui o cargo
 * vem do banco.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin().catch(() => null);
  if (!session) redirect('/');

  return (
    <SidebarProvider>
      <AdminSidebar isSuperAdmin={session.isSuperAdmin} />
      <SidebarInset>
        <header className="bg-background/80 sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <div className="flex-1" />
          <ThemeToggle />
          <UserMenu email={session.email} />
        </header>
        <main className="min-w-0 flex-1 space-y-6 overflow-x-hidden p-4 sm:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
