import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'image-downloader',
    loadComponent: () => import('./modules/image-downloader/image-downloader.component')
      .then(m => m.ImageDownloaderComponent)
  },
  {
    path: 'label-cropper',
    loadComponent: () => import('./modules/label-cropper/label-cropper.component')
      .then(m => m.LabelCropperComponent)
  },
  {
    path: 'bulk-cropper',
    loadComponent: () => import('./modules/bulk-cropper/bulk-cropper.component')
      .then(m => m.BulkCropperComponent)
  },
  {
    path: 'listing-builder',
    loadComponent: () => import('./modules/listing-builder/listing-builder.component')
      .then(m => m.ListingBuilderComponent)
  },
  {
    path: '',
    redirectTo: 'image-downloader',
    pathMatch: 'full'
  },
  {
    path: '**',
    redirectTo: 'image-downloader'
  }
];
