import { Routes } from '@angular/router';

export const routes: Routes = [
  // 1. The Public SEO Tree (SSR Enabled)
  {
    path: '',
    loadComponent: () => import('./public/layout/public-layout.component')
      .then(m => m.PublicLayoutComponent),
    children: [
      {
        path: '',
        loadComponent: () => import('./public/home/home.component')
          .then(m => m.HomeComponent)
      },
      {
        path: 'tools/bulk-image-downloader',
        loadComponent: () => import('./public/tools/image-downloader-page.component')
          .then(m => m.ImageDownloaderPageComponent)
      },
      {
        path: 'tools/bulk-image-cropper',
        loadComponent: () => import('./public/tools/image-cropper-page.component')
          .then(m => m.ImageCropperPageComponent)
      },
      {
        path: 'tools/shipping-label-cropper',
        loadComponent: () => import('./public/tools/label-cropper-page.component')
          .then(m => m.LabelCropperPageComponent)
      },
      {
        path: 'tools/ai-listing-generator',
        loadComponent: () => import('./public/tools/listing-builder-page.component')
          .then(m => m.ListingBuilderPageComponent)
      },
      {
        path: 'tools/ai-watermark-remover',
        loadComponent: () => import('./public/tools/watermark-remover-page.component')
          .then(m => m.WatermarkRemoverPageComponent)
      }
    ]
  },

  // 2. The App Workspace Tree (Client-Side Only / Non-SSR)
  {
    path: 'app',
    loadComponent: () => import('./shell/workspace-shell.component')
      .then(m => m.WorkspaceShellComponent),
    children: [
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
        path: 'watermark-remover',
        loadComponent: () => import('./modules/watermark-remover/watermark-remover.component')
          .then(m => m.WatermarkRemoverComponent)
      },
      {
        path: '',
        redirectTo: 'image-downloader',
        pathMatch: 'full'
      }
    ]
  },

  // 3. Backward Compatibility Redirects for legacy routes
  {
    path: 'image-downloader',
    redirectTo: 'app/image-downloader',
    pathMatch: 'full'
  },
  {
    path: 'label-cropper',
    redirectTo: 'app/label-cropper',
    pathMatch: 'full'
  },
  {
    path: 'bulk-cropper',
    redirectTo: 'app/bulk-cropper',
    pathMatch: 'full'
  },
  {
    path: 'listing-builder',
    redirectTo: 'app/listing-builder',
    pathMatch: 'full'
  },
  {
    path: 'watermark-remover',
    redirectTo: 'app/watermark-remover',
    pathMatch: 'full'
  },

  // Catch-all route -> redirect to home page
  {
    path: '**',
    redirectTo: ''
  }
];

