import { configuredApi, setApiConfiguration } from './api-configuration';

describe('native API configuration', () => {
  afterEach(() => setApiConfiguration(null));
  it('accepts an explicitly configured HTTPS endpoint', () => {
    setApiConfiguration('https://api.example.com/api/v1');
    expect(configuredApi()).toBe('https://api.example.com/api/v1');
  });
  it('rejects plaintext, credentials and ambiguous paths', () => {
    for (const value of [
      'http://api.example.com/api/v1',
      'https://u:p@api.example.com/api/v1',
      'https://api.example.com/api/v1?token=x',
      'https://api.example.com/api/v1/',
    ])
      expect(() => setApiConfiguration(value)).toThrow();
    expect(configuredApi()).toBeNull();
  });
});
