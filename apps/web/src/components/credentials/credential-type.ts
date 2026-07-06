export const CREDENTIAL_TYPES = [
  { value: 'wordpress', label: 'WordPress' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'tavily', label: 'Tavily' },
] as const;

export type CredentialType = (typeof CREDENTIAL_TYPES)[number]['value'];

export function credentialTypeLabel(type: string): string {
  return CREDENTIAL_TYPES.find((t) => t.value === type)?.label ?? type;
}
