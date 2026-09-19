import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPublicAddress, publicFetch, publicHttpsUrl } from '../src/http/public-fetch';

afterEach(() => vi.unstubAllGlobals());

describe('outbound network isolation', () => {
  it.each(['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1',
    '2001:db8::1', '2002:7f00:1::', '64:ff9b::7f00:1'])('blocks special address %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
  it.each(['http://example.com', 'https://localhost', 'https://localhost.evil.test:8080',
    'https://127.1', 'https://2130706433', 'https://0x7f000001', 'https://[::1]',
    'https://[::ffff:127.0.0.1]', 'https://user:pass@example.com', 'file:///etc/passwd',
    'https://metadata.google.internal:80', 'https://localhost.'])('rejects URL %s', (url) => {
    expect(() => publicHttpsUrl(url)).toThrow();
  });
  it('allows public HTTPS and WordPress subdirectories', () => {
    expect(publicHttpsUrl('https://example.com/blog').pathname).toBe('/blog');
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  });
  it('forces redirect rejection and a DNS-checking dispatcher', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await publicFetch('https://example.com', { redirect: 'follow' });
    expect(fetch.mock.calls[0]![1]).toMatchObject({ redirect: 'error', dispatcher: expect.anything() });
    await expect(publicFetch('https://127.0.0.1')).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
