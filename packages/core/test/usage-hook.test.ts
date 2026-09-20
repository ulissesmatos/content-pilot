import { describe, expect, it } from 'vitest';
import { trackUsage } from '../src/http/usage-hook';

/**
 * O "último uso" de uma credencial só vale se for gravado quando o provedor aceitou uma chamada.
 * O helper embrulha o cliente uma vez e dispara o aviso por método que terminou bem.
 */

class Client {
  readonly name = 'cliente';
  #secret = 42; // campo privado: quebraria com um Proxy que trocasse o `this`
  calls = 0;

  async ok(x: number) {
    this.calls++;
    return x * 2;
  }
  async fails(): Promise<number> {
    throw new Error('HTTP 401');
  }
  sync(x: number) {
    return x + 1;
  }
  async soft(): Promise<{ results: string[]; error?: string }> {
    return { results: [], error: 'chave inválida' };
  }
  secret() {
    return this.#secret;
  }
}

describe('trackUsage', () => {
  it('chamada que deu certo conta como uso, e o resultado passa intacto', async () => {
    let used = 0;
    const c = trackUsage(new Client(), () => used++);
    expect(await c.ok(21)).toBe(42);
    expect(used).toBe(1);
  });

  it('chamada que lança NÃO conta, e o erro chega ao chamador', async () => {
    let used = 0;
    const c = trackUsage(new Client(), () => used++);
    await expect(c.fails()).rejects.toThrow('HTTP 401');
    expect(used).toBe(0);
  });

  it('método síncrono também conta', () => {
    let used = 0;
    const c = trackUsage(new Client(), () => used++);
    expect(c.sync(1)).toBe(2);
    expect(used).toBe(1);
  });

  it('o chamador decide o que é sucesso: um { error } sem exceção não conta', async () => {
    let used = 0;
    const c = trackUsage(new Client(), () => used++, { ok: (r) => !(r as { error?: string }).error });
    await c.soft();
    expect(used).toBe(0);
    await c.ok(1); // devolve número: (5 as {error}).error é undefined → conta
    expect(used).toBe(1);
  });

  it('campos, campo privado e o estado do cliente continuam funcionando', async () => {
    const inner = new Client();
    const c = trackUsage(inner, () => {});
    expect(c.name).toBe('cliente');
    expect(c.secret()).toBe(42);
    await c.ok(1);
    expect(inner.calls).toBe(1);
    expect(c instanceof Client).toBe(true);
  });

  it('propriedade opcional que o cliente não tem continua ausente (o chamador testa `if (client.searchImages)`)', () => {
    const c = trackUsage({ search: async () => 1 } as { search: () => Promise<number>; searchImages?: () => Promise<number> }, () => {});
    expect(c.searchImages).toBeUndefined();
  });

  it('aviso que lança nunca derruba a chamada que deu certo', async () => {
    const c = trackUsage(new Client(), () => {
      throw new Error('banco fora do ar');
    });
    await expect(c.ok(2)).resolves.toBe(4);
  });
});
