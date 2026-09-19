import type { EmailMessage } from './resend';

/**
 * Corpo dos e-mails transacionais.
 *
 * A cópia vive aqui, e não nos messages do next-intl, porque o core não
 * enxerga o painel — e porque e-mail precisa ser testável sem subir o Next.
 * HTML deliberadamente simples e com estilo inline: cliente de e-mail ignora
 * folha de estilo externa e boa parte do CSS moderno.
 */

export type EmailLocale = 'pt-BR' | 'en';

/** Escapa o que vai para dentro do HTML — nome e e-mail vêm do usuário. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface Copy {
  subject: string;
  heading: string;
  intro: string;
  button: string;
  expiry: string;
  fallback: string;
  ignore: string;
}

function layout(copy: Copy, url: string, appName: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f4f4f5;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#18181b">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
    <p style="margin:0 0 24px;font-size:15px;font-weight:600">${esc(appName)}</p>
    <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3">${esc(copy.heading)}</h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#3f3f46">${esc(copy.intro)}</p>
    <a href="${esc(url)}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:15px;font-weight:500">${esc(copy.button)}</a>
    <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#71717a">${esc(copy.expiry)}</p>
    <p style="margin:12px 0 0;font-size:13px;line-height:1.5;color:#71717a">${esc(copy.fallback)}<br><span style="word-break:break-all;color:#3f3f46">${esc(url)}</span></p>
    <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e4e4e7;font-size:13px;line-height:1.5;color:#71717a">${esc(copy.ignore)}</p>
  </div>
</body></html>`;
}

function plain(copy: Copy, url: string, appName: string): string {
  return [appName, '', copy.heading, '', copy.intro, '', url, '', copy.expiry, '', copy.ignore].join('\n');
}

const PASSWORD_RESET: Record<EmailLocale, Copy> = {
  'pt-BR': {
    subject: 'Redefinir sua senha',
    heading: 'Redefinir sua senha',
    intro: 'Recebemos um pedido para trocar a senha da sua conta. Clique no botão abaixo para escolher uma nova.',
    button: 'Escolher nova senha',
    expiry: 'O link vale por 1 hora e só pode ser usado uma vez.',
    fallback: 'Se o botão não funcionar, copie este endereço para o navegador:',
    ignore: 'Se não foi você quem pediu, ignore este e-mail — sua senha continua a mesma.',
  },
  en: {
    subject: 'Reset your password',
    heading: 'Reset your password',
    intro: 'We received a request to change your account password. Use the button below to pick a new one.',
    button: 'Choose a new password',
    expiry: 'This link is valid for 1 hour and can only be used once.',
    fallback: 'If the button does not work, copy this address into your browser:',
    ignore: 'If you did not request this, ignore this email — your password stays the same.',
  },
};

const EMAIL_VERIFY: Record<EmailLocale, Copy> = {
  'pt-BR': {
    subject: 'Confirme seu e-mail',
    heading: 'Confirme seu e-mail',
    intro: 'Sua conta já está ativa. Confirmar o e-mail garante que você consiga recuperar o acesso caso esqueça a senha.',
    button: 'Confirmar e-mail',
    expiry: 'O link vale por 24 horas.',
    fallback: 'Se o botão não funcionar, copie este endereço para o navegador:',
    ignore: 'Se não foi você quem criou esta conta, ignore este e-mail.',
  },
  en: {
    subject: 'Confirm your email',
    heading: 'Confirm your email',
    intro: 'Your account is already active. Confirming your email makes sure you can recover access if you forget your password.',
    button: 'Confirm email',
    expiry: 'This link is valid for 24 hours.',
    fallback: 'If the button does not work, copy this address into your browser:',
    ignore: 'If you did not create this account, ignore this email.',
  },
};

function build(copy: Copy, to: string, url: string, appName: string): EmailMessage {
  return { to, subject: copy.subject, html: layout(copy, url, appName), text: plain(copy, url, appName) };
}

export function passwordResetEmail(opts: {
  to: string;
  url: string;
  locale: EmailLocale;
  appName: string;
}): EmailMessage {
  return build(PASSWORD_RESET[opts.locale] ?? PASSWORD_RESET['pt-BR'], opts.to, opts.url, opts.appName);
}

export function emailVerificationEmail(opts: {
  to: string;
  url: string;
  locale: EmailLocale;
  appName: string;
}): EmailMessage {
  return build(EMAIL_VERIFY[opts.locale] ?? EMAIL_VERIFY['pt-BR'], opts.to, opts.url, opts.appName);
}
