/**
 * Interpolação simples de {{variavel}} em prompts e queries de template.
 * Variável desconhecida vira string vazia (nunca vaza "{{x}}" para o LLM).
 */
export function interpolate(template: string, vars: Record<string, string | number | undefined | null>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) => {
    const v = vars[name];
    return v === undefined || v === null ? '' : String(v);
  });
}
