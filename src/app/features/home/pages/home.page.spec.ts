import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { ShoppingSessionStore } from '../../shopping/services/shopping-session.store';
import { IonModal, provideIonicAngular } from '@ionic/angular';
import { HomePage } from './home.page';

describe('HomePage', () => {
  it('allows dismissal after persistence and waits for the Ionic overlay to close before navigating', async () => {
    await TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [provideIonicAngular(), provideRouter([])],
    }).compileComponents();
    vi.spyOn(TestBed.inject(ShoppingSessionStore), 'create').mockResolvedValue(undefined);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(HomePage);
    fixture.detectChanges();
    const modal = fixture.debugElement
      .queryAll(By.directive(IonModal))
      .at(-1)!
      .injector.get(IonModal);
    let close!: () => void;
    const dismiss = vi.spyOn(modal, 'dismiss').mockImplementation(() => {
      expect(modal.canDismiss).toBe(true);
      return new Promise<boolean>((resolve) => {
        close = () => resolve(true);
      });
    });
    const starting = fixture.componentInstance.startShopping();
    fixture.detectChanges();
    await vi.waitFor(() => {
      expect(fixture.componentInstance.formError()).toBe('');
      expect(dismiss).toHaveBeenCalledOnce();
    });
    expect(navigate).not.toHaveBeenCalled();
    close();
    await starting;
    expect(navigate).toHaveBeenCalledWith('/tabs/cart');
    expect(fixture.componentInstance.saving()).toBe(false);
  });

  it('opens the cart only after the new purchase has been saved', async () => {
    let confirmSave!: () => void;
    const create = vi.fn().mockReturnValue(
      new Promise<void>((resolve) => {
        confirmSave = resolve;
      }),
    );
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: ShoppingSessionStore, useValue: { create } }],
    });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const page = TestBed.runInInjectionContext(() => new HomePage());
    page.supermarketName = 'São Luiz';
    page.modalOpen.set(true);
    const starting = page.startShopping();
    expect(navigate).not.toHaveBeenCalled();
    confirmSave();
    await starting;
    expect(create).toHaveBeenCalledWith('', 'São Luiz', null);
    expect(page.modalOpen()).toBe(false);
    expect(navigate).toHaveBeenCalledWith('/tabs/cart');
  });

  it('keeps the new-purchase form open without navigating if saving fails', async () => {
    const create = vi.fn().mockRejectedValue(new Error('Informe o nome do supermercado.'));
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: ShoppingSessionStore, useValue: { create } }],
    });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const page = TestBed.runInInjectionContext(() => new HomePage());
    page.modalOpen.set(true);
    await page.startShopping();
    expect(navigate).not.toHaveBeenCalled();
    expect(page.modalOpen()).toBe(true);
    expect(page.formError()).toContain('Informe');
    expect(page.saving()).toBe(false);
  });

  it('renders the home page inside Ionic content', async () => {
    await TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [provideIonicAngular(), provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(HomePage);
    fixture.detectChanges();
    const page: HTMLElement = fixture.nativeElement;
    expect(page.querySelector('[aria-label="Carrim"]')?.textContent).toContain('Carrim');
    expect(page.querySelector('ion-content main h1')?.textContent).toContain('Sua compra');
  });
});
