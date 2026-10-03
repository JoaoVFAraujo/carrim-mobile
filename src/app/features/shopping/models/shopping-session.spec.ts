import { parseBudget } from './shopping-session';

describe('Budget input', () => {
  it('converts decimals to exact integer cents', () => {
    expect(parseBudget('200,09')).toBe(20009);
    expect(parseBudget('0,01')).toBe(1);
    expect(parseBudget('12.5')).toBe(1250);
    expect(parseBudget('')).toBeNull();
  });

  it('rejects ambiguous, negative and over-precision inputs', () => {
    for (const input of ['0', '-5', '1,234', '1e3', '1.000,00', 'abc', '1000001']) {
      expect(() => parseBudget(input)).toThrow();
    }
  });
});
