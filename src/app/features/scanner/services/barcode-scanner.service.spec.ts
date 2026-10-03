import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';
import { BarcodeFormat } from '@capacitor-mlkit/barcode-scanning';
import { vi } from 'vitest';
import { BARCODE_SCANNER, SCANNER_APP, BarcodeScannerService } from './barcode-scanner.service';

describe('native scanner lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.classList.remove('carrim-scanning');
  });

  function setup() {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    const callbacks = new Map<string, (event: unknown) => void>();
    const remove = vi.fn().mockResolvedValue(undefined);
    const app = {
      addListener: vi.fn(async (_event: string, callback: (event: unknown) => void) => {
        callbacks.set('appStateChange', callback);
        return { remove };
      }),
    };
    const plugin = {
      isSupported: vi.fn().mockResolvedValue({ supported: true }),
      checkPermissions: vi.fn().mockResolvedValue({ camera: 'granted' }),
      requestPermissions: vi.fn().mockResolvedValue({ camera: 'granted' }),
      startScan: vi.fn().mockResolvedValue(undefined),
      stopScan: vi.fn().mockResolvedValue(undefined),
      addListener: vi.fn(async (event: string, callback: (event: unknown) => void) => {
        callbacks.set(event, callback);
        return { remove };
      }),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: BARCODE_SCANNER, useValue: plugin },
        { provide: SCANNER_APP, useValue: app },
      ],
    });
    return { scanner: TestBed.inject(BarcodeScannerService), plugin, callbacks, remove };
  }

  it('does not request permission or start the camera when permission is denied', async () => {
    const { scanner, plugin } = setup();
    plugin.checkPermissions.mockResolvedValue({ camera: 'denied' });
    await expect(scanner.read()).rejects.toThrow('Permita');
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
    expect(plugin.startScan).not.toHaveBeenCalled();
    expect(scanner.permissionDenied()).toBe(true);
    expect(scanner.busy()).toBe(false);
  });

  it('requests permission only after read is invoked and handles refusal', async () => {
    const { scanner, plugin } = setup();
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
    plugin.checkPermissions.mockResolvedValue({ camera: 'prompt' });
    plugin.requestPermissions.mockResolvedValue({ camera: 'denied' });
    await expect(scanner.read()).rejects.toThrow('Permita');
    expect(plugin.requestPermissions).toHaveBeenCalledTimes(1);
    expect(plugin.startScan).not.toHaveBeenCalled();
  });

  it('takes one result from repeated frames and releases camera and listeners', async () => {
    const { scanner, plugin, callbacks, remove } = setup();
    const read = scanner.read();
    await vi.waitFor(() => expect(plugin.startScan).toHaveBeenCalledTimes(1));
    expect(document.body.classList.contains('carrim-scanning')).toBe(true);
    await expect(scanner.read()).resolves.toBeNull();
    callbacks.get('barcodesScanned')!({
      barcodes: [{ rawValue: '0789600112233', format: BarcodeFormat.Ean13 }],
    });
    callbacks.get('barcodesScanned')!({
      barcodes: [{ rawValue: '9999999999999', format: BarcodeFormat.Ean13 }],
    });
    await expect(read).resolves.toBe('0789600112233');
    expect(plugin.stopScan).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(3);
    expect(scanner.busy()).toBe(false);
    expect(scanner.scanning()).toBe(false);
    expect(document.body.classList.contains('carrim-scanning')).toBe(false);
  });

  it('does not start the camera after leaving during a permission request', async () => {
    const { scanner, plugin } = setup();
    plugin.checkPermissions.mockResolvedValue({ camera: 'prompt' });
    let grant!: (value: { camera: string }) => void;
    plugin.requestPermissions.mockImplementation(() => new Promise((resolve) => (grant = resolve)));
    const read = scanner.read();
    await vi.waitFor(() => expect(plugin.requestPermissions).toHaveBeenCalled());
    scanner.cancel();
    grant({ camera: 'granted' });
    await expect(read).resolves.toBeNull();
    expect(plugin.startScan).not.toHaveBeenCalled();
  });

  it('stops when the app goes into the background', async () => {
    const { scanner, plugin, callbacks } = setup();
    const read = scanner.read();
    await vi.waitFor(() => expect(plugin.startScan).toHaveBeenCalled());
    callbacks.get('appStateChange')!({ isActive: false });
    await expect(read).resolves.toBeNull();
    expect(plugin.stopScan).toHaveBeenCalledTimes(1);
  });

  it('restores the UI when camera startup fails', async () => {
    const { scanner, plugin, remove } = setup();
    plugin.startScan.mockRejectedValue(new Error('camera failure'));
    await expect(scanner.read()).rejects.toThrow('camera failure');
    expect(plugin.stopScan).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(3);
    expect(document.body.classList.contains('carrim-scanning')).toBe(false);
    expect(scanner.busy()).toBe(false);
  });

  it('reports a native scan error and allows another attempt', async () => {
    const { scanner, plugin, callbacks } = setup();
    const read = scanner.read();
    const rejection = expect(read).rejects.toThrow('Não foi possível ler');
    await vi.waitFor(() => expect(plugin.startScan).toHaveBeenCalled());
    callbacks.get('scanError')!({ message: 'camera failed' });
    await rejection;
    expect(scanner.busy()).toBe(false);
    expect(plugin.stopScan).toHaveBeenCalledTimes(1);
  });
});
