import { fetchWithRetry, HttpError } from '../http/fetch-retry';

/**
 * Cliente Resend — envio transacional (recuperação de senha, confirmação).
 *
 * Sem SDK de propósito: a API é um POST só, e o `fetchWithRetry` já dá o
 * timeout e o backoff que o resto do projeto usa. Uma dependência a menos para
 * auditar num caminho que manipula link de troca de senha.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  /** Alternativa em texto: alguns clientes não renderizam HTML, e anti-spam pontua melhor. */
  text: string;
}

export interface ResendConfig {
  apiKey: string;
  /** Endereço remetente. O domínio precisa estar verificado no Resend. */
  from: string;
  replyTo?: string;
}

export class EmailError extends Error {
  constructor(
    message: string,
    /** true quando repetir mais tarde pode funcionar (rede, 5xx, rate limit). */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'EmailError';
  }
}

export class ResendClient {
  constructor(private readonly config: ResendConfig) {}

  async send(message: EmailMessage): Promise<{ id: string }> {
    let res: Response;
    try {
      res = await fetchWithRetry(
        RESEND_ENDPOINT,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.config.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            from: this.config.from,
            to: [message.to],
            subject: message.subject,
            html: message.html,
            text: message.text,
            ...(this.config.replyTo ? { reply_to: this.config.replyTo } : {}),
          }),
        },
        { timeoutMs: 15_000, retries: 3, retryDelayMs: 2_000 },
      );
    } catch (err) {
      if (err instanceof HttpError) {
        // 4xx é configuração errada (domínio não verificado, chave inválida):
        // repetir não resolve, e a mensagem do Resend ajuda o operador no log.
        const retryable = err.status === 408 || err.status === 429 || err.status >= 500;
        throw new EmailError(`Resend recusou o envio (HTTP ${err.status}): ${err.body ?? ''}`.trim(), retryable);
      }
      throw new EmailError(err instanceof Error ? err.message : 'Falha de rede ao enviar e-mail.', true);
    }
    const body = (await res.json().catch(() => null)) as { id?: string } | null;
    if (!body?.id) throw new EmailError('Resend respondeu sem id de mensagem.', true);
    return { id: body.id };
  }
}

/** Valida o remetente aceitando tanto `a@b.com` quanto `Nome <a@b.com>`. */
export function isValidSender(from: string): boolean {
  const address = from.includes('<') ? from.slice(from.indexOf('<') + 1, from.indexOf('>')) : from;
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(address.trim());
}
