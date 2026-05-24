import { Component, ElementRef, HostListener, ViewChild, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import JSZip from 'jszip';

interface CropperImage {
  id: string;
  name: string;
  url: string;
  file: File;
  // Relative crop parameters (0.0 to 1.0) of the image
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
  // Native dimensions loaded dynamically
  width?: number;
  height?: number;
  // Dynamic sync success feedback animation trigger
  syncSuccess?: boolean;
}

@Component({
  selector: 'app-bulk-cropper',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './bulk-cropper.component.html',
  styleUrls: ['./bulk-cropper.component.css']
})
export class BulkCropperComponent {
  images = signal<CropperImage[]>([]);
  activeIndex = signal<number>(-1);
  isDragging = false;
  dragType: string = '';
  isProcessing = signal<boolean>(false);
  showLimitWarning = signal<boolean>(false);

  // Frosted Glass Lead Gating Modal States
  showLeadModal = false;
  leadEmail = '';
  leadError = '';
  isSavingLead = false;
  private pendingDownloadCallback: (() => void) | null = null;

  // Active aspect ratio preset (null indicates aspect-unconstrained "Free Size")
  activeAspectRatio = signal<number | null>(null);

  // In-memory drag coordinate state (pixels relative to displayed container size)
  cropLeft = 20;
  cropTop = 20;
  cropWidth = 160;
  cropHeight = 160;

  // Display dimensions of active image container
  displayImageWidth = 0;
  displayImageHeight = 0;

  startX = 0;
  startY = 0;
  startLeft = 0;
  startTop = 0;
  startWidth = 0;
  startHeight = 0;

  @ViewChild('workspaceImage', { static: false }) workspaceImage!: ElementRef<HTMLImageElement>;
  @ViewChild('cropContainerRef', { static: false }) cropContainerRef!: ElementRef<HTMLDivElement>;

  // Check if active image is set
  get activeImage(): CropperImage | null {
    const idx = this.activeIndex();
    const imgs = this.images();
    return idx >= 0 && idx < imgs.length ? imgs[idx] : null;
  }

  // Handle file drop/selection
  onFilesSelected(event: any): void {
    const filesList = event.target.files;
    if (filesList) {
      this.ingestFiles(Array.from(filesList));
    }
  }

  onFileDrop(event: DragEvent): void {
    event.preventDefault();
    const filesList = event.dataTransfer?.files;
    if (filesList) {
      this.ingestFiles(Array.from(filesList));
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  private compressPreview(file: File): Promise<{ base64: string, width: number, height: number }> {
    return new Promise((resolve) => {
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
        URL.revokeObjectURL(tempUrl);
        
        resolve({
          base64,
          width: img.naturalWidth,
          height: img.naturalHeight
        });
      };
      
      img.onerror = () => {
        URL.revokeObjectURL(tempUrl);
        resolve({
          base64: '',
          width: 0,
          height: 0
        });
      };
    });
  }

  private async ingestFiles(fileList: File[]): Promise<void> {
    const validFiles = fileList.filter(f => f.type.startsWith('image/'));
    const currentImgs = this.images();
    
    // Strict 20 image cap
    if (currentImgs.length + validFiles.length > 20) {
      this.showLimitWarning.set(true);
      setTimeout(() => this.showLimitWarning.set(false), 5000);
      return;
    }

    this.isProcessing.set(true);
    const newImgs: CropperImage[] = [];

    try {
      for (let i = 0; i < validFiles.length; i++) {
        const file = validFiles[i];
        const res = await this.compressPreview(file);
        newImgs.push({
          id: `crop_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 5)}`,
          name: file.name,
          url: res.base64 || '',
          file: file,
          cropX: 0.1,
          cropY: 0.1,
          cropW: 0.8,
          cropH: 0.8,
          width: res.width,
          height: res.height
        });
      }

      if (newImgs.length > 0) {
        this.images.set([...currentImgs, ...newImgs]);
        if (this.activeIndex() === -1) {
          this.selectImage(0);
        }
      }
    } catch (err) {
      console.error('File ingestion failed:', err);
    } finally {
      this.isProcessing.set(false);
    }
  }

  selectImage(index: number): void {
    // Before switching, save current pixel coordinates to relative crop of the active image
    this.saveActiveRelativeCrop();

    this.activeIndex.set(index);
    const active = this.activeImage;
    if (active) {
      // Crop coordinates will be restored when the image element finishes loading in DOM
      setTimeout(() => this.updateCropFromRelative());
    }
  }

  removeImage(index: number, event: MouseEvent): void {
    event.stopPropagation();
    const current = this.images();
    const active = this.activeIndex();
    
    const imgUrl = current[index].url;
    if (imgUrl && imgUrl.startsWith('blob:')) {
      URL.revokeObjectURL(imgUrl);
    }
    const updated = current.filter((_, i) => i !== index);
    this.images.set(updated);

    if (updated.length === 0) {
      this.activeIndex.set(-1);
    } else if (active === index) {
      this.selectImage(Math.max(0, index - 1));
    } else if (active > index) {
      this.activeIndex.set(active - 1);
    }
  }

  clearWorkspace(): void {
    this.images().forEach(img => {
      if (img.url && img.url.startsWith('blob:')) {
        URL.revokeObjectURL(img.url);
      }
    });
    this.images.set([]);
    this.activeIndex.set(-1);
    this.activeAspectRatio.set(null);
  }

  // Set crop frame display when active image container scales/loads in viewport
  onImageLoaded(event: Event): void {
    const imgEl = event.target as HTMLImageElement;
    this.displayImageWidth = imgEl.clientWidth;
    this.displayImageHeight = imgEl.clientHeight;
    
    // Auto-update native resolution in active metadata if missing
    const active = this.activeImage;
    if (active && (!active.width || !active.height)) {
      active.width = imgEl.naturalWidth;
      active.height = imgEl.naturalHeight;
    }

    this.updateCropFromRelative();
  }

  @HostListener('window:resize')
  onResize(): void {
    if (this.workspaceImage && this.workspaceImage.nativeElement) {
      this.displayImageWidth = this.workspaceImage.nativeElement.clientWidth;
      this.displayImageHeight = this.workspaceImage.nativeElement.clientHeight;
      this.updateCropFromRelative();
    }
  }

  // Set active aspect ratio preset locks
  setAspectRatio(ratio: number | null): void {
    this.activeAspectRatio.set(ratio);
    if (ratio !== null && this.displayImageWidth > 0 && this.displayImageHeight > 0) {
      // Re-scale the width and height matching ratio inside container boundaries
      let targetW = this.cropWidth;
      let targetH = targetW / ratio;

      if (targetH > this.displayImageHeight - this.cropTop) {
        targetH = this.displayImageHeight - this.cropTop;
        targetW = targetH * ratio;
      }
      if (targetW > this.displayImageWidth - this.cropLeft) {
        targetW = this.displayImageWidth - this.cropLeft;
        targetH = targetW / ratio;
      }

      // If dimensions fall below min boundaries, lock to minimum ratios
      const minSize = 30;
      if (targetW < minSize) {
        targetW = minSize;
        targetH = minSize / ratio;
      }
      if (targetH < minSize) {
        targetH = minSize;
        targetW = minSize * ratio;
      }

      this.cropWidth = Math.round(targetW);
      this.cropHeight = Math.round(targetH);
      this.clampCropBox();
      this.saveActiveRelativeCrop();
    }
  }

  // Restore pixel crop coordinates based on the active image's relative crop percentage
  private updateCropFromRelative(): void {
    const active = this.activeImage;
    if (active && this.displayImageWidth > 0 && this.displayImageHeight > 0) {
      this.cropLeft = Math.round(active.cropX * this.displayImageWidth);
      this.cropTop = Math.round(active.cropY * this.displayImageHeight);
      this.cropWidth = Math.round(active.cropW * this.displayImageWidth);
      this.cropHeight = Math.round(active.cropH * this.displayImageHeight);
      this.clampCropBox();
    }
  }

  // Save current active image pixel offsets into relative percentages (0.0 to 1.0)
  private saveActiveRelativeCrop(): void {
    const active = this.activeImage;
    if (active && this.displayImageWidth > 0 && this.displayImageHeight > 0) {
      active.cropX = this.cropLeft / this.displayImageWidth;
      active.cropY = this.cropTop / this.displayImageHeight;
      active.cropW = this.cropWidth / this.displayImageWidth;
      active.cropH = this.cropHeight / this.displayImageHeight;
    }
  }

  // DRAGGING AND RESIZING MOUSE LISTENERS (Custom Canvas Cropper Logic)
  startDrag(event: MouseEvent, type: string): void {
    event.preventDefault();
    event.stopPropagation();
    
    this.isDragging = true;
    this.dragType = type;
    this.startX = event.clientX;
    this.startY = event.clientY;

    this.startLeft = this.cropLeft;
    this.startTop = this.cropTop;
    this.startWidth = this.cropWidth;
    this.startHeight = this.cropHeight;
  }

  @HostListener('document:mousemove', ['$event'])
  dragMove(event: MouseEvent): void {
    if (!this.isDragging) return;

    const deltaX = event.clientX - this.startX;
    const deltaY = event.clientY - this.startY;

    const minSize = 30;
    const ratio = this.activeAspectRatio();

    if (ratio !== null) {
      // ==========================================
      // ASPECT RATIO IS LOCKED! Enforce ratio scale
      // ==========================================
      switch (this.dragType) {
        case 'box':
          this.cropLeft = this.startLeft + deltaX;
          this.cropTop = this.startTop + deltaY;
          break;

        case 'bottom-right':
          this.cropWidth = this.startWidth + deltaX;
          this.cropHeight = this.cropWidth / ratio;
          if (this.cropWidth < minSize) {
            this.cropWidth = minSize;
            this.cropHeight = minSize / ratio;
          }
          if (this.cropHeight < minSize) {
            this.cropHeight = minSize;
            this.cropWidth = minSize * ratio;
          }
          break;

        case 'bottom-left':
          this.cropWidth = this.startWidth - deltaX;
          this.cropHeight = this.cropWidth / ratio;
          if (this.cropWidth < minSize) {
            this.cropWidth = minSize;
            this.cropHeight = minSize / ratio;
          }
          this.cropLeft = this.startLeft + this.startWidth - this.cropWidth;
          break;

        case 'top-right':
          this.cropWidth = this.startWidth + deltaX;
          this.cropHeight = this.cropWidth / ratio;
          if (this.cropWidth < minSize) {
            this.cropWidth = minSize;
            this.cropHeight = minSize / ratio;
          }
          this.cropTop = this.startTop + this.startHeight - this.cropHeight;
          break;

        case 'top-left':
          this.cropWidth = this.startWidth - deltaX;
          this.cropHeight = this.cropWidth / ratio;
          if (this.cropWidth < minSize) {
            this.cropWidth = minSize;
            this.cropHeight = minSize / ratio;
          }
          this.cropLeft = this.startLeft + this.startWidth - this.cropWidth;
          this.cropTop = this.startTop + this.startHeight - this.cropHeight;
          break;

        case 'right':
        case 'bottom':
          this.cropWidth = this.startWidth + deltaX;
          this.cropHeight = this.cropWidth / ratio;
          if (this.cropWidth < minSize) {
            this.cropWidth = minSize;
            this.cropHeight = minSize / ratio;
          }
          break;

        case 'left':
        case 'top':
          this.cropWidth = this.startWidth - deltaX;
          this.cropHeight = this.cropWidth / ratio;
          if (this.cropWidth < minSize) {
            this.cropWidth = minSize;
            this.cropHeight = minSize / ratio;
          }
          this.cropLeft = this.startLeft + this.startWidth - this.cropWidth;
          this.cropTop = this.startTop + this.startHeight - this.cropHeight;
          break;
      }
    } else {
      // ==========================================
      // FREE SIZE: Aspect-unconstrained cropping
      // ==========================================
      switch (this.dragType) {
        case 'box':
          this.cropLeft = this.startLeft + deltaX;
          this.cropTop = this.startTop + deltaY;
          break;
        
        // Corners
        case 'top-left':
          this.cropLeft = this.startLeft + deltaX;
          this.cropTop = this.startTop + deltaY;
          this.cropWidth = this.startWidth - deltaX;
          this.cropHeight = this.startHeight - deltaY;
          if (this.cropWidth < minSize) {
            this.cropLeft = this.startLeft + this.startWidth - minSize;
            this.cropWidth = minSize;
          }
          if (this.cropHeight < minSize) {
            this.cropTop = this.startTop + this.startHeight - minSize;
            this.cropHeight = minSize;
          }
          break;

        case 'top-right':
          this.cropTop = this.startTop + deltaY;
          this.cropWidth = this.startWidth + deltaX;
          this.cropHeight = this.startHeight - deltaY;
          if (this.cropWidth < minSize) this.cropWidth = minSize;
          if (this.cropHeight < minSize) {
            this.cropTop = this.startTop + this.startHeight - minSize;
            this.cropHeight = minSize;
          }
          break;

        case 'bottom-left':
          this.cropLeft = this.startLeft + deltaX;
          this.cropWidth = this.startWidth - deltaX;
          this.cropHeight = this.startHeight + deltaY;
          if (this.cropWidth < minSize) {
            this.cropLeft = this.startLeft + this.startWidth - minSize;
            this.cropWidth = minSize;
          }
          if (this.cropHeight < minSize) this.cropHeight = minSize;
          break;

        case 'bottom-right':
          this.cropWidth = this.startWidth + deltaX;
          this.cropHeight = this.startHeight + deltaY;
          if (this.cropWidth < minSize) this.cropWidth = minSize;
          if (this.cropHeight < minSize) this.cropHeight = minSize;
          break;

        // Edges
        case 'top':
          this.cropTop = this.startTop + deltaY;
          this.cropHeight = this.startHeight - deltaY;
          if (this.cropHeight < minSize) {
            this.cropTop = this.startTop + this.startHeight - minSize;
            this.cropHeight = minSize;
          }
          break;

        case 'bottom':
          this.cropHeight = this.startHeight + deltaY;
          if (this.cropHeight < minSize) this.cropHeight = minSize;
          break;

        case 'left':
          this.cropLeft = this.startLeft + deltaX;
          this.cropWidth = this.startWidth - deltaX;
          if (this.cropWidth < minSize) {
            this.cropLeft = this.startLeft + this.startWidth - minSize;
            this.cropWidth = minSize;
          }
          break;

        case 'right':
          this.cropWidth = this.startWidth + deltaX;
          if (this.cropWidth < minSize) this.cropWidth = minSize;
          break;
      }
    }

    this.clampCropBox();
  }

  @HostListener('document:mouseup')
  dragEnd(): void {
    if (this.isDragging) {
      this.isDragging = false;
      this.dragType = '';
      this.saveActiveRelativeCrop();
    }
  }

  // Force bounds safety inside displayed image container
  private clampCropBox(): void {
    if (this.cropLeft < 0) this.cropLeft = 0;
    if (this.cropTop < 0) this.cropTop = 0;
    
    if (this.cropLeft + this.cropWidth > this.displayImageWidth) {
      this.cropWidth = this.displayImageWidth - this.cropLeft;
      // Re-adjust height if ratio locked
      const ratio = this.activeAspectRatio();
      if (ratio !== null) {
        this.cropHeight = this.cropWidth / ratio;
      }
    }
    if (this.cropTop + this.cropHeight > this.displayImageHeight) {
      this.cropHeight = this.displayImageHeight - this.cropTop;
      // Re-adjust width if ratio locked
      const ratio = this.activeAspectRatio();
      if (ratio !== null) {
        this.cropWidth = this.cropHeight * ratio;
      }
    }
    
    // Bounds check on absolute limits
    if (this.cropWidth > this.displayImageWidth) {
      this.cropWidth = this.displayImageWidth;
      const ratio = this.activeAspectRatio();
      if (ratio !== null) this.cropHeight = this.cropWidth / ratio;
    }
    if (this.cropHeight > this.displayImageHeight) {
      this.cropHeight = this.displayImageHeight;
      const ratio = this.activeAspectRatio();
      if (ratio !== null) this.cropWidth = this.cropHeight * ratio;
    }
  }

  // BULK SYNC ENGINE
  applyToAll(): void {
    const active = this.activeImage;
    if (!active || this.displayImageWidth <= 0 || this.displayImageHeight <= 0) return;

    // Capture active relative offsets
    const rx = this.cropLeft / this.displayImageWidth;
    const ry = this.cropTop / this.displayImageHeight;
    const rw = this.cropWidth / this.displayImageWidth;
    const rh = this.cropHeight / this.displayImageHeight;

    // Write relative offsets to all items and set flash animation flags
    const updated = this.images().map((img) => {
      return { 
        ...img, 
        cropX: rx, 
        cropY: ry, 
        cropW: rw, 
        cropH: rh,
        syncSuccess: true
      };
    });

    this.images.set(updated);

    // Clear the success flash state after 1 second
    setTimeout(() => {
      const reset = this.images().map(img => ({ ...img, syncSuccess: false }));
      this.images.set(reset);
    }, 1000);
  }

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

  // BATCH RENDER EXPORT
  async exportCroppedBatch(): Promise<void> {
    const list = this.images();
    if (list.length === 0) return;

    /* GATING DISABLED FOR NOW - UNCOMMENT TO RE-ENABLE LEAD CAPTURE
    if (localStorage.getItem('isGatedUser') !== 'true') {
      this.pendingDownloadCallback = () => this.executeCroppedExport();
      this.showLeadModal = true;
      return;
    }
    */

    this.executeCroppedExport();
  }

  async executeCroppedExport(): Promise<void> {
    const list = this.images();
    if (list.length === 0) return;

    // Ensure we save active relative crop before compiling
    this.saveActiveRelativeCrop();

    this.isProcessing.set(true);
    const zip = new JSZip();

    try {
      const cropPromises = list.map((item) => {
        return new Promise<void>((resolve, reject) => {
          const img = new Image();
          const rawUrl = URL.createObjectURL(item.file);
          img.src = rawUrl;
          img.onload = () => {
            try {
              const canvas = document.createElement('canvas');
              const ctx = canvas.getContext('2d');
              
              if (!ctx) {
                URL.revokeObjectURL(rawUrl);
                reject(new Error('Canvas 2D context not available'));
                return;
              }

              // Compute absolute crop offsets based on native dimensions
              const nativeX = item.cropX * img.naturalWidth;
              const nativeY = item.cropY * img.naturalHeight;
              const nativeW = item.cropW * img.naturalWidth;
              const nativeH = item.cropH * img.naturalHeight;

              canvas.width = nativeW;
              canvas.height = nativeH;

              // Render crop slice
              ctx.drawImage(
                img,
                nativeX, nativeY, nativeW, nativeH, // crop source boundaries
                0, 0, nativeW, nativeH             // destination canvas bounds
              );

              // Get binary blob
              canvas.toBlob((blob) => {
                URL.revokeObjectURL(rawUrl);
                if (blob) {
                  const originalName = item.name;
                  const dotIdx = originalName.lastIndexOf('.');
                  const baseName = dotIdx !== -1 ? originalName.substring(0, dotIdx) : originalName;
                  zip.file(`${baseName}_cropped.jpg`, blob);
                  resolve();
                } else {
                  reject(new Error('Blob generation failed'));
                }
              }, 'image/jpeg', 0.92);

            } catch (err) {
              URL.revokeObjectURL(rawUrl);
              reject(err);
            }
          };
          img.onerror = () => {
            URL.revokeObjectURL(rawUrl);
            reject(new Error(`Failed to load image resource: ${item.name}`));
          };
        });
      });

      await Promise.all(cropPromises);

      // Compile Zip
      const content = await zip.generateAsync({ type: 'blob' });
      const blobUrl = window.URL.createObjectURL(content);
      
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `selleros_cropped_images_${Date.now()}.zip`;
      document.body.appendChild(link);
      link.click();
      
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);

    } catch (error) {
      console.error('Failed to export batch:', error);
      alert(`Export Failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.isProcessing.set(false);
    }
  }
}

