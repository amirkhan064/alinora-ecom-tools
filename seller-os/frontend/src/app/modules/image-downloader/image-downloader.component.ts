import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import JSZip from 'jszip';

interface ScrapedImage {
  id: string;
  platform: string;
  url: string;
  description: string;
}

interface SuccessResponse {
  url: string;
  platform: string;
  images: ScrapedImage[];
}

interface FailureResponse {
  url: string;
  error: string;
}

interface FetchImagesResult {
  successes: SuccessResponse[];
  failures: FailureResponse[];
}

@Component({
  selector: 'app-image-downloader',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './image-downloader.component.html',
  styleUrls: ['./image-downloader.component.css']
})
export class ImageDownloaderComponent {
  private http = inject(HttpClient);
  private apiEndpoint = 'http://localhost:3333/api/fetch-images';

  urlsInput: string = '';
  selectedPlatform: string = 'all';
  highResOnly: boolean = true;
  autoZip: boolean = true;
  isFetching: boolean = false;
  
  fetchedImages: ScrapedImage[] = [];
  failures: FailureResponse[] = [];
  selectedImageIds: Set<string> = new Set<string>();

  // Self-debugging log collector to capture and display silent browser errors
  debugLogs: string[] = [];

  constructor() {
    // Capture unhandled runtime errors
    window.addEventListener('error', (event) => {
      this.debugLogs.push(`[Unhandled Error] ${event.message} at ${event.filename}:${event.lineno}`);
    });

    // Capture unhandled promise rejections (e.g. failed fetches)
    window.addEventListener('unhandledrejection', (event) => {
      this.debugLogs.push(`[Unhandled Rejection] ${event.reason}`);
    });

    // Capture console.error outputs
    const originalError = console.error;
    console.error = (...args: any[]) => {
      const msg = args.map(a => {
        try {
          return typeof a === 'object' ? JSON.stringify(a) : String(a);
        } catch (e) {
          return String(a);
        }
      }).join(' ');
      this.debugLogs.push(`[Console Error] ${msg}`);
      originalError.apply(console, args);
    };
  }

  getPlaceholder(): string {
    switch (this.selectedPlatform) {
      case 'flipkart':
        return 'Paste Flipkart product links here (one per line)...';
      case 'amazon':
        return 'Paste Amazon product links here (one per line)...';
      case 'meesho':
        return 'Paste Meesho product links here (one per line)...';
      case 'myntra':
        return 'Paste Myntra product links here (one per line)...';
      case 'shopify':
        return 'Paste Shopify store product links here...';
      case 'woocommerce':
        return 'Paste WooCommerce store product links here...';
      case 'pinterest':
        return 'Paste Pinterest links here...';
      default:
        return 'Paste Flipkart, Amazon, Meesho, Myntra, Shopify, WooCommerce, or Pinterest product links here (one per line)...';
    }
  }

  // Fetch product images from backend
  fetchImages(): void {
    if (!this.urlsInput.trim()) return;

    // Parse comma or newline separated URLs
    const parsedUrls = this.urlsInput
      .split(/[\n,]+/)
      .map(url => url.trim())
      .filter(url => url.length > 0);

    if (parsedUrls.length === 0) return;

    this.isFetching = true;
    this.failures = [];
    this.fetchedImages = [];
    this.selectedImageIds.clear();

    // Filter and validate based on chosen target platform
    const filteredUrls: string[] = [];
    parsedUrls.forEach(url => {
      const cleanUrl = url.toLowerCase();
      let matches = true;
      if (this.selectedPlatform === 'amazon' && !cleanUrl.includes('amazon.com') && !cleanUrl.includes('amazon.in') && !cleanUrl.includes('amzn.to')) {
        matches = false;
      } else if (this.selectedPlatform === 'flipkart' && !cleanUrl.includes('flipkart.com')) {
        matches = false;
      } else if (this.selectedPlatform === 'meesho' && !cleanUrl.includes('meesho.com')) {
        matches = false;
      } else if (this.selectedPlatform === 'myntra' && !cleanUrl.includes('myntra.com')) {
        matches = false;
      } else if (this.selectedPlatform === 'pinterest' && !cleanUrl.includes('pinterest.com') && !cleanUrl.includes('pin.it') && !cleanUrl.includes('pinterest.co')) {
        matches = false;
      } else if (this.selectedPlatform === 'shopify' || this.selectedPlatform === 'woocommerce') {
        // We cannot validate custom domains statically, so trust the user if they specifically selected Shopify/WooCommerce
        matches = true;
      }

      if (matches) {
        filteredUrls.push(url);
      } else {
        this.failures.push({
          url: url,
          error: `Skipped: URL does not match target platform (${this.selectedPlatform.toUpperCase()}).`
        });
      }
    });

    if (filteredUrls.length === 0) {
      this.isFetching = false;
      return;
    }

    this.http.post<FetchImagesResult>(this.apiEndpoint, { urls: filteredUrls, platform: this.selectedPlatform })
      .subscribe({
        next: (response) => {
          try {
            console.log('Received response:', response);
            if (response.failures) {
              this.failures.push(...response.failures);
            }
            
            // Flatten all scraped images from all successful URLs
            const allImages: ScrapedImage[] = [];
            if (response.successes) {
              response.successes.forEach(success => {
                if (success.images) {
                  allImages.push(...success.images);
                }
              });
            }
            this.fetchedImages = allImages;
          } catch (e: any) {
            console.error('Error parsing response:', e);
            this.failures.push({
              url: 'UI Response Parser',
              error: `Failed to parse backend response. Error: ${e.message || e}. Payload: ${JSON.stringify(response)}`
            });
          } finally {
            this.isFetching = false;
          }
        },
        error: (err) => {
          console.error('Failed to fetch images:', err);
          this.failures.push({
            url: 'Global Network Connection',
            error: `Could not connect to the SellerOS local backend server at ${this.apiEndpoint}. Error details: ${err.message || err.statusText || 'Network Connection Blocked / CORS Preflight Failed'}`
          });
          this.isFetching = false;
        }
      });
  }

