import {
  Maskito,
  maskitoInitialCalibrationPlugin,
  type MaskitoElementPredicate,
  type MaskitoOptions,
} from '@maskito/core';

function centsCharacters(value: string): string {
  const prefixed = /^R\$\s*/.test(value);
  const amount = value.replace(/^R\$\s*/, '');
  const decimal = /^(-?)(\d+|\d{1,3}(?:\.\d{3})+),(\d{1,2})$/.exec(amount);
  if (decimal) return decimal[1] + decimal[2].replaceAll('.', '') + decimal[3].padEnd(2, '0');
  const dotDecimal = /^(-?\d+)\.(\d{1,2})$/.exec(amount);
  if (dotDecimal) return dotDecimal[1] + dotDecimal[2].padEnd(2, '0');
  if ((prefixed && /^-?\d+$/.test(amount)) || /^-?\d{1,3}(?:\.\d{3})+$/.test(amount)) {
    return amount.replaceAll('.', '') + '00';
  }
  return amount.replace(/[.,\s]/g, '');
}

function displayCents(value: string): string {
  const negative = value.startsWith('-');
  const digits = value.replace('-', '').replace(/^0+(?=\d)/, '');
  if (!digits) return negative ? 'R$ -' : '';
  const padded = digits.padStart(3, '0');
  const whole = padded.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return 'R$ ' + (negative ? '-' : '') + whole + ',' + padded.slice(-2);
}

function caretFromRight(raw: string, position: number, formatted: string): number {
  const remaining = (raw.slice(position).match(/\d/g) ?? []).length;
  if (!remaining) return formatted.length;
  let count = 0;
  for (let i = formatted.length - 1; i >= 0; i--) {
    if (/\d/.test(formatted[i]) && ++count === remaining) return i;
  }
  return formatted.search(/[\d-]/);
}

/** Digit entry is in cents; formatted BRL paste and decimal prefills retain their amount. */
export const brlMask: MaskitoOptions = {
  mask: /^-?\d*$/,
  preprocessors: [
    ({ elementState, data }) => ({
      elementState: {
        value: centsCharacters(elementState.value),
        selection: elementState.selection.map(
          (position) => (elementState.value.slice(0, position).match(/[\d-]/g) ?? []).length,
        ) as [number, number],
      },
      data: centsCharacters(data),
    }),
  ],
  postprocessors: [
    ({ value, selection }) => {
      const formatted = displayCents(value);
      return {
        value: formatted,
        selection: selection.map((position) =>
          Math.max(0, caretFromRight(value, position, formatted)),
        ) as [number, number],
      };
    },
  ],
  plugins: [maskitoInitialCalibrationPlugin()],
};

export const ionInputElement: MaskitoElementPredicate = (element) =>
  (element as HTMLIonInputElement).getInputElement();

/** Native alert inputs are outside Angular's template tree. */
export function attachBrlMask(alert: HTMLElement, id: string): () => void {
  const input = alert.querySelector<HTMLInputElement>(`input#${id}`);
  const mask = input ? new Maskito(input, brlMask) : null;
  return () => mask?.destroy();
}
