import { AppSidebar } from '@/components/app-sidebar';
import { EmailVerificationNotice } from '@/components/email-verification-notice';
import { RunTrackerProvider } from '@/components/runs/run-tracker';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from '@/components/user-menu';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { redirect } from 'next/navigation';
import { AccountBlockedError, requireSession } from '@/lib/auth';
import { isEmailConfigured } from '@/lib/email';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Sem isto, uma conta bloqueada no meio da sessão recebe uma tela de erro
  // 500 em vez de uma explicação.
  const session = await requireSession().catch((err: unknown) => {
    redirect(err instanceof AccountBlockedError ? '/login?blocked=1' : '/login');
  });

  // Sem envio configurado não há aviso: o botão de reenviar não teria efeito.
  const showVerifyNotice = !session.emailVerified && (await isEmailConfigured());

  return (
    <RunTrackerProvider>
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="bg-background/80 sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <div className="flex-1" />
          <ThemeToggle />
          <UserMenu email={session.email} isAdmin={session.role === 'admin'} />
        </header>
        <main className="min-w-0 flex-1 space-y-6 overflow-x-hidden p-6">
          {showVerifyNotice ? <EmailVerificationNotice email={session.email} /> : null}
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
    </RunTrackerProvider>
  );
}