  // Card Selection logic
  toggleSelection(id: string): void {
    if (this.selectedImageIds.has(id)) {
      this.selectedImageIds.delete(id);
    } else {
      this.selectedImageIds.add(id);
    }
  }

  isImageSelected(id: string): boolean {
    return this.selectedImageIds.has(id);
  }

  // Select all / Deselect all
  isAllSelected(): boolean {
    if (this.fetchedImages.length === 0) return false;
    return this.fetchedImages.every(img => this.selectedImageIds.has(img.id));
  }

  toggleSelectAll(): void {
    if (this.isAllSelected()) {
      // Deselect all
      this.fetchedImages.forEach(img => this.selectedImageIds.delete(img.id));
    } else {
      // Select all
      this.fetchedImages.forEach(img => this.selectedImageIds.add(img.id));
    }
  }

  // Trigger high-quality local downloads of chosen images
  downloadSelected(): void {
    if (this.selectedImageIds.size === 0) return;

    const selectedImages = this.fetchedImages.filter(img => this.selectedImageIds.has(img.id));
    
    if (this.autoZip) {
      this.downloadAsZip(selectedImages);
    } else {
      selectedImages.forEach((img, index) => {
        // Introduce a slight staggered delay to prevent browser download blocks
        setTimeout(() => {
          this.downloadSingleImage(img);
        }, index * 250);
      });
    }
  }

  private downloadAsZip(images: ScrapedImage[]): void {
    const zip = new JSZip();
    this.isFetching = true;

    const fetchPromises = images.map((img, index) => {
      return new Promise<void>((resolve, reject) => {
        const proxyUrl = `http://localhost:3333/api/proxy-image?url=${encodeURIComponent(img.url)}`;
        this.http.get(proxyUrl, { responseType: 'blob' })
          .subscribe({
            next: async (blob) => {
              try {
                const jpegBlob = await this.convertBlobToJpeg(blob);
                const platformPrefix = img.platform.toLowerCase();
                const fileName = `${platformPrefix}_scraped_${img.id.split('_')[2] || 'img'}_${index + 1}.jpg`;
                
                zip.file(fileName, jpegBlob);
                resolve();
              } catch (e) {
                console.warn('Failed to convert to jpeg:', e);
                // Fallback to original blob
                const fileExtension = blob.type.split('/')[1] || 'jpg';
                const platformPrefix = img.platform.toLowerCase();
                const fileName = `${platformPrefix}_scraped_${img.id.split('_')[2] || 'img'}_${index + 1}.${fileExtension}`;
                
                zip.file(fileName, blob);
                resolve();
              }
            },
            error: (err) => {
              console.warn(`Failed to fetch image for zip ${img.id} via proxy, trying direct fallback:`, err);
              // Fallback to direct client-side fetch in case proxy fails
              this.http.get(img.url, { responseType: 'blob' })
                .subscribe({
                  next: async (directBlob) => {
                    try {
                      const jpegBlob = await this.convertBlobToJpeg(directBlob);
                      const platformPrefix = img.platform.toLowerCase();
                      const fileName = `${platformPrefix}_scraped_${img.id.split('_')[2] || 'img'}_${index + 1}.jpg`;
                      zip.file(fileName, jpegBlob);
                      resolve();
                    } catch (e) {
                      const fileExtension = directBlob.type.split('/')[1] || 'jpg';
                      const platformPrefix = img.platform.toLowerCase();
                      const fileName = `${platformPrefix}_scraped_${img.id.split('_')[2] || 'img'}_${index + 1}.${fileExtension}`;
                      zip.file(fileName, directBlob);
                      resolve();
                    }
                  },
                  error: (directErr) => {
                    console.error(`Direct fallback fetch failed for zip image ${img.id}:`, directErr);
                    resolve(); // Resolve anyway to build zip with other successful images
                  }
                });
            }
          });
      });
    });

    Promise.all(fetchPromises)
      .then(() => {
        return zip.generateAsync({ type: 'blob' });
      })
      .then((content) => {
        const blobUrl = window.URL.createObjectURL(content);
        const link = document.createElement('a');
        link.href = blobUrl;
        
        const platformName = this.selectedPlatform !== 'all' ? this.selectedPlatform.toUpperCase() : 'SELLEROS';
        link.download = `${platformName.toLowerCase()}_scraped_images_${Date.now()}.zip`;
        
        document.body.appendChild(link);
        link.click();
        
        document.body.removeChild(link);
        window.URL.revokeObjectURL(blobUrl);
        this.isFetching = false;
      })
      .catch((err) => {
        console.error('Failed to generate zip:', err);
        this.failures.push({
          url: 'Zip Generator',
          error: `Failed to compile files into ZIP: ${err.message || err}`
        });
        this.isFetching = false;
      });
  }

