import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import * as XLSX from 'xlsx';

@Component({
  selector: 'app-label-cropper',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './label-cropper.component.html',
  styleUrls: ['./label-cropper.component.css'],
})
export class LabelCropperComponent {
  private http = inject(HttpClient);
  private apiEndpoint = 'http://localhost:3333/api/labels/process';
  private scanEndpoint = 'http://localhost:3333/api/labels/scan';

  // Config States
  selectedPlatform: 'flipkart' | 'amazon' | 'meesho' | 'myntra' = 'flipkart';
  uploadedFiles: File[] = [];
  sortBy: 'sku' | 'orderId' | 'date' = 'sku';
  sortOrder: 'asc' | 'desc' = 'asc';
  outputType: 'labels' | 'invoices' | 'zip' = 'labels';
  mergeLabels: boolean = false;
  customText: string = '';
  sortOnly: boolean = false;

  // Order ID Filtering States
  filterByOrderIds: boolean = false;
  orderIdsInput: string = '';
  filterMode: 'include' | 'exclude' = 'include';
  parsedOrderIds: string[] = [];

  // Parent Labels Scan States
  isScanning: boolean = false;
  parentOrders: {
    orderId: string;
    isUnknown: boolean;
    skus: string[];
    date: string;
    pageCount: number;
    pageTypes: string[];
    pageIndices: number[];
    files: string[];
    selected: boolean;
  }[] = [];
  parentSummary: {
    totalFiles: number;
    totalPages: number;
    totalOrders: number;
    totalLabels: number;
    totalInvoices: number;
    unknownCount: number;
  } | null = null;
  parentOrdersSearchQuery: string = '';
  showParentOrdersModal: boolean = false;
  copyFeedback: string | null = null;

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

