import { lookup } from 'node:dns';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent } from 'undici';

export function isPublicAddress(address: string): boolean {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}

/** Validate literals as well as DNS names. DNS is checked again at connection time. */
export function publicHttpsUrl(input: string): URL {
  const url = new URL(input);
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      host === 'localhost' || host.endsWith('.localhost') || !host.includes('.') && !isIP(host) ||
      (isIP(host) && !isPublicAddress(host))) {
    throw new Error('Use uma URL HTTPS pública, sem credenciais ou porta personalizada.');
  }
  return url;
}

// The validated DNS answer is the actual address used by the socket: no
// validation-then-fetch DNS race. Reject mixed public/private DNS answers too.
const publicAgent = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
        if (error) return callback(error, '', 4);
        if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
          return callback(new Error('Destino de rede privado ou reservado bloqueado.'), '', 4);
        }
        const family = Number(options.family) || 0;
        const filtered = addresses.filter((a) => !family || a.family === family);
        if (!filtered.length) return callback(new Error('Endereço público indisponível.'), '', 4);
        if (options.all) callback(null, filtered);
        else callback(null, filtered[0]!.address, filtered[0]!.family);
      });
    },
  },
});

/** Untrusted URLs must never follow redirects (including authenticated WP requests). */
export const publicFetch: typeof fetch = async (input, init) => {
  const url = publicHttpsUrl(input instanceof Request ? input.url : String(input));
  return fetch(url, { ...init, redirect: 'error', dispatcher: publicAgent } as unknown as RequestInit);
};
