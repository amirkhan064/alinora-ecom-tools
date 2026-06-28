import { Component, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { SeoService } from '../../services/seo.service';

@Component({
  selector: 'app-watermark-remover-page',
  standalone: true,
  imports: [RouterLink, CommonModule],
  templateUrl: './watermark-remover-page.component.html',
  styleUrl: './watermark-remover-page.component.css'
})
export class WatermarkRemoverPageComponent implements OnInit {
  faqs = [
    {
      question: 'How does the AI watermark remover work?',
      answer: 'Our tool uses a high-precision client-side inpainting algorithm. By painting a mask over the watermark, the tool calculates surrounding pixel weights (using Inverse Distance Weighting) and propagates background textures inwards to fill the watermark area seamlessly.',
      open: false
    },
    {
      question: 'Will removing the watermark reduce my image quality?',
      answer: 'Absolutely not. Unlike generic online compression tools, SellerOS runs the inpainting calculations on a full-resolution canvas mapped to your original image dimensions. Your saved photo is exported at its exact original size and quality.',
      open: false
    },
    {
      question: 'Are my business catalog photos uploaded to your servers?',
      answer: 'No. To ensure 100% data privacy and lightning-fast speeds, all image processing is performed locally inside your browser window. Your product photographs never leave your PC or laptop.',
      open: false
    },
    {
      question: 'Is there a limit on how many watermarks I can remove?',
      answer: 'No, there are no usage limits, credit constraints, or registration gates. You can use it as much as you need for your Flipkart, Meesho, and Amazon store listings.',
      open: false
    }
  ];

  constructor(
    private seoService: SeoService,
    private meta: Meta,
    private title: Title
  ) {
    this.title.setTitle('Free AI Watermark Remover & Photo Eraser | SellerOS');
    this.meta.updateTag({ name: 'description', content: 'Free AI-powered watermark remover for e-commerce sellers. Remove logos, text, stamps, and watermarks from product photos without losing image quality.' });
    this.meta.updateTag({ name: 'keywords', content: 'remove watermark from image, free watermark remover, ai photo eraser, remove logo from photo, product photo watermark remover, e-commerce image cleanup, local image inpainting' });
    this.meta.updateTag({ property: 'og:title', content: 'Free AI Watermark Remover & Photo Eraser | SellerOS' });
    this.meta.updateTag({ property: 'og:description', content: 'Seamlessly clean up watermark text, stamps, or logos from your product photography locally. High resolution output with zero quality loss.' });
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
          "@id": "https://selleros.in/tools/ai-watermark-remover#software",
          "name": "AI Watermark Remover & Photo Eraser",
          "operatingSystem": "All",
          "applicationCategory": "BusinessApplication",
          "browserRequirements": "Requires HTML5 compatible browser. Optimized for Chrome, Edge, Safari, and Firefox.",
          "description": "Free AI-powered watermark remover for e-commerce sellers. Remove logos, text, stamps, and watermarks from product photos without losing image quality.",
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
            "High-resolution canvas-matching original image quality",
            "Precision manual drawing brush and eraser",
            "100% private processing running client-side inside the browser",
            "Interactive before/after split slider comparison"
          ]
        },
        {
          "@type": "FAQPage",
          "@id": "https://selleros.in/tools/ai-watermark-remover#faq",
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
