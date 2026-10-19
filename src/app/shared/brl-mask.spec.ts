import { Maskito, maskitoTransform } from '@maskito/core';
import { brlMask, attachBrlMask } from './brl-mask';
import { parseBudget, parseCheckoutTotal } from '../features/shopping/models/shopping-session';
import { parseItemPrice } from '../features/shopping/models/shopping-item';

describe('BRL currency fields', () => {
  it('formats digit entry as cents and keeps formatted paste and omission distinct from zero', () => {
    expect(maskitoTransform('500', brlMask)).toBe('R$ 5,00');
    expect(maskitoTransform('20000', brlMask)).toBe('R$ 200,00');
    expect(maskitoTransform('1999', brlMask)).toBe('R$ 19,99');
    expect(maskitoTransform('R$ 500', brlMask)).toBe('R$ 500,00');
    expect(maskitoTransform('1.234', brlMask)).toBe('R$ 1.234,00');
    expect(maskitoTransform('12.5', brlMask)).toBe('R$ 12,50');
    expect(maskitoTransform('12,5', brlMask)).toBe('R$ 12,50');
    expect(maskitoTransform('1234,56', brlMask)).toBe('R$ 1.234,56');
    expect(maskitoTransform('', brlMask)).toBe('');
    expect(parseBudget('R$ ')).toBeNull();
    expect(parseCheckoutTotal('R$ 0,00')).toBe(0);
    expect(parseBudget('R$ 500,00')).toBe(50000);
    expect(parseItemPrice('R$\u00a01.234,56')).toBe(123456);
    expect(parseItemPrice('R$ 1.000.000,00')).toBe(100000000);
  });

  it('preserves domain rejection of negative, malformed and oversized values', () => {
    for (const value of ['R$ -1,00', 'R$ 1.23,45', 'R$ 1,234', 'R$ 1e3', 'R$ 1.000.001,00']) {
      expect(() => parseBudget(value)).toThrow();
      expect(() => parseItemPrice(value)).toThrow();
      expect(() => parseCheckoutTotal(value)).toThrow();
    }
    expect(maskitoTransform('-1', brlMask)).toBe('R$ -0,01');
    expect(() => parseBudget('R$ 0,00')).toThrow();
    expect(() => parseItemPrice('R$ 0,00')).toThrow();
  });

  it('supports typing, selection replacement and exact cents on a native masked field', () => {
    const input = document.createElement('input');
    document.body.append(input);
    const mask = new Maskito(input, brlMask);
    try {
      input.focus();
      const insert = (data: string) => {
        mask.insert(data);
        input.dispatchEvent(
          new InputEvent('input', { bubbles: true, inputType: 'insertText', data }),
        );
      };
      insert('5');
      insert('0');
      insert('0');
      expect(input.value).toBe('R$ 5,00');
      expect(parseBudget(input.value)).toBe(500);
      input.select();
      insert('1.234,56');
      expect(parseItemPrice(input.value)).toBe(123456);
      input.select();
      insert('12345');
      input.setSelectionRange(4, 4);
      insert('9');
      expect(input.value).toBe('R$ 1.923,45');
      expect(input.selectionStart).toBe(6);
      input.select();
      mask.delete([0, input.value.length]);
      input.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }),
      );
      expect(input.value).toBe('');
      expect(parseBudget(input.value)).toBeNull();
    } finally {
      mask.destroy();
      input.remove();
    }
  });

  it('attaches to an alert input and releases its listeners on dismissal', () => {
    const alert = document.createElement('div');
    const input = document.createElement('input');
    input.id = 'checkout';
    input.value = '24,09';
    alert.append(input);
    document.body.append(alert);
    const release = attachBrlMask(alert, 'checkout');
    try {
      expect(input.value).toBe('R$ 24,09');
      expect(parseCheckoutTotal(input.value)).toBe(2409);
      release();
      input.value = '7';
      input.dispatchEvent(new InputEvent('input', { bubbles: true }));
      expect(input.value).toBe('7');
    } finally {
      release();
      alert.remove();
    }
  });
});
