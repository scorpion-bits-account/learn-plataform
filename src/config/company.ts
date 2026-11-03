/** Dados institucionais (rodapé, termos, comprovantes). Única fonte: não repetir em componentes. */
export const company = {
  brand: 'Scorpion Bits',
  legalName: '60.345.144 THALES MIGUEL HAJES',
  cnpj: '60.345.144/0001-01',
  address: 'Av. Paulino Rodella, 1234 — Parque Laranjeiras — Araraquara/SP — CEP 14801-515',
  email: 'scorpionbits.contato@gmail.com',
  /** WhatsApp comercial (só dígitos, com DDI) e como exibir. */
  whatsapp: '5516996004393',
  whatsappDisplay: '(16) 99600-4393',
} as const;

/** Link `wa.me` com mensagem pronta (o texto vai codificado na URL). */
export function whatsappUrl(message?: string): string {
  const base = `https://wa.me/${company.whatsapp}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

export type Company = typeof company;
