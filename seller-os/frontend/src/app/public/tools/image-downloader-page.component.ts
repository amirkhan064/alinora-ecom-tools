import { Component } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { SeoService } from '../../services/seo.service';

@Component({
  selector: 'app-image-downloader-page',
  standalone: true,
  imports: [RouterLink, CommonModule],
  templateUrl: './image-downloader-page.component.html',
  styleUrl: './image-downloader-page.component.css'
})
export class ImageDownloaderPageComponent {
  toolSlug!: string;

  constructor(
    private route: ActivatedRoute,
    private seoService: SeoService,
    private meta: Meta,
    private title: Title
  ) {
    this.title.setTitle('Flipkart & Amazon Product Image Downloader Tool | Free Online - SellerOS');
    this.meta.updateTag({ name: 'description', content: 'Free high-resolution product image downloader for Flipkart, Amazon, Meesho, and Myntra. Extract original high-quality zoom photos and download as a ZIP file instantly.' });
    this.meta.updateTag({ name: 'keywords', content: 'flipkart image downloader, amazon product image downloader, meesho product download, myntra image extract, e-commerce image scraper, download high-res images' });
    this.meta.updateTag({ property: 'og:title', content: 'Product Image Downloader for Flipkart, Amazon & Meesho' });
    this.meta.updateTag({ property: 'og:description', content: 'Download original, high-resolution product images from Flipkart, Amazon, Myntra, and Meesho in one click.' });
  }

  ngOnInit(): void {
    this.generateStructuredData();
  }

  generateStructuredData(): void {
    const faqEntities = this.faqs.map(faq => ({
      "@type": "Question",
      "name": faq.question,
      "acceptedAnswer": {
        "@type": "Answer",
        "text": faq.answer
      }
    }));

    const schemaGraph = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "SoftwareApplication",
          "@id": "https://selleros.in/tools/bulk-image-downloader#software",
          "name": "Flipkart & Amazon Product Image Downloader",
          "operatingSystem": "All",
          "applicationCategory": "BusinessApplication",
          "browserRequirements": "Requires HTML5 compatible browser. Optimized for Chrome, Edge, Safari, and Firefox.",
          "description": "Free high-resolution product image downloader for Flipkart, Amazon, Meesho, and Myntra. Extract original Zoom/HD photos and download as a ZIP file instantly.",
          "softwareVersion": "1.0.0",
          "offers": {
            "@type": "Offer",
            "price": "0.00",
            "priceCurrency": "INR",
            "description": "Free web utility tool for independent online marketplace sellers."
          },
          "aggregateRating": {
            "@type": "AggregateRating",
            "ratingValue": "4.9",
            "ratingCount": "248"
          },
          "featureList": [
            "One-click high-resolution Zoom image extraction",
            "Support for Flipkart, Amazon, Meesho, and Myntra listings",
            "Download individual images or all as a ZIP archive",
            "100% free and unlimited usage"
          ]
        },
        {
          "@type": "FAQPage",
          "@id": "https://selleros.in/tools/bulk-image-downloader#faq",
          "mainEntity": faqEntities
        }
      ]
    };

    this.seoService.setJsonLd(schemaGraph);
  }
  faqs = [
    {
      question: 'Which marketplaces are supported?',
      answer: 'You can download product photos from Flipkart, Amazon.in, Meesho, and Myntra. We fetch the highest quality original photos directly from the listing.',
      open: false
    },
    {
      question: 'Is there a limit on download counts?',
      answer: 'No. Our tool is 100% free and unlimited. You can download product images from as many links as you want.',
      open: false
    },
    {
      question: 'Does it download high-quality zoom photos?',
      answer: 'Yes! We find and download the original high-resolution zoom photos that the seller uploaded, not the small, blurry thumbnails.',
      open: false
    },
    {
      question: 'How do I download Meesho or Myntra photos?',
      answer: 'Just copy the product link from your browser or mobile app, paste it into the downloader search box, and click "Search". You can download photos one by one or all of them together in a single ZIP folder.',
      open: false
    }
  ];

  toggleFaq(index: number) {
    this.faqs[index].open = !this.faqs[index].open;
  }
}
