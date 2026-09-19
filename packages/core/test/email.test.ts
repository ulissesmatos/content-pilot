import { describe, expect, it, vi } from 'vitest';
import { EmailError, isValidSender, ResendClient } from '../src/email/resend';
import { emailVerificationEmail, passwordResetEmail } from '../src/email/templates';

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('isValidSender', () => {
  it('aceita endereço puro e o formato com nome', () => {
    expect(isValidSender('no-reply@exemplo.com')).toBe(true);
    expect(isValidSender('Content Pilot <no-reply@exemplo.com>')).toBe(true);
  });

  it('recusa o que o Resend recusaria depois', () => {
    expect(isValidSender('')).toBe(false);
    expect(isValidSender('sem-arroba')).toBe(false);
    expect(isValidSender('conta@localhost')).toBe(false);
    expect(isValidSender('Nome <>')).toBe(false);
  });
});

describe('ResendClient', () => {
  const message = { to: 'a@b.com', subject: 's', html: '<p>x</p>', text: 'x' };

  it('envia o payload esperado e devolve o id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ id: 'msg_1' }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ResendClient({ apiKey: 're_k', from: 'Pilot <n@b.com>', replyTo: 'r@b.com' });

    expect(await client.send(message)).toEqual({ id: 'msg_1' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toMatchObject({ from: 'Pilot <n@b.com>', to: ['a@b.com'], reply_to: 'r@b.com' });
    vi.unstubAllGlobals();
  });

  it('omite reply_to quando não há', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ id: 'msg_2' }));
    vi.stubGlobal('fetch', fetchMock);
    await new ResendClient({ apiKey: 're_k', from: 'n@b.com' }).send(message);
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1].body))).not.toHaveProperty('reply_to');
    vi.unstubAllGlobals();
  });

  it('4xx é erro definitivo: não repete, não promete retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{"message":"domain not verified"}', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ResendClient({ apiKey: 're_k', from: 'n@b.com' });

    await expect(client.send(message)).rejects.toMatchObject({ name: 'EmailError', retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('resposta sem id não passa por envio bem-sucedido', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({})));
    await expect(new ResendClient({ apiKey: 're_k', from: 'n@b.com' }).send(message)).rejects.toBeInstanceOf(
      EmailError,
    );
    vi.unstubAllGlobals();
  });
});

describe('templates', () => {
  it('o link entra igual no HTML e no texto', () => {
    const url = 'https://app.exemplo.com/reset-password?token=abc-123_XYZ';
    const mail = passwordResetEmail({ to: 'a@b.com', url, locale: 'pt-BR', appName: 'Content Pilot' });
    expect(mail.html).toContain(url);
    expect(mail.text).toContain(url);
    expect(mail.to).toBe('a@b.com');
  });

  it('escapa o que vem de fora — o nome do app não pode injetar HTML', () => {
    const mail = passwordResetEmail({
      to: 'a@b.com',
      url: 'https://x/y',
      locale: 'pt-BR',
      appName: '<script>alert(1)</script>',
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });

  it('cada locale tem assunto próprio e a confirmação difere da troca de senha', () => {
    const pt = passwordResetEmail({ to: 'a@b.com', url: 'https://x', locale: 'pt-BR', appName: 'App' });
    const en = passwordResetEmail({ to: 'a@b.com', url: 'https://x', locale: 'en', appName: 'App' });
    const verify = emailVerificationEmail({ to: 'a@b.com', url: 'https://x', locale: 'pt-BR', appName: 'App' });
    expect(pt.subject).not.toBe(en.subject);
    expect(verify.subject).not.toBe(pt.subject);
  });

  it('locale desconhecido cai no padrão em vez de gerar e-mail vazio', () => {
    const mail = passwordResetEmail({
      to: 'a@b.com',
      url: 'https://x',
      // simula um valor vindo de cookie/header fora da lista
      locale: 'de-DE' as 'pt-BR',
      appName: 'App',
    });
    expect(mail.subject).toBe('Redefinir sua senha');
  });
});
