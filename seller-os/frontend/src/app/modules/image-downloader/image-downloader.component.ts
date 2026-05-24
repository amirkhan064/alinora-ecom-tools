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
      default:
        return 'Paste Flipkart, Amazon, Meesho, or Myntra product links here (one per line)...';
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

    this.http.post<FetchImagesResult>(this.apiEndpoint, { urls: filteredUrls })
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
            next: (blob) => {
              const fileExtension = blob.type.split('/')[1] || 'jpg';
              const platformPrefix = img.platform.toLowerCase();
              const fileName = `${platformPrefix}_scraped_${img.id.split('_')[2] || 'img'}_${index + 1}.${fileExtension}`;
              
              zip.file(fileName, blob);
              resolve();
            },
            error: (err) => {
              console.warn(`Failed to fetch image for zip ${img.id} via proxy, trying direct fallback:`, err);
              // Fallback to direct client-side fetch in case proxy fails
              this.http.get(img.url, { responseType: 'blob' })
                .subscribe({
                  next: (directBlob) => {
                    const fileExtension = directBlob.type.split('/')[1] || 'jpg';
                    const platformPrefix = img.platform.toLowerCase();
                    const fileName = `${platformPrefix}_scraped_${img.id.split('_')[2] || 'img'}_${index + 1}.${fileExtension}`;
                    zip.file(fileName, directBlob);
                    resolve();
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
        next: (blob) => {
          const blobUrl = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = blobUrl;
          
          // Generate a clean professional filename
          const fileExtension = blob.type.split('/')[1] || 'jpg';
          const platformPrefix = img.platform.toLowerCase();
          link.download = `${platformPrefix}_scraped_${img.id.split('_')[2] || 'img'}.${fileExtension}`;
          
          document.body.appendChild(link);
          link.click();
          
          // Clean up
          document.body.removeChild(link);
          window.URL.revokeObjectURL(blobUrl);
        },
        error: (proxyErr) => {
          console.warn(`Failed to download image ${img.id} via proxy, trying direct fallback:`, proxyErr);
          // Try direct fallback
          this.http.get(img.url, { responseType: 'blob' })
            .subscribe({
              next: (blob) => {
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
}
