/**
 * Avisa quando um cliente externo (LLM, busca, WordPress, gerador de imagem) foi USADO de verdade.
 *
 * O "último uso" de uma credencial só é confiável se for gravado quando o provedor aceitou uma
 * chamada, e não quando a chave foi carregada da cofre ou testada. Em vez de espalhar essa
 * gravação por cada ponto de chamada, o cliente é embrulhado uma vez e todo método que termina
 * com sucesso dispara `onUse`. Método que lança, ou que o chamador considera falha por `ok`
 * (Tavily devolve `{ results: [], error }` em vez de lançar), não conta.
 */

export interface UsageHookOptions {
  /** O resultado de um método conta como uso? Padrão: qualquer um que não tenha lançado. */
  ok?: (result: unknown) => boolean;
}

export function trackUsage<T extends object>(target: T, onUse: () => void, options: UsageHookOptions = {}): T {
  const used = (result: unknown) => {
    try {
      if (!options.ok || options.ok(result)) onUse();
    } catch {
      // registrar o uso nunca pode derrubar a chamada que acabou de dar certo
    }
    return result;
  };

  return new Proxy(target, {
    get(t, prop) {
      // receiver = alvo: getters e campos privados da classe continuam funcionando
      const value = Reflect.get(t, prop, t);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const result = Reflect.apply(value, t, args);
        return result && typeof (result as PromiseLike<unknown>).then === 'function'
          ? (result as PromiseLike<unknown>).then(used)
          : used(result);
      };
    },
  });
}
