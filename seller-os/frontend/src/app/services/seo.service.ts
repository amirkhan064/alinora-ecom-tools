import { Inject, Injectable, inject } from '@angular/core';
import { Title, Meta } from '@angular/platform-browser';
import { DOCUMENT } from '@angular/common';

export interface SeoConfig {
  title: string;
  description: string;
  keywords?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  ogType?: string;
}

@Injectable({
  providedIn: 'root'
})
export class SeoService {
  private title = inject(Title);
  private meta = inject(Meta);

  constructor(@Inject(DOCUMENT) private document: Document) {}

  /**
   * Dynamically inserts or updates a JSON-LD schema block in the document head.
   * @param schemaData The JavaScript object representing your structured data graph.
   */
  setJsonLd(schemaData: any): void {
    // 1. Remove any existing schema script to prevent duplication on client-side routing
    const existingScript = this.document.getElementById('app-jsonld');
    if (existingScript) {
      existingScript.remove();
    }

    // 2. Create the new script element
    const script = this.document.createElement('script');
    script.setAttribute('id', 'app-jsonld');
    script.setAttribute('type', 'application/ld+json');
    script.innerHTML = JSON.stringify(schemaData);

    // 3. Append to head (This executes perfectly on Express Engine / SSR Node server)
    this.document.head.appendChild(script);
  }
  /**
   * Dynamically generate and inject SEO tags into the head of the document
   * @param config The metadata config to inject
   */
  generateTags(config: SeoConfig): void {
    // 1. Standard HTML Title
    this.title.setTitle(config.title);

    // 2. Standard Meta Tags
    this.meta.updateTag({ name: 'description', content: config.description });
    if (config.keywords) {
      this.meta.updateTag({ name: 'keywords', content: config.keywords });
    } else {
      this.meta.removeTag('name="keywords"');
    }

    // 3. Open Graph Metadata
    this.meta.updateTag({ property: 'og:title', content: config.ogTitle || config.title });
    this.meta.updateTag({ property: 'og:description', content: config.ogDescription || config.description });
    this.meta.updateTag({ property: 'og:type', content: config.ogType || 'website' });

    if (config.ogImage) {
      this.meta.updateTag({ property: 'og:image', content: config.ogImage });
    } else {
      this.meta.removeTag('property="og:image"');
    }
  }
}
