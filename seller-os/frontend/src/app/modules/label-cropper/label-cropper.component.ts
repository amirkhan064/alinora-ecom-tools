import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-label-cropper',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './label-cropper.component.html',
  styleUrls: ['./label-cropper.component.css']
})
export class LabelCropperComponent {
  private http = inject(HttpClient);
  private apiEndpoint = 'http://localhost:3333/api/labels/process';

  // Config States
  selectedPlatform: 'flipkart' | 'amazon' | 'meesho' | 'myntra' = 'flipkart';
  uploadedFiles: File[] = [];
  sortBy: 'sku' | 'orderId' | 'date' = 'sku';
  sortOrder: 'asc' | 'desc' = 'asc';
  outputType: 'labels' | 'invoices' | 'zip' = 'labels';
  mergeLabels: boolean = false;
  customText: string = '';

  // Stepper/Process States
  processingStage: 'idle' | 'processing' | 'completed' | 'error' = 'idle';
  currentStep: number = 1; // 1: Platform, 2: Upload, 3: Configure, 4: Process
  errorMessage: string | null = null;
  downloadUrl: string | null = null;
  downloadFilename: string | null = null;

  // Drag & Drop State
  isDragActive: boolean = false;

  // self-diagnostics
  debugLogs: string[] = [];

  constructor() {
    this.logDebug('Label Cropper & Processor Component Initialized.');
  }

  logDebug(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    this.debugLogs.push(`[${timestamp}] ${message}`);
    console.log(`[LabelCropper] ${message}`);
  }

  // Navigation Steps
  setStep(step: number): void {
    if (step < 1 || step > 4) return;
    
    // Validations before moving forward
    if (step > 2 && this.uploadedFiles.length === 0) {
      this.errorMessage = 'Please upload at least one PDF file before proceeding.';
      this.currentStep = 2;
      return;
    }

    this.currentStep = step;
    this.errorMessage = null;
    this.logDebug(`Navigated to Step ${step}`);
  }

  // File Handlers
  onFilePicked(event: any): void {
    const filesList: FileList = event.target.files;
    this.addFiles(filesList);
    // Reset file input value so same file can be uploaded again if removed
    event.target.value = '';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragActive = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragActive = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragActive = false;

    if (event.dataTransfer && event.dataTransfer.files) {
      this.addFiles(event.dataTransfer.files);
    }
  }

