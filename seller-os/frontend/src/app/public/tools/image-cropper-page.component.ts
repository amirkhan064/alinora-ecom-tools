import { Component, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { SeoService } from '../../services/seo.service';

@Component({
  selector: 'app-image-cropper-page',
  standalone: true,
  imports: [RouterLink, CommonModule],
  templateUrl: './image-cropper-page.component.html',
  styleUrl: './image-cropper-page.component.css'
})
export class ImageCropperPageComponent implements OnInit {
  constructor(
    private seoService: SeoService,
    private meta: Meta,
    private title: Title
  ) {
    this.title.setTitle('E-commerce Bulk Image Cropper & Resizer | Free Online - SellerOS');
    this.meta.updateTag({ name: 'description', content: 'Free bulk product image cropper for Amazon, Flipkart, and Meesho. Resize, square-crop (1:1), and compress images for e-commerce listings instantly.' });
    this.meta.updateTag({ name: 'keywords', content: 'bulk image cropper, 1:1 image cropper, flipkart photo resizer, amazon image crop, meesho listing size, bulk image resizer online, e-commerce image converter' });
    this.meta.updateTag({ property: 'og:title', content: 'E-commerce Bulk Image Cropper & Resizer' });
    this.meta.updateTag({ property: 'og:description', content: 'Auto-crop and resize multiple product images into the standard 1:1 square ratio for online marketplace listings.' });
  }

  ngOnInit(): void {
    this.generateStructuredData();
  }

  faqs = [
    {
      question: 'Why is the 1:1 ratio important for online marketplaces?',
      answer: 'Amazon, Flipkart, and Meesho recommend or enforce 1:1 square aspect ratio images for product listings. Square images occupy maximum real estate in search feeds, resulting in higher click-through rates (CTR) and professional-looking catalogs.',
      open: false
    },
    {
      question: 'Can I crop multiple images at the same time?',
      answer: 'Yes! Our bulk cropper lets you upload dozens of images simultaneously. You can set the crop boundary or choose preset aspect ratios and apply adjustments across all files at once.',
      open: false
    },
    {
      question: 'Does this tool compromise image quality or compress too much?',
      answer: 'No. SellerOS processes images locally inside your browser, maintaining original pixel clarity. You can optionally compress the final output to reduce file sizes for faster page loading on listing sheets.',
      open: false
    },
    {
      question: 'Are my images secure? Do you upload them to a server?',
      answer: 'Absolutely secure. All cropping, aspect ratio locking, and compression processes occur directly inside your local browser sandbox. No image data is sent to our servers, respecting your catalog privacy.',
      open: false
    }
  ];

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
          "@id": "https://selleros.in/tools/bulk-image-cropper#software",
          "name": "E-commerce Bulk Image Cropper",
          "operatingSystem": "All",
          "applicationCategory": "BusinessApplication",
          "browserRequirements": "Requires HTML5 compatible browser. Optimized for Chrome, Edge, Safari, and Firefox.",
          "description": "Free bulk product image cropper for Amazon, Flipkart, and Meesho. Resize, square-crop (1:1), and compress images for e-commerce listings instantly.",
          "softwareVersion": "1.0.0",
          "offers": {
            "@type": "Offer",
            "price": "0.00",
            "priceCurrency": "INR",
            "description": "Free web utility tool for independent online marketplace sellers."
          },
          "aggregateRating": {
            "@type": "AggregateRating",
            "ratingValue": "4.8",
            "ratingCount": "184"
          },
          "featureList": [
            "Bulk image uploads and cropping",
            "1:1 Square aspect ratio lock for Amazon, Flipkart, and Meesho",
            "Browser-level local sandbox processing (100% secure)",
            "High-speed batch compression and ZIP download"
          ]
        },
        {
          "@type": "FAQPage",
          "@id": "https://selleros.in/tools/bulk-image-cropper#faq",
          "mainEntity": faqEntities
        }
      ]
    };

    this.seoService.setJsonLd(schemaGraph);
  }

  toggleFaq(index: number) {
    this.faqs[index].open = !this.faqs[index].open;
  }
}
