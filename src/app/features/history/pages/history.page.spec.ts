import { DOCUMENT, registerLocaleData } from '@angular/common';
import pt from '@angular/common/locales/pt';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { vi } from 'vitest';
import { HistoryPage } from './history.page';
import { ShoppingSessionStore } from '../../shopping/services/shopping-session.store';
import { ProductPhotoService } from '../../../core/photos/product-photo.service';

describe('history resume', () => {
  it('distinguishes an unreported checkout from zero and opens read-only items from the summary', async () => {
    registerLocaleData(pt);
    const finishedAt = new Date(2026, 9, 17).getTime();
    const purchases = [
      {
        id: 'missing',
        supermarketName: 'Mercado A',
        finishedAt,
        totalCents: 100,
        checkoutTotalCents: null,
        itemCount: 3,
        budgetCents: null,
      },
      {
        id: 'zero',
        supermarketName: 'Mercado B',
        finishedAt,
        totalCents: 100,
        checkoutTotalCents: 0,
        itemCount: 1,
        budgetCents: null,
      },
    ];
    const manualId = '2d6cba49-3a44-42ce-bf91-1db447a2703d';
    const completedItems = vi.fn().mockResolvedValue([
      {
        id: 'coded',
        sessionId: 'missing',
        name: 'Coffee',
        barcode: '7891000100103',
        unitPriceCents: 10,
        quantity: 1,
      },
      {
        id: manualId,
        sessionId: 'missing',
        name: 'Banana',
        barcode: null,
        unitPriceCents: 20,
        quantity: 1,
      },
      {
        id: 'unknown',
        sessionId: 'missing',
        name: 'Unknown',
        barcode: '7894900011517',
        unitPriceCents: 70,
        quantity: 1,
      },
    ]);
    const image = 'data:image/jpeg;base64,/9j/2Q==';
    const photos = {
      revision: signal(0),
      refresh: vi.fn().mockResolvedValue(undefined),
      hidden: vi.fn().mockResolvedValue(false),
      get: vi
        .fn()
        .mockImplementation(async (target) =>
          target.barcode === '7894900011517' ? null : { imageUrl: image },
        ),
    };
    await TestBed.configureTestingModule({
      imports: [HistoryPage],
      providers: [
        provideRouter([]),
        provideIonicAngular(),
        { provide: ProductPhotoService, useValue: photos },
        {
          provide: ShoppingSessionStore,
          useValue: {
            history: signal(purchases),
            loading: signal(false),
            error: signal(''),
            completedItems,
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(HistoryPage);
    fixture.detectChanges();
    const records: NodeListOf<HTMLDetailsElement> =
      fixture.nativeElement.querySelectorAll('.purchase-record');
    const missing = [...records].find((record) => record.textContent!.includes('Mercado A'))!;
    const zero = [...records].find((record) => record.textContent!.includes('Mercado B'))!;
    expect(missing.textContent).toContain('Não informado');
    expect(missing.textContent).not.toContain('Diferença');
    expect(zero.textContent).not.toContain('Não informado');
    expect(zero.textContent).toContain('Diferença');
    expect(zero.textContent).toMatch(/-R\$\s*1,00/);
    missing.querySelector<HTMLElement>('summary')!.click();
    expect(missing.open).toBe(true);
    missing.querySelector<HTMLElement>('.view-items')!.click();
    await fixture.whenStable();
    expect(completedItems).toHaveBeenCalledWith('missing');
    expect(fixture.componentInstance.selected()?.id).toBe('missing');
    // The unit runner does not mount native Ionic overlays automatically.
    fixture.nativeElement.querySelector('ion-modal').dispatchEvent(new Event('ionMount'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const rows = fixture.debugElement.queryAll(By.css('.history-item'));
    expect(rows).toHaveLength(3);
    expect(rows[0].nativeElement.querySelector('img')?.getAttribute('src')).toBe(image);
    expect(rows[1].nativeElement.querySelector('img')?.getAttribute('src')).toBe(image);
    expect(rows[2].nativeElement.querySelector('img')).toBeNull();
    expect(rows[2].nativeElement.querySelector('ion-icon')).not.toBeNull();
    expect(photos.get).toHaveBeenCalledWith({ barcode: '7891000100103', itemId: null });
    expect(photos.get).toHaveBeenCalledWith({ barcode: null, itemId: manualId });
    expect(rows[0].nativeElement.textContent).toMatch(/R\$\s*0,10/);
    fixture.componentInstance.close();
    fixture.detectChanges();
    fixture.destroy();
  });

  it('refreshes this month when returning from the background across a month boundary', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 0, 31, 23, 59));
      const document = { visibilityState: 'hidden' };
      TestBed.configureTestingModule({
        providers: [
          HistoryPage,
          { provide: DOCUMENT, useValue: document },
          {
            provide: ShoppingSessionStore,
            useValue: {
              history: signal([
                { id: 'jan', finishedAt: new Date(2026, 0, 1).getTime() },
                { id: 'feb', finishedAt: new Date(2026, 1, 1).getTime() },
              ]),
            },
          },
        ],
      });
      const page = TestBed.inject(HistoryPage);
      page.period.set('month');
      expect(page.groups()[0].purchases[0].id).toBe('jan');
      vi.setSystemTime(new Date(2026, 1, 1));
      page.refreshDate();
      expect(page.groups()[0].purchases[0].id).toBe('jan');
      document.visibilityState = 'visible';
      page.refreshDate();
      expect(page.groups()[0].purchases[0].id).toBe('feb');
    } finally {
      vi.useRealTimers();
    }
  });
});
