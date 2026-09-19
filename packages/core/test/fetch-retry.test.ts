import { describe, expect, it, vi } from 'vitest';
import { fetchWithRetry, HttpError } from '../src/http/fetch-retry';

const res = (status: number) => new Response(status === 200 ? 'ok' : 'erro', { status });

/**
 * Este módulo é a base de TODOS os clientes HTTP do projeto (Tavily,
 * WordPress, LLM, Resend). Um retry indevido aqui vira latência e consumo de
 * cota em todos eles ao mesmo tempo.
 */
describe('fetchWithRetry', () => {
  const noDelay = { retryDelayMs: 0 };

  it('devolve a resposta na primeira tentativa bem-sucedida', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(200));
    const out = await fetchWithRetry('https://x', {}, { ...noDelay, fetchImpl });
    expect(out.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('4xx definitivo não repete — chave inválida não vira três pedidos', async () => {
    for (const status of [400, 401, 403, 404, 422]) {
      const fetchImpl = vi.fn().mockResolvedValue(res(status));
      await expect(fetchWithRetry('https://x', {}, { ...noDelay, fetchImpl })).rejects.toBeInstanceOf(HttpError);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it('5xx repete até o limite e propaga o último erro', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(503));
    await expect(
      fetchWithRetry('https://x', {}, { ...noDelay, retries: 3, fetchImpl }),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('408 e 429 são exceções retentáveis entre os 4xx', async () => {
    for (const status of [408, 429]) {
      const fetchImpl = vi.fn().mockResolvedValue(res(status));
      await expect(fetchWithRetry('https://x', {}, { ...noDelay, retries: 2, fetchImpl })).rejects.toBeInstanceOf(
        HttpError,
      );
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    }
  });

  it('erro de rede repete e o sucesso seguinte vale', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(res(200));
    const out = await fetchWithRetry('https://x', {}, { ...noDelay, fetchImpl });
    expect(out.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('5xx seguido de sucesso não propaga erro', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(res(500)).mockResolvedValueOnce(res(200));
    const out = await fetchWithRetry('https://x', {}, { ...noDelay, fetchImpl });
    expect(out.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('o corpo do erro chega junto para o log do operador', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('domain not verified', { status: 403 }));
    await expect(fetchWithRetry('https://x', {}, { ...noDelay, fetchImpl })).rejects.toMatchObject({
      status: 403,
      body: 'domain not verified',
    });
  });
});
