import { z } from 'zod';

/**
 * Configuração NÃO-SECRETA da plataforma, uma chave por área.
 *
 * Fica no core (puro, sem banco) para poder ser testada e para que web e
 * worker validem exatamente a mesma forma. Segredo nenhum passa por aqui:
 * chave de API e webhook secret vivem no vault, na tabela `credentials`.
 *
 * Todo schema precisa ter default para tudo: a linha pode não existir ainda,
 * e uma instalação nova tem que funcionar sem ninguém abrir o painel.
 */

export const SETTINGS_KEYS = {
  stripe: 'stripe',
  email: 'email',
} as const;

export type SettingsKey = (typeof SETTINGS_KEYS)[keyof typeof SETTINGS_KEYS];

export const stripeSettingsSchema = z.object({
  /**
   * Sobrescreve AUTH_URL nas URLs de retorno (checkout, portal). Útil quando
   * o painel roda atrás de um domínio diferente do configurado no .env.
   */
  appBaseUrl: z.string().url().nullable().default(null),
});
export type StripeSettings = z.infer<typeof stripeSettingsSchema>;

export const STRIPE_SETTINGS_DEFAULT: StripeSettings = stripeSettingsSchema.parse({});

export const emailSettingsSchema = z.object({
  /**
   * Remetente dos e-mails transacionais, em `Nome <conta@dominio>` ou só o
   * endereço. O domínio precisa estar verificado no Resend — sem isso a API
   * aceita a chave e recusa o envio.
   */
  fromAddress: z.string().max(200).nullable().default(null),
  /** Para onde vai a resposta do usuário. Nulo = mesma caixa do remetente. */
  replyTo: z.string().max(200).nullable().default(null),
});
export type EmailSettings = z.infer<typeof emailSettingsSchema>;

export const EMAIL_SETTINGS_DEFAULT: EmailSettings = emailSettingsSchema.parse({});
