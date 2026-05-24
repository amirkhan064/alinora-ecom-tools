import { Component, inject, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommonModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class App {
  private router = inject(Router);
  protected readonly title = signal('SellerOS');
  protected readonly pageTitle = signal('Image Downloader');

  constructor() {
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: any) => {
      const url = event.urlAfterRedirects || event.url;
      if (url.includes('label-cropper')) {
        this.pageTitle.set('Label Cropper & Processor');
      } else if (url.includes('bulk-cropper')) {
        this.pageTitle.set('Bulk Image Cropper');
      } else if (url.includes('listing-builder')) {
        this.pageTitle.set('AI Listing Builder');
      } else {
        this.pageTitle.set('Image Downloader');
      }
    });
  }
}
