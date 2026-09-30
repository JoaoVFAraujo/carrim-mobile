import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { HomePage } from './home.page';

describe('HomePage', () => {
  it('renders the home page inside Ionic content', async () => {
    await TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [provideIonicAngular(), provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(HomePage);
    fixture.detectChanges();
    const page: HTMLElement = fixture.nativeElement;
    expect(page.querySelector('ion-title')?.textContent).toContain('Carrim');
    expect(page.querySelector('ion-content main h1')?.textContent).toContain('Suas compras');
  });
});
