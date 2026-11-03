import { describe, expect, it } from 'vitest';

import { whatsappUrl } from './company';

describe('whatsappUrl', () => {
  it('sem mensagem: só o número', () => {
    expect(whatsappUrl()).toBe('https://wa.me/5516996004393');
  });

  it('com mensagem: texto codificado na URL', () => {
    expect(whatsappUrl('Olá! Dúvida sobre o curso A & B.')).toBe(
      'https://wa.me/5516996004393?text=Ol%C3%A1!%20D%C3%BAvida%20sobre%20o%20curso%20A%20%26%20B.',
    );
  });
});
