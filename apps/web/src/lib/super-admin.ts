import 'server-only';

/**
 * O super admin é derivado do ADMIN_EMAIL do .env e NUNCA gravado no banco.
 *
 * Isso é de propósito: como o cargo não existe como linha, nenhuma ação do
 * painel consegue rebaixá-lo, suspendê-lo ou excluí-lo — nem outro admin, nem
 * ele próprio por engano. Admins comuns vivem em `users.role` e são
 * gerenciados pelo painel normalmente.
 */

const normalize = (email: string | null | undefined) => (email ?? '').trim().toLowerCase();

/** E-mail do super admin, ou null se ADMIN_EMAIL não estiver configurado. */
export function superAdminEmail(): string | null {
  return normalize(process.env.ADMIN_EMAIL) || null;
}

export function isSuperAdmin(email: string | null | undefined): boolean {
  const target = normalize(email);
  const su = superAdminEmail();
  return Boolean(su && target && target === su);
}
