import { Component, OnInit, Inject, PLATFORM_ID } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { SeoService } from '../../services/seo.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink, CommonModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css'
})
export class HomeComponent implements OnInit {

  faqs = [
    {
      question: 'How does the AI write listings for Indian buyers?',
      answer: 'Our AI is designed for Indian online marketplaces like Flipkart, Amazon, and Meesho. It uses popular search words that Indian buyers type, helping your products rank higher and get more orders.',
      open: false
    },
    {
      question: 'Do I need to pay or buy any API key?',
      answer: 'No, you can use our AI writer for free without any API key. But if you want to write hundreds of listings daily, you can add your own free Gemini API key in the settings panel.',
      open: false
    },
    {
      question: 'Does it generate bullet points and backend keywords?',
      answer: 'Yes. It creates professional bullet points, detailed product descriptions, and backend search keywords that you can copy directly into your bulk listing excel sheets.',
      open: false
    },
    {
      question: 'Can I generate listings in Hinglish?',
      answer: 'Yes. While the main description is in English (which Flipkart and Amazon require), our AI automatically adds popular Hinglish search keywords (like "cotton printed suit" or "daily wear kurti") to attract more buyers.',
      open: false
    },
    {
      question: 'How does the AI Watermark Remover work?',
      answer: 'Our watermark remover runs a local texture inpainting algorithm directly in your browser. Just brush over the watermark, logo, or stamp, and the tool rebuilds the background without compressing or quality-reducing your high-resolution original product photos.',
      open: false
    }
  ];
  constructor(
    private seoService: SeoService,
    private meta: Meta,
    private title: Title,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.title.setTitle('Free E-commerce Merchant Tools for Flipkart, Amazon, Myntra & Meesho | SellerOS');
    this.meta.updateTag({ name: 'description', content: 'Free productivity tools for online e-commerce sellers. Crop PDF shipping labels for thermal printers, download competitor product images, bulk resize photos to 1:1, and build optimized AI SEO product listings.' });
    this.meta.updateTag({ name: 'keywords', content: 'seller tools, flipkart shipping label cropper, meesho label cropper, amazon listing generator, myntra partner portal, bulk image downloader, image cropper 1:1, free e-commerce tools, packing list sorter, thermal label crop 4x6' });
    this.meta.updateTag({ property: 'og:title', content: 'Free E-commerce Merchant Tools | SellerOS' });
    this.meta.updateTag({ property: 'og:description', content: 'Free productivity utilities for e-commerce merchants. Crop shipping labels, bulk download product photos, resize images, and write high-converting listings.' });
  }

  ngOnInit(): void {
    this.generateStructuredData();
    this.initScrollReveal();
  }

  initScrollReveal(): void {
    if (isPlatformBrowser(this.platformId)) {
      const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.1
      };

      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
            observer.unobserve(entry.target);
          }
        });
      }, observerOptions);

      // Find all elements to reveal and attach observer with brief delay to let DOM load
      setTimeout(() => {
        const revealElements = document.querySelectorAll('.reveal-on-scroll');
        revealElements.forEach(el => observer.observe(el));
      }, 100);
    }
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
          "@id": "https://selleros.in/tools/ai-listing-generator#software",
          "name": "AI Product Listing Generator",
          "operatingSystem": "All",
          "applicationCategory": "BusinessApplication",
          "browserRequirements": "Requires HTML5 compatible browser. Optimized for Chrome, Edge, Safari, and Firefox.",
          "description": "Free AI-powered product listing generator for Flipkart, Meesho, and Amazon sellers. Generate SEO-optimized titles, descriptions, bullets, and keywords instantly.",
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
            "ratingCount": "142"
          },
          "featureList": [
            "SEO-optimized titles specifically for Indian marketplaces",
            "Automated catalog bullet points generation",
            "Targeted search keywords research",
            "Preloaded with advanced AI capabilities"
          ]
        },
        {
          "@type": "FAQPage",
          "@id": "https://selleros.in/tools/ai-listing-generator#faq",
          "mainEntity": faqEntities
        }
      ]
    };

    this.seoService.setJsonLd(schemaGraph);
  }

  toggleFaq(index: number): void {
    this.faqs[index].open = !this.faqs[index].open;
  }
}