  private downloadSingleImage(img: ScrapedImage): void {
    const proxyUrl = `http://localhost:3333/api/proxy-image?url=${encodeURIComponent(img.url)}`;
    this.http.get(proxyUrl, { responseType: 'blob' })
      .subscribe({
        next: async (blob) => {
          try {
            const jpegBlob = await this.convertBlobToJpeg(blob);
            const blobUrl = window.URL.createObjectURL(jpegBlob);
            const link = document.createElement('a');
            link.href = blobUrl;
            
            const platformPrefix = img.platform.toLowerCase();
            link.download = `${platformPrefix}_scraped_${img.id.split('_')[2] || 'img'}.jpg`;
            
            document.body.appendChild(link);
            link.click();
            
            document.body.removeChild(link);
            window.URL.revokeObjectURL(blobUrl);
          } catch (e) {
            console.warn('Failed to convert single image to jpeg, falling back', e);
            const blobUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = blobUrl;
            
            const fileExtension = blob.type.split('/')[1] || 'jpg';
            const platformPrefix = img.platform.toLowerCase();
            link.download = `${platformPrefix}_scraped_${img.id.split('_')[2] || 'img'}.${fileExtension}`;
            
            document.body.appendChild(link);
            link.click();
            
            document.body.removeChild(link);
            window.URL.revokeObjectURL(blobUrl);
          }
        },
        error: (proxyErr) => {
          console.warn(`Failed to download image ${img.id} via proxy, trying direct fallback:`, proxyErr);
          // Try direct fallback
          this.http.get(img.url, { responseType: 'blob' })
            .subscribe({
              next: async (blob) => {
                try {
                  const jpegBlob = await this.convertBlobToJpeg(blob);
                  const blobUrl = window.URL.createObjectURL(jpegBlob);
                  const link = document.createElement('a');
                  link.href = blobUrl;
                  
                  const platformPrefix = img.platform.toLowerCase();
                  link.download = `${platformPrefix}_scraped_${img.id.split('_')[2] || 'img'}.jpg`;
                  
                  document.body.appendChild(link);
                  link.click();
                  
                  document.body.removeChild(link);
                  window.URL.revokeObjectURL(blobUrl);
                } catch (e) {
                  const blobUrl = window.URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = blobUrl;
                  
                  const fileExtension = blob.type.split('/')[1] || 'jpg';
                  const platformPrefix = img.platform.toLowerCase();
                  link.download = `${platformPrefix}_scraped_${img.id.split('_')[2] || 'img'}.${fileExtension}`;
                  
                  document.body.appendChild(link);
                  link.click();
                  
                  document.body.removeChild(link);
                  window.URL.revokeObjectURL(blobUrl);
                }
              },
              error: (directErr) => {
                console.error(`Failed to download image ${img.id} directly, falling back to new window:`, directErr);
                // Fallback: Open URL in new window if direct fetch is also blocked
                window.open(img.url, '_blank');
              }
            });
        }
      });
  }

  clearInput(): void {
    this.urlsInput = '';
  }

  private convertBlobToJpeg(blob: Blob): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = window.URL.createObjectURL(blob);
      
      img.onload = () => {
        window.URL.revokeObjectURL(objectUrl);
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Failed to get 2d context'));
        
        // Fill white background in case of transparency
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        
        canvas.toBlob((jpegBlob) => {
          if (jpegBlob) {
            resolve(jpegBlob);
          } else {
            reject(new Error('Failed to convert canvas to blob'));
          }
        }, 'image/jpeg', 0.9);
      };
      
      img.onerror = () => {
        window.URL.revokeObjectURL(objectUrl);
        reject(new Error('Failed to load image for conversion'));
      };
      
      img.src = objectUrl;
    });
  }
}
