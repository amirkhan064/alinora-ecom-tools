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
      question: 'Which marketplaces are supported by the image downloader?',
      answer: 'Currently, SellerOS supports downloading product listing images from Flipkart, Amazon.in, Meesho, and Myntra. We extract the highest resolution original images directly from the official listings.',
      open: false
    },
    {
      question: 'Is there a limit on how many images I can download?',
      answer: 'No. SellerOS is 100% free and unlimited. You can paste and download images from as many product listings as you need, without any daily caps or watermarks.',
      open: false
    },
    {
      question: 'Does this tool download high-quality zoom images?',
      answer: 'Yes! The downloader automatically locates the highest resolution Zoom/HD source images in the platform metadata rather than the low-res search thumbnails.',
      open: false
    },
    {
      question: 'How do I download Myntra or Meesho images?',
      answer: 'Simply copy the product details URL from your browser or mobile sharing link, paste it into our Downloader search bar, and click "Extract Images". You can download them individually or as a single ZIP file.',
      open: false
    }
  ];

  toggleFaq(index: number) {
    this.faqs[index].open = !this.faqs[index].open;
  }
}
