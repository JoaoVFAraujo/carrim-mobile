import { DOCUMENT } from '@angular/common';
import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import { App, AppPlugin } from '@capacitor/app';
import {
  BarcodeFormat,
  BarcodeScanner,
  BarcodeScannerPlugin,
} from '@capacitor-mlkit/barcode-scanning';
import { parseBarcode } from '../models/catalog-product';

type ScannerAdapter = Pick<
  BarcodeScannerPlugin,
  | 'isSupported'
  | 'checkPermissions'
  | 'requestPermissions'
  | 'addListener'
  | 'startScan'
  | 'stopScan'
  | 'openSettings'
>;
export const BARCODE_SCANNER = new InjectionToken<ScannerAdapter>('barcode scanner', {
  providedIn: 'root',
  // A Capacitor proxy invents a callable for any property, including Angular's ngOnDestroy.
  factory: () => ({
    isSupported: BarcodeScanner.isSupported.bind(BarcodeScanner),
    checkPermissions: BarcodeScanner.checkPermissions.bind(BarcodeScanner),
    requestPermissions: BarcodeScanner.requestPermissions.bind(BarcodeScanner),
    addListener: BarcodeScanner.addListener.bind(BarcodeScanner),
    startScan: BarcodeScanner.startScan.bind(BarcodeScanner),
    stopScan: BarcodeScanner.stopScan.bind(BarcodeScanner),
    openSettings: BarcodeScanner.openSettings.bind(BarcodeScanner),
  }),
});
export const SCANNER_APP = new InjectionToken<Pick<AppPlugin, 'addListener'>>(
  'scanner app lifecycle',
  {
    providedIn: 'root',
    factory: () => ({ addListener: App.addListener.bind(App) }),
  },
);

@Injectable({ providedIn: 'root' })
export class BarcodeScannerService {
  private readonly plugin = inject(BARCODE_SCANNER);
  private readonly app = inject(SCANNER_APP);
  private readonly document = inject(DOCUMENT);
  readonly native = Capacitor.isNativePlatform();
  readonly busy = signal(false);
  readonly scanning = signal(false);
  readonly permissionDenied = signal(false);
  private generation = 0;
  private cancelRead?: () => void;

  async read(): Promise<string | null> {
    if (this.busy()) return null;
    if (!this.native)
      throw new Error('Use a câmera no aplicativo Android ou digite o código abaixo.');
    const generation = ++this.generation;
    this.busy.set(true);
    this.permissionDenied.set(false);
    const listeners: PluginListenerHandle[] = [];
    let started = false;
    try {
      const { supported } = await this.plugin.isSupported();
      if (generation !== this.generation) return null;
      if (!supported)
        throw new Error('A câmera não está disponível. Adicione o produto manualmente.');
      let { camera } = await this.plugin.checkPermissions();
      if (generation !== this.generation) return null;
      if (camera === 'prompt' || camera === 'prompt-with-rationale') {
        ({ camera } = await this.plugin.requestPermissions());
      }
      if (generation !== this.generation) return null;
      if (camera !== 'granted' && camera !== 'limited') {
        this.permissionDenied.set(true);
        throw new Error(
          'Permita o acesso à câmera nas configurações ou adicione o produto manualmente.',
        );
      }
      let resolveRead!: (code: string | null) => void;
      let scanFailure = false;
      const result = new Promise<string | null>((resolve) => (resolveRead = resolve));
      this.cancelRead = () => resolveRead(null);
      let settled = false;
      listeners.push(
        await this.app.addListener('appStateChange', ({ isActive }) => {
          if (!isActive) this.cancel();
        }),
      );
      listeners.push(
        await this.plugin.addListener('barcodesScanned', ({ barcodes }) => {
          if (settled || generation !== this.generation) return;
          for (const barcode of barcodes) {
            try {
              const code = parseBarcode(barcode.rawValue ?? '');
              settled = true;
              resolveRead(code);
              break;
            } catch {
              /* Ignore unrelated or incomplete camera results. */
            }
          }
        }),
      );
      listeners.push(
        await this.plugin.addListener('scanError', () => {
          if (settled || generation !== this.generation) return;
          settled = true;
          scanFailure = true;
          resolveRead(null);
        }),
      );
      if (generation !== this.generation) return null;
      this.document.body.classList.add('carrim-scanning');
      this.scanning.set(true);
      started = true;
      await this.plugin.startScan({
        formats: [BarcodeFormat.Ean13, BarcodeFormat.Ean8, BarcodeFormat.UpcA, BarcodeFormat.UpcE],
      });
      const code = await result;
      if (scanFailure)
        throw new Error('Não foi possível ler com a câmera. Tente novamente ou digite o código.');
      return generation === this.generation ? code : null;
    } finally {
      this.document.body.classList.remove('carrim-scanning');
      this.scanning.set(false);
      this.cancelRead = undefined;
      try {
        if (started) await this.plugin.stopScan();
      } finally {
        await Promise.allSettled(listeners.map((listener) => listener.remove()));
        this.busy.set(false);
      }
    }
  }

  cancel(): void {
    ++this.generation;
    this.cancelRead?.();
    this.document.body.classList.remove('carrim-scanning');
    this.scanning.set(false);
  }

  openSettings(): Promise<void> {
    return this.plugin.openSettings();
  }
}
