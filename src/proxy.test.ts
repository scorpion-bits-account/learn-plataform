import { describe, expect, it } from 'vitest';

import { config } from './proxy';

/** Converte o padrão simples do matcher (`/x/:path*`, `/x/:slug/y`) em regex para o teste. */
function matches(path: string): boolean {
  return config.matcher.some((m) => {
    if (typeof m !== 'string') return false; // `/` só com ?code= (teste abaixo)
    const re = new RegExp(`^${m.replace(/\/:path\*/g, '(?:/.*)?').replace(/:[a-z]+/g, '[^/]+')}$`);
    return re.test(path);
  });
}

describe('proxy matcher', () => {
  it.each([
    '/inicio',
    '/aprender/astrodash/123',
    '/checkout/astrodash',
    '/admin',
    '/entrar',
    '/cadastro',
    '/cursos/astrodash/acesso',
  ])('roda em %s', (path) => expect(matches(path)).toBe(true));

  it.each(['/', '/cursos', '/cursos/astrodash', '/termos', '/privacidade', '/_next/static/x.js'])(
    'não roda na página pública em cache %s',
    (path) => expect(matches(path)).toBe(false),
  );

  it('roda em / só quando vem ?code= do link de email', () => {
    expect(config.matcher).toContainEqual({ source: '/', has: [{ type: 'query', key: 'code' }] });
  });
});
