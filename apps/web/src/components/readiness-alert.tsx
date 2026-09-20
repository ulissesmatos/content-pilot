import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { ReadinessIssue } from '@/lib/readiness';

/**
 * O que falta para o pipeline conseguir rodar, com o link do conserto.
 *
 * Cada item é acionável de propósito: "faltou credencial" sem dizer onde
 * cadastrar é a mesma frustração do erro que aparecia no meio do run.
 */
export function ReadinessAlert({ issues }: { issues: ReadinessIssue[] }) {
  if (issues.length === 0) return null;
  const blocking = issues.filter((i) => i.blocking).length;
  // Tom diferente porque a consequência é diferente: bloqueado é "não vai
  // rodar", informativo é "rode, mas eu não consegui conferir".
  return (
    <Alert variant="warning">
      <AlertTriangle />
      <AlertTitle>
        {blocking === 0
          ? 'Não foi possível conferir a configuração'
          : blocking === 1
            ? 'A execução está bloqueada por 1 ajuste'
            : `A execução está bloqueada por ${blocking} ajustes`}
      </AlertTitle>
      <AlertDescription>
        <ul className="list-disc space-y-1 pl-4">
          {issues.map((issue, i) => (
            <li key={`${issue.code}-${i}`}>
              {issue.blocking ? null : <span className="text-muted-foreground">(aviso) </span>}
              {issue.message}{' '}
              <Link href={issue.fix.href} className="font-medium underline underline-offset-4">
                {issue.fix.label}
              </Link>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
