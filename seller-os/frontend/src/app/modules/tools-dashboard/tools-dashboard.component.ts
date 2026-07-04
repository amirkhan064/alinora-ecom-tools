import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

interface ToolItem {
  id: string;
  title: string;
  description: string;
  icon: string;
  route: string;
  badge?: string;
  category: string;
  gradient: string;
}

@Component({
  selector: 'app-tools-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './tools-dashboard.component.html',
  styleUrls: ['./tools-dashboard.component.css']
})
export class ToolsDashboardComponent {
  tools: ToolItem[] = [
    {
      id: 'image-downloader',
      title: 'Bulk Image Downloader',
      description: 'Fetch, clean, and download high-resolution catalog images from Flipkart, Amazon, and other e-commerce URLs instantly.',
      icon: 'download_for_offline',
      route: '/app/image-downloader',
      category: 'Cataloging',
      gradient: 'linear-gradient(135deg, #3b82f6, #1d4ed8)'
    },
    {
      id: 'watermark-remover',
      title: 'AI Watermark Remover',
      description: 'Erase logos, text, stamps, and copyright marks from product photos. Uses local texture synthesis to keep fabric and background detail.',
      icon: 'branding_watermark',
      route: '/app/watermark-remover',
      badge: 'Improved',
      category: 'AI Design',
      gradient: 'linear-gradient(135deg, #6366f1, #4f46e5)'
    },
    {
      id: 'label-cropper',
      title: 'Shipping Label Cropper',
      description: 'Upload A4 PDF shipping sheets to automatically crop, rotate, and align individual barcode labels for thermal printing.',
      icon: 'crop_free',
      route: '/app/label-cropper',
      category: 'Logistics',
      gradient: 'linear-gradient(135deg, #ec4899, #be185d)'
    },
    {
      id: 'bulk-cropper',
      title: 'Bulk Image Cropper',
      description: 'Resize, crop, and pad whole batches of catalog photos to standard aspect ratios (1:1, 3:4) in seconds.',
      icon: 'grid_view',
      route: '/app/bulk-cropper',
      category: 'Processing',
      gradient: 'linear-gradient(135deg, #f59e0b, #d97706)'
    },
    {
      id: 'listing-builder',
      title: 'AI Listing Builder',
      description: 'Generate high-conversion SEO-optimized titles, descriptions, bullet points, and search tags for your marketplace listings.',
      icon: 'auto_awesome',
      route: '/app/listing-builder',
      badge: 'AI Powered',
      category: 'Marketing',
      gradient: 'linear-gradient(135deg, #10b981, #047857)'
    }
  ];
}
