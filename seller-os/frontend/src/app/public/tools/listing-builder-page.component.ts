import { Component, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { SeoService } from '../../services/seo.service';

@Component({
  selector: 'app-listing-builder-page',
  standalone: true,
  imports: [RouterLink, CommonModule],
  templateUrl: './listing-builder-page.component.html',
  styleUrl: './listing-builder-page.component.css'
})
export class ListingBuilderPageComponent implements OnInit {
  faqs = [
    {
      question: 'How does the AI write listings for Indian buyers?',
      answer: 'Our AI is designed for Indian marketplaces like Flipkart, Amazon, Meesho, and Myntra. It uses popular search words that Indian buyers type, helping your products rank higher and get more orders.',
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
    }
  ];

  constructor(
    private seoService: SeoService,
    private meta: Meta,
    private title: Title
  ) {
    this.title.setTitle('AI Product Listing Generator for Flipkart, Amazon, Meesho & Myntra | SellerOS');
    this.meta.updateTag({ name: 'description', content: 'Free AI-powered product listing generator for Flipkart, Myntra, Meesho, and Amazon sellers. Generate SEO-optimized titles, descriptions, bullets, and keywords instantly.' });
    this.meta.updateTag({ name: 'keywords', content: 'ai listing builder, amazon listing generator, flipkart product description writer, meesho catalog builder, myntra product listing generator, e-commerce seo copywriter, free listing tool' });
    this.meta.updateTag({ property: 'og:title', content: 'AI Product Listing Generator | Amazon, Flipkart, Meesho & Myntra' });
    this.meta.updateTag({ property: 'og:description', content: 'Create high-converting e-commerce product catalogs using Advanced AI. Get search-optimized titles, bullets, descriptions, and backend search terms in seconds.' });
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
          "@id": "https://selleros.in/tools/ai-listing-generator#software",
          "name": "AI Product Listing Generator",
          "operatingSystem": "All",
          "applicationCategory": "BusinessApplication",
          "browserRequirements": "Requires HTML5 compatible browser. Optimized for Chrome, Edge, Safari, and Firefox.",
          "description": "Free AI-powered product listing generator for Flipkart, Myntra, Meesho, and Amazon sellers. Generate SEO-optimized titles, descriptions, bullets, and keywords instantly.",
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
            "SEO-optimized titles specifically for Indian marketplaces (Amazon, Flipkart, Meesho, Myntra)",
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

  toggleFaq(index: number) {
    this.faqs[index].open = !this.faqs[index].open;
  }
}
