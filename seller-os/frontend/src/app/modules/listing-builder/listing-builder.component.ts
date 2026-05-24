import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface PlatformListing {
  seoScore: {
    overall: number;
    title: number;
    description: number;
    keywords: number;
  };
  title: string;
  bullets: string[];
  description: string;
  keywords: string[];
  attributes: {
    [key: string]: string;
    material: string;
    plating: string;
    stoneType: string;
    occasion: string;
    netQuantity: string;
  };
  taxAndPricing: {
    suggestedPrice: string;
    competitivePrice: string;
    marginNote: string;
    hsnCode: string;
    category: string;
  };
}

interface CatalogResults {
  [platform: string]: PlatformListing;
}

@Component({
  selector: 'app-listing-builder',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './listing-builder.component.html',
  styleUrls: ['./listing-builder.component.css']
})
export class ListingBuilderComponent {
  Object = Object;

  // Target platforms selector state mapping (multiple choices allowed)
  selectedPlatforms: { [key: string]: boolean } = {
    'Amazon India': true,
    'Flipkart': false,
    'Meesho': false
  };

  // Choose Input Method ('image', 'text', 'url')
  inputMethod: 'image' | 'text' | 'url' = 'image';

  // State holdings
  selectedFile: File | null = null;
  previewUrl: string | null = null;
  rawTitle = '';
  rawDescription = '';
  competitorUrl = '';
  additionalContext = '';

  isGenerating = signal<boolean>(false);
  errorMsg = signal<string | null>(null);

  // Frosted Glass Lead Gating Modal States
  showLeadModal = false;
  leadEmail = '';
  leadError = '';
  isSavingLead = false;
  private pendingDownloadCallback: (() => void) | null = null;

  // Core results dictionary holding compiler outputs
  catalogResults = signal<CatalogResults | null>(null);

  // Active results horizontal tab selection
  activeTab = '';

  // clipboard success state trackers
  copiedStates: { [key: string]: boolean } = {};

  // Partial node refresh loading trackers
  isRefreshingNode: { [key: string]: boolean } = {
    title: false,
    keywords: false,
    taxAndPricing: false
  };

  // Toggle active platform selection checkboxes
  togglePlatform(platform: string): void {
    this.selectedPlatforms[platform] = !this.selectedPlatforms[platform];
  }

  // Toggle vertical accordion rows
  setInputMethod(method: 'image' | 'text' | 'url'): void {
    this.inputMethod = method;
    this.errorMsg.set(null);
  }

  // Handle files selected via file input browse dialog
  onFilesSelected(event: any): void {
    const file = event.target?.files?.[0];
    if (file) {
      this.processFile(file);
    }
  }

