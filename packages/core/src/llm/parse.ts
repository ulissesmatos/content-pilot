/**
 * Parsing de respostas LLM — porta exata do "Code - Parse LLM Response" do n8n:
 * cobre formatos Anthropic (content[]) e OpenAI/OpenRouter (choices[].message),
 * detecta truncamento e extrai o primeiro objeto JSON balanceado como fallback.
 */

function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        const p = part as Record<string, unknown> | null;
        return (p && ((p.text as string) || (p.content as string) || (p.output_text as string))) || '';
      })
      .join('');
  }
  if (content && typeof content === 'object') {
    const c = content as Record<string, unknown>;
    return (c.text as string) || (c.content as string) || JSON.stringify(content);
  }
  return '';
}

export function extractResponseText(response: unknown): string {
  const r = response as Record<string, unknown> | null;
  if (!r) return '';
  if (r.content) return stringifyContent(r.content);
  const choices = r.choices as Array<Record<string, unknown>> | undefined;
  const choice = choices?.[0];
  if (choice?.message) return stringifyContent((choice.message as Record<string, unknown>).content);
  if (choice?.text) return stringifyContent(choice.text);
  if (r.output_text) return stringifyContent(r.output_text);
  if (Array.isArray(r.output)) {
    return (r.output as Array<Record<string, unknown>>)
      .map((item) => stringifyContent(item.content ?? item.text ?? ''))
      .join('');
  }
  return '';
}

export function extractUsage(response: unknown): {
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
} {
  const u = ((response as Record<string, unknown>)?.usage ?? {}) as Record<string, number>;
  return {
    inputTokens: u.input_tokens || u.prompt_tokens || 0,
    outputTokens: u.output_tokens || u.completion_tokens || 0,
    // OpenRouter com usage.include=true devolve o custo real em USD
    costUsd: typeof u.cost === 'number' ? u.cost : null,
  };
}

export function isTruncated(response: unknown): boolean {
  const r = response as Record<string, unknown> | null;
  if (!r) return false;
  if (r.stop_reason === 'max_tokens') return true;
  const choices = r.choices as Array<Record<string, unknown>> | undefined;
  return choices?.[0]?.finish_reason === 'length';
}

/** Parseia JSON; se falhar, varre o primeiro objeto {…} balanceado (com estado de string/escape). */
export function extractJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    // segue para o fallback
  }
  const s = raw
    .replace(/```json\n?/gi, '')
    .replace(/```\n?/gi, '')
    .trim();
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      if (c === '{') depth++;
      if (c === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(s.slice(start, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}
