import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ABACATEPAY_API_BASE_URL,
  isAbacatePayCheckoutUrl,
  resolveAbacatePayBaseUrl,
} from './api-base-url';

describe('resolveAbacatePayBaseUrl', () => {
  it('usa a URL real quando a env está ausente ou vazia', () => {
    expect(resolveAbacatePayBaseUrl(undefined)).toBe(DEFAULT_ABACATEPAY_API_BASE_URL);
    expect(resolveAbacatePayBaseUrl('')).toBe(DEFAULT_ABACATEPAY_API_BASE_URL);
    expect(resolveAbacatePayBaseUrl('   ')).toBe(DEFAULT_ABACATEPAY_API_BASE_URL);
  });

  it('aceita https e http apenas em localhost/127.0.0.1, sem barra final', () => {
    expect(resolveAbacatePayBaseUrl('https://api.exemplo.com/v2/')).toBe(
      'https://api.exemplo.com/v2',
    );
    expect(resolveAbacatePayBaseUrl('http://127.0.0.1:4010/v2')).toBe('http://127.0.0.1:4010/v2');
    expect(resolveAbacatePayBaseUrl('http://localhost:4010/v2')).toBe('http://localhost:4010/v2');
  });

  it.each([
    'http://api.abacatepay.com/v2',
    'http://evil.com',
    'http://127.0.0.1.evil.com/v2',
    'ftp://localhost/v2',
    'https://user:pass@api.exemplo.com/v2',
    'https://api.exemplo.com/v2?x=1',
    'not a url',
  ])('recusa %s', (value) => {
    expect(() => resolveAbacatePayBaseUrl(value)).toThrow();
  });
});

describe('isAbacatePayCheckoutUrl', () => {
  const real = DEFAULT_ABACATEPAY_API_BASE_URL;
  const mock = 'http://127.0.0.1:4010/v2';

  it('aceita só https://app.abacatepay.com/pay/… com a API real', () => {
    expect(isAbacatePayCheckoutUrl('https://app.abacatepay.com/pay/bill_abc', real)).toBe(true);
    expect(isAbacatePayCheckoutUrl('http://app.abacatepay.com/pay/bill_abc', real)).toBe(false);
    expect(isAbacatePayCheckoutUrl('https://app.abacatepay.com.evil.dev/pay/x', real)).toBe(false);
    expect(isAbacatePayCheckoutUrl('https://evil.dev/pay/bill_abc', real)).toBe(false);
    expect(isAbacatePayCheckoutUrl('https://app.abacatepay.com/login', real)).toBe(false);
    expect(isAbacatePayCheckoutUrl('https://u:p@app.abacatepay.com/pay/x', real)).toBe(false);
    expect(isAbacatePayCheckoutUrl('https://app.abacatepay.com:8443/pay/x', real)).toBe(false);
    expect(isAbacatePayCheckoutUrl('javascript:alert(1)', real)).toBe(false);
    expect(isAbacatePayCheckoutUrl('/pay/bill_abc', real)).toBe(false);
    expect(isAbacatePayCheckoutUrl(`${mock.replace('/v2', '')}/pay/bill_x`, real)).toBe(false);
  });

  it('com o mock E2E, aceita também a origem do mock', () => {
    expect(isAbacatePayCheckoutUrl('http://127.0.0.1:4010/pay/bill_x', mock)).toBe(true);
    expect(isAbacatePayCheckoutUrl('http://127.0.0.1:4011/pay/bill_x', mock)).toBe(false);
    expect(isAbacatePayCheckoutUrl('https://app.abacatepay.com/pay/bill_x', mock)).toBe(true);
  });
});