  // Handle drag-and-drop drops
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
      this.errorMsg.set("Please upload a valid product photo (PNG, JPG, WebP).");
      return;
    }
    this.errorMsg.set(null);
    this.selectedFile = file;

    // Intercept with HTML5 off-screen canvas downscaler
    const tempUrl = URL.createObjectURL(file);
    const img = new Image();
    img.src = tempUrl;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      let width = img.naturalWidth;
      let height = img.naturalHeight;
      
      const maxWidth = 400;
      if (width > maxWidth) {
        height = (maxWidth / width) * height;
        width = maxWidth;
      }
      
      canvas.width = width;
      canvas.height = height;
      
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
      }
      
      const base64 = canvas.toDataURL('image/jpeg', 0.7);
      
      if (this.previewUrl && this.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(this.previewUrl);
      }
      
      this.previewUrl = base64;
      URL.revokeObjectURL(tempUrl);
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(tempUrl);
      this.previewUrl = tempUrl;
    };
  }

  removeSelectedImage(): void {
    if (this.previewUrl && this.previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(this.previewUrl);
    }
    this.selectedFile = null;
    this.previewUrl = null;
    this.errorMsg.set(null);
  }

  // Call backend compiler
  async generateListing(): Promise<void> {
    const chosenPlatforms = Object.keys(this.selectedPlatforms).filter(p => this.selectedPlatforms[p]);
    if (chosenPlatforms.length === 0) {
      this.errorMsg.set("Please select at least one target marketplace platform.");
      return;
    }

    this.isGenerating.set(true);
    this.errorMsg.set(null);
    this.catalogResults.set(null);

    const formData = new FormData();
    formData.append('platforms', JSON.stringify(chosenPlatforms));
    formData.append('inputMethod', this.inputMethod);
    formData.append('additionalContext', this.additionalContext);

    if (this.inputMethod === 'image' && this.selectedFile) {
      formData.append('image', this.selectedFile);
    } else if (this.inputMethod === 'text') {
      formData.append('rawTitle', this.rawTitle);
      formData.append('rawDescription', this.rawDescription);
    } else if (this.inputMethod === 'url') {
      formData.append('competitorUrl', this.competitorUrl);
    }

    try {
      const response = await fetch('http://localhost:3333/api/catalog/build', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Server failed with status HTTP ${response.status}`);
      }

      const data = await response.json();
      this.catalogResults.set(data);

      // Default the active tab to the first selected platform
      this.activeTab = chosenPlatforms[0];

    } catch (err: any) {
      console.error("AI Catalog Engine compile failure:", err);
      this.errorMsg.set(err.message || "Failed to compile product catalog. Verify your Gemini API credentials.");
    } finally {
      this.isGenerating.set(false);
    }
  }

  // Granular partial refreshes for Title, Keywords, or Price node properties
  async refreshNode(nodeType: 'title' | 'keywords' | 'taxAndPricing'): Promise<void> {
    const platform = this.activeTab;
    const currentResults = this.catalogResults();
    if (!platform || !currentResults || !currentResults[platform]) return;

    this.isRefreshingNode[nodeType] = true;
    this.errorMsg.set(null);

    try {
      const response = await fetch('http://localhost:3333/api/catalog/refresh-node', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          platform,
          nodeType,
          currentDetails: currentResults[platform]
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Refresh failed with status HTTP ${response.status}`);
      }

      const refreshedNode = await response.json();

      // Merge and update results
      const updatedPlatformListing = {
        ...currentResults[platform],
        ...refreshedNode
      };

      this.catalogResults.set({
        ...currentResults,
        [platform]: updatedPlatformListing
      });

    } catch (err: any) {
      console.error(`Isolated refresh failed for ${nodeType}:`, err);
      this.errorMsg.set(err.message || "Failed to update node. Check backend logs.");
    } finally {
      this.isRefreshingNode[nodeType] = false;
    }
  }

  // Clipboard copy utilities with confirmation checks active for 1.5 seconds
  async copyText(text: string, key: string): Promise<void> {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.copiedStates[key] = true;
      setTimeout(() => {
        this.copiedStates[key] = false;
      }, 1500); // Strict 1.5 second confirmation checkmark
    } catch (err) {
      console.error("Clipboard copy exception:", err);
      alert("Clipboard write blocked by browser permission gates.");
    }
  }

  // Frosted Glass Lead Gating Modal Control Logic
  closeLeadModal(): void {
    this.showLeadModal = false;
    this.leadEmail = '';
    this.leadError = '';
    this.isSavingLead = false;
    this.pendingDownloadCallback = null;
  }

  async submitLead(): Promise<void> {
    if (!this.leadEmail) return;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(this.leadEmail)) {
      this.leadError = 'Please enter a valid business email address.';
      return;
    }

    this.leadError = '';
    this.isSavingLead = true;

    try {
      const response = await fetch('http://localhost:3333/api/lead/capture', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email: this.leadEmail })
      });

      if (!response.ok) {
        throw new Error('Failed to record lead');
      }

      localStorage.setItem('isGatedUser', 'true');
      this.showLeadModal = false;
      this.isSavingLead = false;

      if (this.pendingDownloadCallback) {
        this.pendingDownloadCallback();
        this.pendingDownloadCallback = null;
      }
    } catch (err) {
      console.warn('Lead capture offline fallback:', err);
      localStorage.setItem('isGatedUser', 'true');
      this.showLeadModal = false;
      this.isSavingLead = false;
      if (this.pendingDownloadCallback) {
        this.pendingDownloadCallback();
        this.pendingDownloadCallback = null;
      }
    }
  }

  // EXPORT CURRENT GENERATION RESULTS AS A CLEAN JSON FILE
  exportListing(): void {
    const currentResults = this.catalogResults();
    if (!currentResults) return;

    /* GATING DISABLED FOR NOW - UNCOMMENT TO RE-ENABLE LEAD CAPTURE
    if (localStorage.getItem('isGatedUser') !== 'true') {
      this.pendingDownloadCallback = () => this.executeExportListing();
      this.showLeadModal = true;
      return;
    }
    */

    this.executeExportListing();
  }

  private executeExportListing(): void {
    const currentResults = this.catalogResults();
    if (!currentResults) return;

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentResults, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `selleros_catalog_listing_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }
}