    const existingKeys = new Set(this.uploadedFiles.map((f) => `${f.name}_${f.size}`));

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
    this.logDebug(
      `Removed file: ${file.name}. Total files remaining: ${this.uploadedFiles.length}`,
    );

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
    this.sortOnly = false;
    this.filterByOrderIds = false;
    this.orderIdsInput = '';
    this.parsedOrderIds = [];
    this.parentOrders = [];
    this.parentSummary = null;
    this.showParentOrdersModal = false;
    this.logDebug('All states cleared and reset.');
  }

  onSortOnlyToggle(enabled: boolean): void {
    this.sortOnly = enabled;
    if (enabled) {
      this.mergeLabels = false;
      this.customText = '';
      this.logDebug('Sort-only mode enabled. Cropping and custom overlays will be skipped.');
    } else {
      this.logDebug('Cropping mode re-enabled.');
    }
  }

  // Order ID filter management
  onOrderIdsInputChange(): void {
    this.parsedOrderIds = this.extractOrderIdsFromString(this.orderIdsInput);
    this.logDebug(`Parsed ${this.parsedOrderIds.length} Order IDs from input.`);
  }

  private extractOrderIdsFromString(raw: string): string[] {
    if (!raw) return [];
    const tokens = raw.split(/[\r\n,;\t\s]+/);
    const cleaned = tokens
      .map((t) => t.trim().replace(/^[:#\s"']+|[:#\s"']+$/g, ''))
      .filter((t) => t.length > 0);
    return Array.from(new Set(cleaned));
  }

  cleanAndDeduplicateOrderIds(): void {
    if (this.parsedOrderIds.length === 0) return;
    this.orderIdsInput = this.parsedOrderIds.join('\n');
    this.logDebug(`Cleaned and formatted ${this.parsedOrderIds.length} Order IDs.`);
  }

  clearOrderIds(): void {
    this.orderIdsInput = '';
    this.parsedOrderIds = [];
    this.logDebug('Cleared Order IDs filter.');
  }

  // Handle uploading .txt, .csv, .xlsx, .xls file for Order IDs
  onOrderIdsFilePicked(event: any): void {
    const file = event.target.files?.[0];
    if (!file) return;

    this.logDebug(`Loading Order IDs from file: ${file.name}`);
    const ext = file.name.split('.').pop()?.toLowerCase();

    if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

          const extracted: string[] = [];
          for (const row of rows) {
            if (!Array.isArray(row)) continue;
            for (const cell of row) {
              if (cell === null || cell === undefined) continue;
              const cellStr = String(cell).trim().replace(/^[:#\s"']+|[:#\s"']+$/g, '');
              if (
                cellStr.length >= 4 &&
                !/^(order|id|sku|date|status|no|number|item|sr|sno)$/i.test(cellStr)
              ) {
                extracted.push(cellStr);
              }
            }
          }

          const unique = Array.from(new Set(extracted));
          this.orderIdsInput = unique.join('\n');
          this.onOrderIdsInputChange();
          this.filterByOrderIds = true;
          this.logDebug(`Extracted ${unique.length} Order IDs from spreadsheet ${file.name}`);
        } catch (err: any) {
          console.error('Error parsing Excel file:', err);
          this.errorMessage = `Failed to parse Excel file: ${err.message || err}`;
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      // Plain text or CSV
      const reader = new FileReader();
      reader.onload = (e: any) => {
        try {
          const text = e.target.result as string;
          const extracted = this.extractOrderIdsFromString(text).filter(
            (t) => !/^(order|id|order_id|orderid|sr|sno)$/i.test(t)
          );
          this.orderIdsInput = extracted.join('\n');
          this.onOrderIdsInputChange();
          this.filterByOrderIds = true;
          this.logDebug(`Extracted ${extracted.length} Order IDs from ${file.name}`);
        } catch (err: any) {
          console.error('Error parsing text/csv file:', err);
          this.errorMessage = `Failed to read file: ${err.message || err}`;
        }
      };
      reader.readAsText(file);
    }

    event.target.value = '';
  }

  isOrderMatchedWithFilter(orderId: string): boolean {
    if (!orderId || !this.parsedOrderIds || this.parsedOrderIds.length === 0) return false;
    const cleanId = orderId.trim().toUpperCase().replace(/^[:#\s"']+|[:#\s"']+$/g, '');
    if (cleanId.startsWith('UNKNOWN')) return false;

    for (const target of this.parsedOrderIds) {
      const cleanTarget = target.trim().toUpperCase().replace(/^[:#\s"']+|[:#\s"']+$/g, '');
      if (!cleanTarget) continue;

      // Exact match
      if (cleanId === cleanTarget) return true;

      // With / without "OD"
      const idNoOD = cleanId.startsWith('OD') ? cleanId.substring(2) : cleanId;
      const targetNoOD = cleanTarget.startsWith('OD') ? cleanTarget.substring(2) : cleanTarget;
      if (idNoOD === targetNoOD && idNoOD.length >= 6) return true;

      // With / without hyphens (e.g. Amazon)
      const stripId = cleanId.replace(/[\s-]/g, '');
      const stripTarget = cleanTarget.replace(/[\s-]/g, '');
      if (stripId === stripTarget) return true;

      // Substring match for long numeric IDs (e.g. tracking or 10+ digit order ids)
      if (stripTarget.length >= 10 && stripId.includes(stripTarget)) return true;
      if (stripId.length >= 10 && stripTarget.includes(stripId)) return true;
    }
    return false;
  }

  // Scan Parent Labels from uploaded PDF(s)
  scanParentLabels(): void {
    if (this.uploadedFiles.length === 0) {
      this.errorMessage = 'Please upload at least one PDF file to scan.';
      return;
    }

    this.isScanning = true;
    this.errorMessage = null;
    this.logDebug('Scanning parent PDF for detected orders and SKUs...');

    const formData = new FormData();
    formData.append('platform', this.selectedPlatform);
    if (this.orderIdsInput) {
      formData.append('orderIds', this.orderIdsInput);
      formData.append('filterMode', this.filterMode);
    }
    this.uploadedFiles.forEach((file) => {
      formData.append('files', file, file.name);
    });

    this.http.post<any>(this.scanEndpoint, formData).subscribe({
      next: (res) => {
        this.isScanning = false;
        if (res && res.orders) {
          this.parentSummary = res.summary;
          const hasPastedFilter = this.parsedOrderIds.length > 0;
          let matchedCount = 0;

          this.parentOrders = res.orders.map((o: any) => {
            const isMatch = hasPastedFilter
              ? (Boolean(o.matchedFilter) || this.isOrderMatchedWithFilter(o.orderId))
              : true;
            if (isMatch && hasPastedFilter) matchedCount++;
            return {
              ...o,
              selected: isMatch,
            };
          });

          // If user had pasted Order IDs but 0 matched (e.g. unknown orders), default to all selected
          if (hasPastedFilter && matchedCount === 0) {
            this.logDebug(
              `None of the ${this.parsedOrderIds.length} pasted IDs matched. Defaulting to all selected.`
            );
            this.parentOrders.forEach((o) => (o.selected = true));
          } else if (hasPastedFilter) {
            this.logDebug(
              `Auto-selected ${matchedCount} matched orders out of ${this.parsedOrderIds.length} pasted IDs.`
            );
          }

          this.showParentOrdersModal = true;
          this.logDebug(
            `Scan complete: Found ${res.orders.length} orders across ${res.summary?.totalPages} pages (${matchedCount} selected).`
          );
        } else {
          this.errorMessage = 'Scan returned empty response.';
        }
      },
      error: (err) => {
        this.isScanning = false;
        console.error('Scan failed:', err);
        const serverMsg =
          typeof err.error === 'string'
            ? err.error
            : err.error?.error || err.message;
        this.errorMessage =
          serverMsg ||
          `Failed to scan parent label PDF (HTTP ${err.status || 'unknown'}: ${err.statusText || 'Connection error'}).`;
        this.logDebug(`Scan error: ${this.errorMessage}`);
      },
    });
  }

  get filteredParentOrders(): any[] {
    if (!this.parentOrdersSearchQuery.trim()) {
      return this.parentOrders;
    }
    const q = this.parentOrdersSearchQuery.toLowerCase();
    return this.parentOrders.filter(
      (o) =>
        o.orderId.toLowerCase().includes(q) ||
        o.skus.some((sku: string) => sku.toLowerCase().includes(q))
    );
  }

  get selectedParentOrdersCount(): number {
    return this.parentOrders.filter((o) => o.selected).length;
  }

  toggleParentOrderSelection(order: any): void {
    order.selected = !order.selected;
  }

  selectAllParentOrders(select: boolean): void {
    this.parentOrders.forEach((o) => (o.selected = select));
  }

  syncParentOrdersWithFilter(): void {
    if (this.parsedOrderIds.length === 0) return;
    let matchedCount = 0;
    this.parentOrders.forEach((o) => {
      const isMatch = Boolean(o.matchedFilter) || this.isOrderMatchedWithFilter(o.orderId);
      o.selected = isMatch;
      if (isMatch) matchedCount++;
    });
    this.logDebug(`Synced parent list with input: ${matchedCount} orders matched.`);
  }

  applyParentOrdersSelection(): void {
    const selected = this.parentOrders
      .filter((o) => o.selected && !o.isUnknown)
      .map((o) => o.orderId);
    if (selected.length === 0) {
      this.errorMessage = 'Please select at least one order to apply.';
      return;
    }
    this.orderIdsInput = selected.join('\n');
    this.onOrderIdsInputChange();
    this.filterByOrderIds = true;
    this.filterMode = 'include';
    this.showParentOrdersModal = false;
    this.logDebug(`Applied ${selected.length} selected orders to the filter.`);
  }

  applyAndDownloadParentOrders(): void {
    this.applyParentOrdersSelection();
    this.processLabels();
  }

  copyToClipboard(text: string): void {
    navigator.clipboard?.writeText(text);
    this.copyFeedback = text;
    setTimeout(() => {
      if (this.copyFeedback === text) this.copyFeedback = null;
    }, 2000);
  }

  // Core API integration logic
  processLabels(): void {
    if (this.uploadedFiles.length === 0) {
      this.errorMessage = 'Please upload at least one PDF file before processing.';
      return;
    }

    if (this.filterByOrderIds) {
      if (this.parsedOrderIds.length === 0) {
        this.errorMessage =
          'Please enter or upload at least one Order ID to filter, or turn off the Order ID filter.';
        return;
      }
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
    formData.append('sortOnly', this.sortOnly ? 'true' : 'false');
    formData.append('skipCropping', this.sortOnly ? 'true' : 'false');

    if (this.filterByOrderIds && this.parsedOrderIds.length > 0) {
      formData.append('orderIds', JSON.stringify(this.parsedOrderIds));
      formData.append('filterMode', this.filterMode);
      this.logDebug(
        `Order filtering active: ${this.parsedOrderIds.length} orders (${this.filterMode} mode).`
      );
    }

    this.uploadedFiles.forEach((file) => {
      formData.append('files', file, file.name);
    });

    this.http.post(this.apiEndpoint, formData, { responseType: 'blob' }).subscribe({
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
          this.errorMessage =
            err.error?.error ||
            `Failed to connect to the SellerOS engine at ${this.apiEndpoint}. Ensure server is running.`;
        }
      },
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
