import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // Public SEO pages — prerender at build time for maximum SEO
  { path: '', renderMode: RenderMode.Prerender },
  { path: 'tools/bulk-image-downloader', renderMode: RenderMode.Prerender },
  { path: 'tools/shipping-label-cropper', renderMode: RenderMode.Prerender },
  { path: 'tools/ai-listing-generator', renderMode: RenderMode.Prerender },

  // App workspace — client-side only, skip SSR entirely
  { path: 'app/**', renderMode: RenderMode.Client },

  // Legacy/Fallback routes — bypass SSR to handle via client redirects
  { path: 'image-downloader', renderMode: RenderMode.Client },
  { path: 'label-cropper', renderMode: RenderMode.Client },
  { path: 'bulk-cropper', renderMode: RenderMode.Client },
  { path: 'listing-builder', renderMode: RenderMode.Client },
  { path: '**', renderMode: RenderMode.Client }
];