  private addFiles(files: FileList): void {
    const validFiles: File[] = [];
    this.errorMessage = null;

    const existingKeys = new Set(this.uploadedFiles.map(f => `${f.name}_${f.size}`));

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        const key = `${file.name}_${file.size}`;
        if (!existingKeys.has(key)) {
          validFiles.push(file);
          existingKeys.add(key);
        } else {
          this.logDebug(`Skipped duplicate file: ${file.name}`);
        }
      } else {
        this.logDebug(`Skipped non-PDF file: ${file.name}`);
      }
    }

    if (validFiles.length > 0) {
      this.uploadedFiles = [...this.uploadedFiles, ...validFiles];
      this.logDebug(`Added ${validFiles.length} files. Total files: ${this.uploadedFiles.length}`);
      
      // Auto advance to step 3 if we were on step 2
      if (this.currentStep === 2) {
        this.setStep(3);
      }
    } else {
      if (this.uploadedFiles.length === 0) {
        this.errorMessage = 'Only PDF shipping label sheets or invoices are accepted.';
      }
    }
  }

  removeFile(index: number): void {
    const file = this.uploadedFiles[index];
    this.uploadedFiles.splice(index, 1);
    this.logDebug(`Removed file: ${file.name}. Total files remaining: ${this.uploadedFiles.length}`);
    
    if (this.uploadedFiles.length === 0) {
      this.setStep(2);
    }
  }

  clearAll(): void {
    this.uploadedFiles = [];
    this.processingStage = 'idle';
    this.currentStep = 1;
    this.errorMessage = null;
    this.downloadUrl = null;
    this.downloadFilename = null;
    this.logDebug('All states cleared and reset.');
  }

  // Core API integration logic
  processLabels(): void {
    if (this.uploadedFiles.length === 0) {
      this.errorMessage = 'Please upload at least one PDF file before processing.';
      return;
    }

    this.errorMessage = null;
    this.processingStage = 'processing';
    this.currentStep = 4;
    this.logDebug('Initiating API processing request...');

    const formData = new FormData();
    formData.append('platform', this.selectedPlatform);
    formData.append('marketplace', this.selectedPlatform); // Compatibility with alternative backend parameters
    formData.append('sortBy', this.sortBy);
    formData.append('sortOrder', this.sortOrder);
    formData.append('outputType', this.outputType);

    // Map outputType to invoiceFilter for backwards compatibility
    let invoiceFilterVal = 'onlyLabel';
    if (this.outputType === 'invoices') invoiceFilterVal = 'onlyInvoice';
    else if (this.outputType === 'zip') invoiceFilterVal = 'separateInvoice';
    formData.append('invoiceFilter', invoiceFilterVal);

    formData.append('mergeLabels', this.mergeLabels ? 'true' : 'false');
    formData.append('customText', this.customText);

    this.uploadedFiles.forEach(file => {
      formData.append('files', file, file.name);
    });

    this.http.post(this.apiEndpoint, formData, { responseType: 'blob' })
      .subscribe({
        next: (blob) => {
          this.logDebug('API processing completed successfully. Generating download payload...');
          
          try {
            // Check if backend returned JSON error hidden inside a blob
            if (blob.type === 'application/json') {
              const reader = new FileReader();
              reader.onload = (e: any) => {
                try {
                  const errorObj = JSON.parse(e.target.result);
                  this.errorMessage = errorObj.error || 'Label processing failed.';
                  this.processingStage = 'error';
                  this.logDebug(`Server returned JSON error: ${this.errorMessage}`);
                } catch {
                  this.errorMessage = 'Failed to process labels due to a server error.';
                  this.processingStage = 'error';
                }
              };
              reader.readAsText(blob);
              return;
            }

            // Configure file properties
            const fileExtension = this.outputType === 'zip' ? 'zip' : 'pdf';
            const contentType = this.outputType === 'zip' ? 'application/zip' : 'application/pdf';
            const blobObj = new Blob([blob], { type: contentType });
            
            this.downloadUrl = window.URL.createObjectURL(blobObj);
            this.downloadFilename = `selleros_${this.selectedPlatform}_${this.outputType}_${Date.now()}.${fileExtension}`;
            
            // Auto Trigger the download immediately for high productivity!
            this.triggerDownload();
            
            this.processingStage = 'completed';
            this.logDebug(`Payload generated and auto-downloaded: ${this.downloadFilename}`);
          } catch (err: any) {
            console.error('Payload generation failed:', err);
            this.errorMessage = `Failed to generate file download. Details: ${err.message || err}`;
            this.processingStage = 'error';
          }
        },
        error: (err) => {
          console.error('Labels API request failed:', err);
          this.processingStage = 'error';
          
          // Try to decode backend error if it comes back as error-JSON
          if (err.error instanceof Blob) {
            const reader = new FileReader();
            reader.onload = (e: any) => {
              try {
                const errorObj = JSON.parse(e.target.result);
                this.errorMessage = errorObj.error || 'Server processing error occurred.';
                this.logDebug(`API Error details: ${this.errorMessage}`);
              } catch {
                this.errorMessage = 'The processing request failed. Please check backend connection.';
              }
            };
            reader.readAsText(err.error);
          } else {
            this.errorMessage = err.error?.error || `Failed to connect to the SellerOS engine at ${this.apiEndpoint}. Ensure server is running.`;
          }
        }
      });
  }

  triggerDownload(): void {
    if (!this.downloadUrl || !this.downloadFilename) return;

    const link = document.createElement('a');
    link.href = this.downloadUrl;
    link.download = this.downloadFilename;
    document.body.appendChild(link);
    link.click();

    // Cleanup
    document.body.removeChild(link);
    this.logDebug(`Download link triggered manual check: ${this.downloadFilename}`);
  }
}
