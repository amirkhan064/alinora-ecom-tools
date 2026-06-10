import { Component, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { SeoService } from '../../services/seo.service';

@Component({
  selector: 'app-label-cropper-page',
  standalone: true,
  imports: [RouterLink, CommonModule],
  templateUrl: './label-cropper-page.component.html',
  styleUrl: './label-cropper-page.component.css'
})
export class LabelCropperPageComponent implements OnInit {
  faqs = [
    {
      question: 'Which marketplaces are supported?',
      answer: 'SellerOS supports shipping labels from Flipkart, Meesho, Amazon, and Myntra. You can upload standard multi-page A4 PDF files directly.',
      open: false
    },
    {
      question: 'How does the SKU sorting work?',
      answer: 'Our tool reads the barcode and text on your shipping labels to find the SKU code. It then groups labels with the same SKU together so you can pack similar items in one go.',
      open: false
    },
    {
      question: 'Are my PDF files uploaded to a server?',
      answer: 'No! Your files are processed completely inside your browser. No order details, customer names, or addresses are uploaded or saved on our servers. Your data is 100% safe.',
      open: false
    },
    {
      question: 'Does this work for thermal printers?',
      answer: 'Yes. It crops the labels from large A4 pages and sizes them to standard 3x5 or 4x6 inch thermal formats. The prints are clear, so courier companies can easily scan the barcodes.',
      open: false
    }
  ];

  constructor(
    private seoService: SeoService,
    private meta: Meta,
    private title: Title
  ) {
    this.title.setTitle('Bulk Shipping Label Cropper for Meesho, Flipkart & Myntra 3x5 | Free - SellerOS');
    this.meta.updateTag({ name: 'description', content: 'Free online shipping label cropper for Meesho, Flipkart, Myntra, and Amazon sellers. Auto-crop A4 PDF invoices into individual thermal label sizes and group by SKU.' });
    this.meta.updateTag({ name: 'keywords', content: 'meesho label cropper, flipkart shipping label cropper, myntra label cropper, thermal label crop 3x5, bulk pdf cropper, amazon seller label crop, online pdf cropper' });
    this.meta.updateTag({ property: 'og:title', content: 'Bulk Shipping Label Cropper for Flipkart, Meesho, Amazon & Myntra' });
    this.meta.updateTag({ property: 'og:description', content: 'Auto-crop multi-page e-commerce shipping labels to 4x6 / 3x5 thermal print size in one click. Fully secure, client-side execution.' });
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
          "@id": "https://selleros.in/tools/shipping-label-cropper#software",
          "name": "E-commerce Shipping Label Cropper & Sorter",
          "operatingSystem": "All",
          "applicationCategory": "BusinessApplication",
          "browserRequirements": "Requires HTML5 compatible browser. Optimized for Chrome, Edge, Safari, and Firefox.",
          "description": "A free web-based utility for e-commerce sellers to instantly crop, rotate, and sort bulk shipping labels for platforms like Flipkart, Amazon, Meesho, and Myntra to match standard thermal printer dimensions.",
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
            "ratingCount": "184"
          },
          "featureList": [
            "One-click multi-page PDF separation",
            "Custom dimensions for 4x6 / 3x5 thermal label printers",
            "Automated sorting by marketplace platform (Flipkart, Meesho, Amazon, Myntra)",
            "100% local browser processing for maximum data privacy"
          ]
        },
        {
          "@type": "FAQPage",
          "@id": "https://selleros.in/tools/shipping-label-cropper#faq",
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
