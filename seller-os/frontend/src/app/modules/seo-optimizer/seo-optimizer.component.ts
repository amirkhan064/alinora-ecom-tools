import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface SeoResult {
  title: string;
  features: string[];
  description: string;
  keywords: string[];
}

@Component({
  selector: 'app-seo-optimizer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './seo-optimizer.component.html',
  styleUrls: ['./seo-optimizer.component.css']
})
export class SeoOptimizerComponent {
  selectedFile: File | null = null;
  previewUrl: string | null = null;
  platform = signal<string>('Amazon India');
  context = signal<string>('');
  isGenerating = signal<boolean>(false);
  errorMsg = signal<string | null>(null);

  // Generative results structure from backend
  seoResult = signal<SeoResult | null>(null);

  // Clipboard success notification state tracking
  copiedStates: { [key: string]: boolean } = {};

  // Handle files selected from system browse dialog
  onFilesSelected(event: any): void {
    const file = event.target?.files?.[0];
    if (file) {
      this.processFile(file);
    }
  }

  // Handle drag-and-drop file drops
  onFileDrop(event: DragEvent): void {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      this.processFile(file);
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  private processFile(file: File): void {
    if (!file.type.startsWith('image/')) {
      this.errorMsg.set("Please upload a valid product image file (PNG, JPG, WebP).");
      return;
    }
    
    this.errorMsg.set(null);
    this.selectedFile = file;

    // Generate local object URL for preview frame
    if (this.previewUrl) {
      URL.revokeObjectURL(this.previewUrl);
    }
    this.previewUrl = URL.createObjectURL(file);
  }

  removeSelectedImage(): void {
    if (this.previewUrl) {
      URL.revokeObjectURL(this.previewUrl);
    }
    this.selectedFile = null;
    this.previewUrl = null;
    this.errorMsg.set(null);
    this.seoResult.set(null);
  }

  // Call the multimodal backend parser endpoint
  async generateSeo(): Promise<void> {
    if (!this.selectedFile) return;

    this.isGenerating.set(true);
    this.errorMsg.set(null);
    this.seoResult.set(null);

    const formData = new FormData();
    formData.append('image', this.selectedFile);
    formData.append('platform', this.platform());
    formData.append('additionalContext', this.context());

    try {
      const response = await fetch('http://localhost:3333/api/seo/generate', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server returned error status HTTP ${response.status}`);
      }

      const data = await response.json();
      
      // Safety mapping: ensure features & keywords are strictly arrays
      const mappedData: SeoResult = {
        title: data.title || '',
        features: Array.isArray(data.features) ? data.features : [],
        description: data.description || '',
        keywords: Array.isArray(data.keywords) ? data.keywords : []
      };

      this.seoResult.set(mappedData);

    } catch (err: any) {
      console.error("AI SEO Listing generation failure:", err);
      this.errorMsg.set(err.message || "Failed to generate AI SEO details. Please verify your GEMINI_API_KEY is configured in backend environment.");
    } finally {
      this.isGenerating.set(false);
    }
  }

  // General Clipboard Helper providing temporary visual feedback
  async copyText(text: string, key: string): Promise<void> {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.copiedStates[key] = true;
      setTimeout(() => {
        this.copiedStates[key] = false;
      }, 2000);
    } catch (err) {
      console.error("Clipboard copy failure:", err);
      alert("Browser clipboard write permissions denied.");
    }
  }

  // Specific copy helper grouping keywords into comma-separated strings
  async copyAllKeywords(): Promise<void> {
    const result = this.seoResult();
    if (!result || !result.keywords.length) return;
    
    const keywordsText = result.keywords.join(', ');
    await this.copyText(keywordsText, 'all_keywords');
  }
}
