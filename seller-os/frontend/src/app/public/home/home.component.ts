import { Component, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
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
      question: 'How does the AI optimize listings for Indian marketplaces?',
      answer: 'Our AI model is custom-tuned with Flipkart, Amazon, and Meesho algorithm guidelines. It targets search phrases specifically used by Indian buyers, handles localized search vocabulary, and optimizes descriptions to improve organic discovery.',
      open: false
    },
    {
      question: 'Is my Gemini API key required to use this tool?',
      answer: 'No, SellerOS includes pre-configured standard AI generations. However, you can add your own Gemini API key inside the settings panel to get higher rate limits and unlock custom brand voice styling features.',
      open: false
    },
    {
      question: 'Does it write bullets and back-end keywords?',
      answer: 'Yes! It generates high-converting bullet points, descriptive search-friendly product stories, and structures backend keywords formatted perfectly for upload sheets.',
      open: false
    },
    {
      question: 'Can I generate listings in multiple languages?',
      answer: 'Currently, the tool generates descriptions in optimized English (as preferred by Indian marketplace catalogs) but incorporates high-volume Hinglish search queries commonly used by shoppers.',
      open: false
    }
  ];
  constructor(
    private seoService: SeoService,
    private meta: Meta,
    private title: Title
  ) {
    this.title.setTitle('Free E-commerce Seller Tools for Flipkart, Amazon & Meesho | SellerOS');
    this.meta.updateTag({ name: 'description', content: 'SellerOS offers free e-commerce tools for Indian sellers — bulk image downloader, shipping label cropper, and AI-powered product listing generator for Flipkart, Amazon, and Meesho.' });
    this.meta.updateTag({ name: 'keywords', content: 'seller tools, flipkart tools, amazon seller, meesho tools, product listing, image downloader, label cropper, free e-commerce tools, indian seller tools' });
    this.meta.updateTag({ property: 'og:title', content: 'Free E-commerce Seller Tools | SellerOS' });
    this.meta.updateTag({ property: 'og:description', content: 'Free suite of productivity tools for Indian e-commerce sellers. Download product images, crop shipping labels, and generate AI-optimized listings.' });
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
            "Preloaded with Gemini AI capabilities"
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
}
