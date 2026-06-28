import { Component, ElementRef, ViewChild, AfterViewInit, HostListener, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  mode: 'draw' | 'erase';
  brushSize: number;
  points: Point[];
}

@Component({
  selector: 'app-watermark-remover',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './watermark-remover.component.html',
  styleUrls: ['./watermark-remover.component.css']
})
export class WatermarkRemoverComponent implements AfterViewInit {
  protected readonly Math = Math;
  @ViewChild('displayCanvas', { static: false }) displayCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('canvasContainer', { static: false }) canvasContainerRef!: ElementRef<HTMLDivElement>;

  // Tool Modes & Configurations
  toolMode = signal<'draw' | 'erase' | 'pan'>('draw');
  brushSize = signal<number>(24);
  zoomScale = signal<number>(1.0);
  
  // States
  imageLoaded = signal<boolean>(false);
  isProcessing = signal<boolean>(false);
  hasResult = signal<boolean>(false);
  activeSample = signal<string>('');

  // Dimensions
  originalWidth = 0;
  originalHeight = 0;
  displayWidth = 0;
  displayHeight = 0;

  // Zoom/Pan Matrix Coordinates
  panX = 0;
  panY = 0;
  isPanning = false;
  panStart = { x: 0, y: 0 };

  // Drawing States
  isDrawing = false;
  mousePos: Point | null = null;

  // Canvas Instances
  protected originalImage: HTMLImageElement | null = null;
  private displayCanvas!: HTMLCanvasElement;
  private displayCtx!: CanvasRenderingContext2D;
  
  // Offscreen Mask Canvas (matches displayCanvas size, holds the painted red mask for display)
  private displayMaskCanvas!: HTMLCanvasElement;
  private displayMaskCtx!: CanvasRenderingContext2D;

  // Offscreen High-Res Mask Canvas (matches original image size, holds high-resolution vector mask)
  private originalMaskCanvas!: HTMLCanvasElement;
  private originalMaskCtx!: CanvasRenderingContext2D;

  // Offscreen High-Res Canvas (for the original high-resolution inpainting)
  private originalCanvas!: HTMLCanvasElement;
  private originalCtx!: CanvasRenderingContext2D;

  // Undo/Redo Vector Stroke History
  private strokes: Stroke[] = [];
  private currentStroke: Stroke | null = null;
  protected historyIndex = -1;

  @ViewChild('fileInput', { static: false }) fileInputRef!: ElementRef<HTMLInputElement>;

  // Comparison State
  showOriginal = signal<boolean>(false);
  sliderValue = signal<number>(50); // 0 to 100 representing percentage from left
  isResizingSlider = false;

  triggerFilePicker() {
    if (this.fileInputRef) {
      this.fileInputRef.nativeElement.click();
    }
  }

  constructor() {
    // Generate offscreen canvases dynamically when needed
  }

  ngAfterViewInit() {
    this.initCanvases();
  }

  private initCanvases() {
    this.displayMaskCanvas = document.createElement('canvas');
    this.displayMaskCtx = this.displayMaskCanvas.getContext('2d', { willReadFrequently: true })!;

    this.originalMaskCanvas = document.createElement('canvas');
    this.originalMaskCtx = this.originalMaskCanvas.getContext('2d', { willReadFrequently: true })!;

    this.originalCanvas = document.createElement('canvas');
    this.originalCtx = this.originalCanvas.getContext('2d', { willReadFrequently: true })!;
  }

  // Handle Drag & Drop
  isDragActive = false;

  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragActive = true;
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragActive = false;
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragActive = false;

    if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      const file = event.dataTransfer.files[0];
      if (file.type.startsWith('image/')) {
        this.processFile(file);
      }
    }
  }

  onFilePicked(event: any) {
    if (event.target.files && event.target.files.length > 0) {
      this.processFile(event.target.files[0]);
    }
  }

  private processFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e: any) => {
      this.loadImage(e.target.result);
    };
    reader.readAsDataURL(file);
  }

  // Load Image into Canvas
  loadImage(src: string, isSample = false) {
    this.isProcessing.set(true);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.originalImage = img;
      this.originalWidth = img.width;
      this.originalHeight = img.height;

      // Initialize the high-resolution original canvas
      this.originalCanvas.width = this.originalWidth;
      this.originalCanvas.height = this.originalHeight;
      this.originalCtx.drawImage(img, 0, 0);

      // Compute display bounds based on container size
      this.computeDisplayBounds();

      // Setup display canvas
      this.displayCanvas = this.displayCanvasRef.nativeElement;
      this.displayCanvas.width = this.displayWidth;
      this.displayCanvas.height = this.displayHeight;
      this.displayCtx = this.displayCanvas.getContext('2d', { willReadFrequently: true })!;

      // Setup display mask canvas and original mask canvas dimensions
      this.displayMaskCanvas.width = this.displayWidth;
      this.displayMaskCanvas.height = this.displayHeight;
      
      this.originalMaskCanvas.width = this.originalWidth;
      this.originalMaskCanvas.height = this.originalHeight;

      this.clearMask();

      // Reset transforms
      this.zoomScale.set(1.0);
      this.panX = 0;
      this.panY = 0;

      // Draw initial screen
      this.redraw();

      this.imageLoaded.set(true);
      this.hasResult.set(false);
      this.isProcessing.set(false);
      if (!isSample) {
        this.activeSample.set('');
      }
    };
    img.onerror = () => {
      this.isProcessing.set(false);
      alert('Failed to load image. Please try a different file.');
    };
    img.src = src;
  }

  private computeDisplayBounds() {
    const container = this.canvasContainerRef.nativeElement;
    const maxW = container.clientWidth - 40;
    const maxH = Math.max(450, window.innerHeight - 260);

    const aspect = this.originalWidth / this.originalHeight;

    if (this.originalWidth > maxW || this.originalHeight > maxH) {
      if (maxW / aspect <= maxH) {
        this.displayWidth = maxW;
        this.displayHeight = Math.round(maxW / aspect);
      } else {
        this.displayHeight = maxH;
        this.displayWidth = Math.round(maxH * aspect);
      }
    } else {
      this.displayWidth = this.originalWidth;
      this.displayHeight = this.originalHeight;
    }
  }

  // Draw loop
  redraw() {
    if (!this.displayCtx || !this.originalImage) return;

    this.displayCtx.clearRect(0, 0, this.displayWidth, this.displayHeight);
    this.displayCtx.save();

    // Apply translate and scale for zoom & pan
    this.displayCtx.translate(this.panX, this.panY);
    this.displayCtx.scale(this.zoomScale(), this.zoomScale());

    if (this.hasResult() && !this.showOriginal()) {
      // Draw result image from originalCanvas (scaled down)
      this.displayCtx.drawImage(this.originalCanvas, 0, 0, this.displayWidth, this.displayHeight);
    } else {
      // Draw original image
      this.displayCtx.drawImage(this.originalImage, 0, 0, this.displayWidth, this.displayHeight);
    }

    // Draw active mask (if we are editing and not in result view)
    if (!this.hasResult()) {
      this.displayCtx.drawImage(this.displayMaskCanvas, 0, 0);
    }

    this.displayCtx.restore();

    // If result is shown and comparison slider is active, draw the split slider divider overlay
    if (this.hasResult()) {
      this.drawComparisonOverlay();
    }

    // Draw brush circle cursor if mouse is over canvas and in edit mode
    if (this.mousePos && this.imageLoaded() && !this.hasResult() && this.toolMode() !== 'pan') {
      const cursorRadius = (this.brushSize() * this.zoomScale()) / 2;
      this.displayCtx.save();
      this.displayCtx.beginPath();
      this.displayCtx.arc(this.mousePos.x, this.mousePos.y, cursorRadius, 0, Math.PI * 2);
      this.displayCtx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      this.displayCtx.lineWidth = 1.5;
      this.displayCtx.shadowColor = 'rgba(0, 0, 0, 0.35)';
      this.displayCtx.shadowBlur = 3;
      this.displayCtx.stroke();
      this.displayCtx.restore();
    }
  }

  private drawComparisonOverlay() {
    if (!this.displayCtx || !this.originalImage) return;

    const splitX = (this.sliderValue() / 100) * this.displayWidth;

    // Draw the "original" on the left side of the split, "restored" on the right side.
    this.displayCtx.save();
    this.displayCtx.clearRect(0, 0, this.displayWidth, this.displayHeight);

    // Apply Zoom & Pan transforms
    this.displayCtx.translate(this.panX, this.panY);
    this.displayCtx.scale(this.zoomScale(), this.zoomScale());

    // 1. Draw restored image as the background (right side)
    this.displayCtx.drawImage(this.originalCanvas, 0, 0, this.displayWidth, this.displayHeight);
    this.displayCtx.restore();

    // 2. Draw original image only on the left side by clipping the context
    this.displayCtx.save();
    this.displayCtx.beginPath();
    this.displayCtx.rect(0, 0, splitX, this.displayHeight);
    this.displayCtx.clip();

    this.displayCtx.translate(this.panX, this.panY);
    this.displayCtx.scale(this.zoomScale(), this.zoomScale());
    this.displayCtx.drawImage(this.originalImage, 0, 0, this.displayWidth, this.displayHeight);
    this.displayCtx.restore();

    // 3. Draw vertical divider bar
    this.displayCtx.beginPath();
    this.displayCtx.moveTo(splitX, 0);
    this.displayCtx.lineTo(splitX, this.displayHeight);
    this.displayCtx.strokeStyle = '#4f46e5';
    this.displayCtx.lineWidth = 3;
    this.displayCtx.shadowColor = 'rgba(79, 70, 229, 0.4)';
    this.displayCtx.shadowBlur = 10;
    this.displayCtx.stroke();
    this.displayCtx.shadowBlur = 0; // reset

    // Draw a decorative slider handle knob in the center
    const knobY = this.displayHeight / 2;
    this.displayCtx.beginPath();
    this.displayCtx.arc(splitX, knobY, 16, 0, Math.PI * 2);
    this.displayCtx.fillStyle = '#4f46e5';
    this.displayCtx.fill();
    this.displayCtx.strokeStyle = '#ffffff';
    this.displayCtx.lineWidth = 2.5;
    this.displayCtx.stroke();

    // Draw small arrows in the knob
    this.displayCtx.fillStyle = '#ffffff';
    this.displayCtx.font = '10px "Material Symbols Outlined"';
    this.displayCtx.textAlign = 'center';
    this.displayCtx.textBaseline = 'middle';
    this.displayCtx.fillText('unfold_more', splitX, knobY);
  }

  // Get mouse coordinates mapped back to high-resolution original image space
  private getOriginalCoordinates(event: MouseEvent): Point {
    const rect = this.displayCanvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // Convert display client coordinates to image display coordinates
    const imgX = (mouseX - this.panX) / this.zoomScale();
    const imgY = (mouseY - this.panY) / this.zoomScale();

    // Scale to original high-resolution size
    const origX = imgX * (this.originalWidth / this.displayWidth);
    const origY = imgY * (this.originalHeight / this.displayHeight);

    return { x: origX, y: origY };
  }

  // Mouse / Touch Canvas Event Listeners
  onCanvasMouseDown(event: MouseEvent) {
    if (!this.imageLoaded()) return;

    const rect = this.displayCanvas.getBoundingClientRect();
    this.mousePos = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };

    if (this.hasResult()) {
      // Check if clicking near the comparison slider handle (within 25px horizontally)
      const clickX = event.clientX - rect.left;
      const splitX = (this.sliderValue() / 100) * this.displayWidth;
      if (Math.abs(clickX - splitX) < 25) {
        this.isResizingSlider = true;
        event.preventDefault();
      }
      return;
    }

    if (this.toolMode() === 'pan' || event.button === 1 || event.button === 2) {
      // Pan mode (or middle/right click)
      this.isPanning = true;
      this.panStart = { x: event.clientX - this.panX, y: event.clientY - this.panY };
      event.preventDefault();
      return;
    }

    // Paint / Erase drawing mode
    const pt = this.getOriginalCoordinates(event);
    this.isDrawing = true;

    // Create new vector stroke mapped to original dimensions
    this.currentStroke = {
      mode: this.toolMode() === 'erase' ? 'erase' : 'draw',
      brushSize: this.brushSize() * (this.originalWidth / this.displayWidth),
      points: [pt]
    };

    this.drawStrokeSegment(pt, pt);
  }

  onCanvasMouseMove(event: MouseEvent) {
    if (!this.imageLoaded()) return;

    const rect = this.displayCanvas.getBoundingClientRect();
    this.mousePos = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };

    if (this.isResizingSlider) {
      const mouseX = event.clientX - rect.left;
      const pct = Math.max(0, Math.min(100, (mouseX / this.displayWidth) * 100));
      this.sliderValue.set(pct);
      this.redraw();
      return;
    }

    if (this.isPanning) {
      this.panX = event.clientX - this.panStart.x;
      this.panY = event.clientY - this.panStart.y;
      this.redraw();
      return;
    }

    if (!this.isDrawing || !this.currentStroke) {
      this.redraw(); // Redraw cursor circle following mouse
      return;
    }

    const pt = this.getOriginalCoordinates(event);
    const lastPt = this.currentStroke.points[this.currentStroke.points.length - 1];
    this.currentStroke.points.push(pt);

    this.drawStrokeSegment(lastPt, pt);
  }

  onCanvasMouseLeave() {
    this.mousePos = null;
    this.redraw();
  }

  getCursorStyle(): string {
    if (!this.imageLoaded()) return 'pointer';
    if (this.hasResult()) return 'default';
    if (this.toolMode() === 'pan') {
      return this.isPanning ? 'grabbing' : 'grab';
    }
    return 'none'; // Hide default cursor so our custom brush circle renders!
  }

  @HostListener('window:mouseup')
  onCanvasMouseUp() {
    this.isPanning = false;
    this.isResizingSlider = false;

    if (this.isDrawing && this.currentStroke) {
      this.isDrawing = false;
      // Truncate history forward if we had undone steps
      this.strokes = this.strokes.slice(0, this.historyIndex + 1);
      this.strokes.push(this.currentStroke);
      this.historyIndex++;
      this.currentStroke = null;
    }
  }

  // Wheel Zoom
  onCanvasWheel(event: WheelEvent) {
    if (!this.imageLoaded()) return;
    event.preventDefault();

    const zoomIntensity = 0.05;
    const rect = this.displayCanvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // Relative coords before zoom
    const zoomX = (mouseX - this.panX) / this.zoomScale();
    const zoomY = (mouseY - this.panY) / this.zoomScale();

    // Adjust zoom
    let nextScale = this.zoomScale() + (event.deltaY < 0 ? zoomIntensity : -zoomIntensity);
    nextScale = Math.max(0.5, Math.min(5.0, nextScale));
    this.zoomScale.set(nextScale);

    // Readjust translation to center zoom on mouse cursor
    this.panX = mouseX - zoomX * this.zoomScale();
    this.panY = mouseY - zoomY * this.zoomScale();

    this.redraw();
  }

  // Draw stroke segments on both high-res and display-resolution mask canvases
  private drawStrokeSegment(p1: Point, p2: Point) {
    if (!this.currentStroke) return;

    const size = this.currentStroke.brushSize;
    const isErase = this.currentStroke.mode === 'erase';

    // 1. Draw segment on high-res mask canvas
    this.originalMaskCtx.save();
    if (isErase) {
      this.originalMaskCtx.globalCompositeOperation = 'destination-out';
      this.originalMaskCtx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      this.originalMaskCtx.globalCompositeOperation = 'source-over';
      this.originalMaskCtx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
    }
    this.originalMaskCtx.lineWidth = size;
    this.originalMaskCtx.lineCap = 'round';
    this.originalMaskCtx.lineJoin = 'round';
    this.originalMaskCtx.beginPath();
    this.originalMaskCtx.moveTo(p1.x, p1.y);
    this.originalMaskCtx.lineTo(p2.x, p2.y);
    this.originalMaskCtx.stroke();
    this.originalMaskCtx.restore();

    // 2. Draw segment on display-resolution mask canvas
    const scale = this.displayWidth / this.originalWidth;
    this.displayMaskCtx.save();
    if (isErase) {
      this.displayMaskCtx.globalCompositeOperation = 'destination-out';
      this.displayMaskCtx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      this.displayMaskCtx.globalCompositeOperation = 'source-over';
      this.displayMaskCtx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
    }
    this.displayMaskCtx.lineWidth = size * scale;
    this.displayMaskCtx.lineCap = 'round';
    this.displayMaskCtx.lineJoin = 'round';
    this.displayMaskCtx.beginPath();
    this.displayMaskCtx.moveTo(p1.x * scale, p1.y * scale);
    this.displayMaskCtx.lineTo(p2.x * scale, p2.y * scale);
    this.displayMaskCtx.stroke();
    this.displayMaskCtx.restore();

    this.redraw();
  }

  // Clear mask
  clearMask() {
    this.displayMaskCtx?.clearRect(0, 0, this.displayWidth, this.displayHeight);
    this.originalMaskCtx?.clearRect(0, 0, this.originalWidth, this.originalHeight);
    this.strokes = [];
    this.historyIndex = -1;
    this.redraw();
  }

  // Reset viewport
  resetViewport() {
    this.zoomScale.set(1.0);
    this.panX = 0;
    this.panY = 0;
    this.redraw();
  }

  // Undo / Redo Vector Logic
  undo() {
    if (this.historyIndex >= 0) {
      this.historyIndex--;
      this.rebuildMasksFromStrokes();
    }
  }

  redo() {
    if (this.historyIndex < this.strokes.length - 1) {
      this.historyIndex++;
      this.rebuildMasksFromStrokes();
    }
  }

  canUndo(): boolean {
    return this.historyIndex >= 0;
  }

  canRedo(): boolean {
    return this.historyIndex < this.strokes.length - 1;
  }

  private rebuildMasksFromStrokes() {
    this.displayMaskCtx.clearRect(0, 0, this.displayWidth, this.displayHeight);
    this.originalMaskCtx.clearRect(0, 0, this.originalWidth, this.originalHeight);

    const scale = this.displayWidth / this.originalWidth;
    for (let i = 0; i <= this.historyIndex; i++) {
      const stroke = this.strokes[i];
      
      // Re-draw on original mask
      this.originalMaskCtx.save();
      if (stroke.mode === 'erase') {
        this.originalMaskCtx.globalCompositeOperation = 'destination-out';
        this.originalMaskCtx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        this.originalMaskCtx.globalCompositeOperation = 'source-over';
        this.originalMaskCtx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
      }
      this.originalMaskCtx.lineWidth = stroke.brushSize;
      this.originalMaskCtx.lineCap = 'round';
      this.originalMaskCtx.lineJoin = 'round';
      this.originalMaskCtx.beginPath();
      const pts = stroke.points;
      if (pts.length > 0) {
        this.originalMaskCtx.moveTo(pts[0].x, pts[0].y);
        for (let j = 1; j < pts.length; j++) {
          this.originalMaskCtx.lineTo(pts[j].x, pts[j].y);
        }
        if (pts.length === 1) {
          this.originalMaskCtx.lineTo(pts[0].x + 0.1, pts[0].y);
        }
      }
      this.originalMaskCtx.stroke();
      this.originalMaskCtx.restore();

      // Re-draw on display mask
      this.displayMaskCtx.save();
      if (stroke.mode === 'erase') {
        this.displayMaskCtx.globalCompositeOperation = 'destination-out';
        this.displayMaskCtx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        this.displayMaskCtx.globalCompositeOperation = 'source-over';
        this.displayMaskCtx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
      }
      this.displayMaskCtx.lineWidth = stroke.brushSize * scale;
      this.displayMaskCtx.lineCap = 'round';
      this.displayMaskCtx.lineJoin = 'round';
      this.displayMaskCtx.beginPath();
      if (pts.length > 0) {
        this.displayMaskCtx.moveTo(pts[0].x * scale, pts[0].y * scale);
        for (let j = 1; j < pts.length; j++) {
          this.displayMaskCtx.lineTo(pts[j].x * scale, pts[j].y * scale);
        }
        if (pts.length === 1) {
          this.displayMaskCtx.lineTo((pts[0].x + 0.1) * scale, pts[0].y * scale);
        }
      }
      this.displayMaskCtx.stroke();
      this.displayMaskCtx.restore();
    }

    this.redraw();
  }

  // High-Resolution Client-side Inpainting Engine
  async removeWatermark() {
    if (!this.originalImage || this.isProcessing()) return;

    this.isProcessing.set(true);

    setTimeout(() => {
      try {
        const originalWidth = this.originalWidth;
        const originalHeight = this.originalHeight;

        // Read pixels directly from high-resolution original image and mask canvases
        const imgData = this.originalCtx.getImageData(0, 0, originalWidth, originalHeight);
        const maskData = this.originalMaskCtx.getImageData(0, 0, originalWidth, originalHeight);

        // Run the inpainting algorithm
        this.runInpaintingAlgorithm(imgData, maskData);

        // Draw the inpainted image back to originalCtx
        this.originalCtx.putImageData(imgData, 0, 0);

        this.hasResult.set(true);
        this.sliderValue.set(50);
        this.redraw();
      } catch (err) {
        console.error('Inpainting error:', err);
        alert('An error occurred during watermark removal.');
      } finally {
        this.isProcessing.set(false);
      }
    }, 100);
  }

  private runInpaintingAlgorithm(imgData: ImageData, maskData: ImageData) {
    const width = imgData.width;
    const height = imgData.height;
    
    // 1. Initial mask thresholding (low threshold to capture anti-aliasing details)
    const tempMask = new Uint8Array(width * height);
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let hasMask = false;

    for (let y = 0; y < height; y++) {
      const rowOffset = y * width;
      for (let x = 0; x < width; x++) {
        const idx = rowOffset + x;
        const maskAlpha = maskData.data[4 * idx + 3];
        if (maskAlpha > 5) { // Low threshold to catch faded edges
          tempMask[idx] = 1;
          hasMask = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (!hasMask) {
      throw new Error('Please paint a mask over the watermark first.');
    }

    // 2. Dilate the mask by 2 pixels to completely swallow anti-aliased fringes of the watermark text
    const isMasked = new Uint8Array(width * height);
    const dilationRadius = 2;
    for (let y = minY; y <= maxY; y++) {
      const rowOffset = y * width;
      for (let x = minX; x <= maxX; x++) {
        const idx = rowOffset + x;
        if (tempMask[idx]) {
          for (let dy = -dilationRadius; dy <= dilationRadius; dy++) {
            const ny = y + dy;
            if (ny < 0 || ny >= height) continue;
            const nRowOffset = ny * width;
            for (let dx = -dilationRadius; dx <= dilationRadius; dx++) {
              const nx = x + dx;
              if (nx < 0 || nx >= width) continue;
              isMasked[nRowOffset + nx] = 1;
            }
          }
        }
      }
    }

    // Recalculate bounding box based on dilated mask
    minX = width;
    maxX = 0;
    minY = height;
    maxY = 0;
    for (let y = 0; y < height; y++) {
      const rowOffset = y * width;
      for (let x = 0; x < width; x++) {
        const idx = rowOffset + x;
        if (isMasked[idx]) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    // Expand bounding box slightly for border context padding, clamp to image bounds
    const pad = 15;
    minX = Math.max(0, minX - pad);
    maxX = Math.min(width - 1, maxX + pad);
    minY = Math.max(0, minY - pad);
    maxY = Math.min(height - 1, maxY + pad);

    // 3. Compute distance transform using BFS inside bounding box (for onion-peel sorting)
    const distances = new Float32Array(width * height);
    distances.fill(Infinity);

    const queue: number[] = [];

    // Find border pixels inside bounding box to initialize BFS
    for (let y = minY; y <= maxY; y++) {
      const rowOffset = y * width;
      for (let x = minX; x <= maxX; x++) {
        const idx = rowOffset + x;
        if (isMasked[idx]) {
          let isBorder = false;
          // Inspect 8 neighbors
          for (let dy = -1; dy <= 1; dy++) {
            const ny = y + dy;
            if (ny < minY || ny > maxY) continue;
            const nRowOffset = ny * width;
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              if (nx < minX || nx > maxX) continue;

              if (!isMasked[nRowOffset + nx]) {
                isBorder = true;
                break;
              }
            }
            if (isBorder) break;
          }

          if (isBorder) {
            distances[idx] = 1;
            queue.push(idx);
          }
        }
      }
    }

    // BFS to populate distance field (onion-peel layers from outside-in)
    let qHead = 0;
    const neighbors = [-1, 1, -width, width];
    while (qHead < queue.length) {
      const currIdx = queue[qHead++];
      const currDist = distances[currIdx];

      for (let i = 0; i < 4; i++) {
        const nidx = currIdx + neighbors[i];
        const nx = nidx % width;
        const ny = Math.floor(nidx / width);

        if (nx >= minX && nx <= maxX && ny >= minY && ny <= maxY) {
          if (isMasked[nidx] && distances[nidx] > currDist + 1) {
            distances[nidx] = currDist + 1;
            queue.push(nidx);
          }
        }
      }
    }

    // Filter and sort masked pixels by distance (ascending)
    const sortedMaskedIdxs: number[] = [];
    for (let y = minY; y <= maxY; y++) {
      const rowOffset = y * width;
      for (let x = minX; x <= maxX; x++) {
        const idx = rowOffset + x;
        if (isMasked[idx] && distances[idx] !== Infinity) {
          sortedMaskedIdxs.push(idx);
        }
      }
    }
    sortedMaskedIdxs.sort((a, b) => distances[a] - distances[b]);

    // Keep track of originally masked pixels
    const originallyMasked = new Uint8Array(isMasked);

    // Track known color values
    const isKnown = new Uint8Array(width * height);
    for (let i = 0; i < isKnown.length; i++) {
      if (!isMasked[i]) {
        isKnown[i] = 1;
      }
    }

    const clamp = (val: number) => Math.max(0, Math.min(255, val));

    // 4. Initial Fill: Inverse Distance Weighting interpolation to create a smooth starting guess
    const R = 5; // search window radius (11x11 window)
    for (let k = 0; k < sortedMaskedIdxs.length; k++) {
      const idx = sortedMaskedIdxs[k];
      const cx = idx % width;
      const cy = Math.floor(idx / width);

      let sumR = 0, sumG = 0, sumB = 0, sumW = 0;

      for (let dy = -R; dy <= R; dy++) {
        const ny = cy + dy;
        if (ny < minY || ny > maxY) continue;
        const nRowOffset = ny * width;

        for (let dx = -R; dx <= R; dx++) {
          const nx = cx + dx;
          if (nx < minX || nx > maxX) continue;

          const nidx = nRowOffset + nx;
          if (isKnown[nidx]) {
            const d2 = dx * dx + dy * dy;
            if (d2 === 0) continue;
            const w = 1.0 / (d2 * Math.sqrt(d2));
            sumR += w * imgData.data[4 * nidx];
            sumG += w * imgData.data[4 * nidx + 1];
            sumB += w * imgData.data[4 * nidx + 2];
            sumW += w;
          }
        }
      }

      if (sumW > 0) {
        imgData.data[4 * idx] = Math.round(sumR / sumW);
        imgData.data[4 * idx + 1] = Math.round(sumG / sumW);
        imgData.data[4 * idx + 2] = Math.round(sumB / sumW);
        isKnown[idx] = 1; // Mark as known to propagate inward
      } else {
        // Fallback: search a wider area for nearest known pixel and copy color
        let nearestIdx = -1;
        let minD2 = Infinity;
        for (let dy = -R * 2; dy <= R * 2; dy++) {
          const ny = cy + dy;
          if (ny < minY || ny > maxY) continue;
          const nRowOffset = ny * width;
          for (let dx = -R * 2; dx <= R * 2; dx++) {
            const nx = cx + dx;
            if (nx < minX || nx > maxX) continue;
            const nidx = nRowOffset + nx;
            if (isKnown[nidx]) {
              const d2 = dx * dx + dy * dy;
              if (d2 < minD2) {
                minD2 = d2;
                nearestIdx = nidx;
              }
            }
          }
        }
        if (nearestIdx !== -1) {
          imgData.data[4 * idx] = imgData.data[4 * nearestIdx];
          imgData.data[4 * idx + 1] = imgData.data[4 * nearestIdx + 1];
          imgData.data[4 * idx + 2] = imgData.data[4 * nearestIdx + 2];
          isKnown[idx] = 1;
        }
      }
    }

    // 5. Gauss-Seidel Laplace Solver relaxation (150 iterations)
    // Propagates lighting and boundary colors smoothly to initialize the lighting grid.
    const iterations = 150;
    for (let iter = 0; iter < iterations; iter++) {
      for (let k = 0; k < sortedMaskedIdxs.length; k++) {
        const idx = sortedMaskedIdxs[k];
        const cx = idx % width;
        const cy = Math.floor(idx / width);

        let sumR = 0, sumG = 0, sumB = 0;
        let count = 0;

        // Check 4-connected neighbors
        if (cx > minX) {
          const nidx = idx - 1;
          sumR += imgData.data[4 * nidx];
          sumG += imgData.data[4 * nidx + 1];
          sumB += imgData.data[4 * nidx + 2];
          count++;
        }
        if (cx < maxX) {
          const nidx = idx + 1;
          sumR += imgData.data[4 * nidx];
          sumG += imgData.data[4 * nidx + 1];
          sumB += imgData.data[4 * nidx + 2];
          count++;
        }
        if (cy > minY) {
          const nidx = idx - width;
          sumR += imgData.data[4 * nidx];
          sumG += imgData.data[4 * nidx + 1];
          sumB += imgData.data[4 * nidx + 2];
          count++;
        }
        if (cy < maxY) {
          const nidx = idx + width;
          sumR += imgData.data[4 * nidx];
          sumG += imgData.data[4 * nidx + 1];
          sumB += imgData.data[4 * nidx + 2];
          count++;
        }

        if (count > 0) {
          imgData.data[4 * idx] = Math.round(sumR / count);
          imgData.data[4 * idx + 1] = Math.round(sumG / count);
          imgData.data[4 * idx + 2] = Math.round(sumB / count);
        }
      }
    }

    // 6. Content-Aware Texture Synthesis (Zero-Mean Patch Matching with Boundary Blending)
    // Searches the nearby unmasked region for matching texture (like linen weave)
    // using Zero-Mean Sum of Squared Differences (ZSSD) to be invariant to lighting variations.
    // We use a step = 1 (pixel-perfect alignment) and patchR = 5 (11x11 patch size)
    // and blend the copied patch near the mask boundary based on the distance transform.
    const searchRadius = 35; // 70x70 search space around target
    const step = 1; // Step of 1 for pixel-perfect phase alignment of woven threads
    const patchR = 5; // 11x11 patch size to capture broader woven structure
    const rampWidth = Math.max(3, Math.min(8, Math.round(width / 350))); // Resolution-scaled boundary blend ramp

    for (let k = 0; k < sortedMaskedIdxs.length; k++) {
      const idx = sortedMaskedIdxs[k];
      if (isMasked[idx] === 0) continue; // Already filled by a previous patch copy

      const cx = idx % width;
      const cy = Math.floor(idx / width);

      let minSSD = Infinity;
      let bestSX = cx;
      let bestSY = cy;

      // Local search grid
      for (let sdy = -searchRadius; sdy <= searchRadius; sdy += step) {
        const sy = cy + sdy;
        if (sy - patchR < 0 || sy + patchR >= height) continue;

        for (let sdx = -searchRadius; sdx <= searchRadius; sdx += step) {
          const sx = cx + sdx;
          if (sx - patchR < 0 || sx + patchR >= width) continue;

          // Source patch candidate must be completely clean (originally unmasked)
          let hasMaskInSource = false;
          for (let py = -patchR; py <= patchR; py++) {
            const sRow = (sy + py) * width;
            for (let px = -patchR; px <= patchR; px++) {
              if (originallyMasked[sRow + (sx + px)]) {
                hasMaskInSource = true;
                break;
              }
            }
            if (hasMaskInSource) break;
          }

          if (hasMaskInSource) continue;

          // Compute means of target and candidate on known texture pixels (isMasked === 0)
          let sumT_R = 0, sumT_G = 0, sumT_B = 0;
          let sumS_R = 0, sumS_G = 0, sumS_B = 0;
          let count = 0;

          for (let py = -patchR; py <= patchR; py++) {
            const tRow = (cy + py) * width;
            const sRow = (sy + py) * width;
            for (let px = -patchR; px <= patchR; px++) {
              const tIdx = tRow + (cx + px);
              if (isMasked[tIdx] === 0) { // Known texture pixel
                const sIdx = sRow + (sx + px);
                sumT_R += imgData.data[4 * tIdx];
                sumT_G += imgData.data[4 * tIdx + 1];
                sumT_B += imgData.data[4 * tIdx + 2];

                sumS_R += imgData.data[4 * sIdx];
                sumS_G += imgData.data[4 * sIdx + 1];
                sumS_B += imgData.data[4 * sIdx + 2];
                count++;
              }
            }
          }

          if (count > 0) {
            const meanT_R = sumT_R / count;
            const meanT_G = sumT_G / count;
            const meanT_B = sumT_B / count;

            const meanS_R = sumS_R / count;
            const meanS_G = sumS_G / count;
            const meanS_B = sumS_B / count;

            // Compute Zero-Mean SSD (ZSSD)
            let zssd = 0;
            for (let py = -patchR; py <= patchR; py++) {
              const tRow = (cy + py) * width;
              const sRow = (sy + py) * width;
              for (let px = -patchR; px <= patchR; px++) {
                const tIdx = tRow + (cx + px);
                if (isMasked[tIdx] === 0) {
                  const sIdx = sRow + (sx + px);
                  const zeroT_R = imgData.data[4 * tIdx] - meanT_R;
                  const zeroT_G = imgData.data[4 * tIdx + 1] - meanT_G;
                  const zeroT_B = imgData.data[4 * tIdx + 2] - meanT_B;

                  const zeroS_R = imgData.data[4 * sIdx] - meanS_R;
                  const zeroS_G = imgData.data[4 * sIdx + 1] - meanS_G;
                  const zeroS_B = imgData.data[4 * sIdx + 2] - meanS_B;

                  const dr = zeroT_R - zeroS_R;
                  const dg = zeroT_G - zeroS_G;
                  const db = zeroT_B - zeroS_B;

                  zssd += dr * dr + dg * dg + db * db;
                }
              }
            }

            const score = zssd / count; // Normalized ZSSD score
            if (score < minSSD) {
              minSSD = score;
              bestSX = sx;
              bestSY = sy;
            }
          }
        }
      }

      // If a valid texture patch was found, copy it with lighting correction and boundary blending
      if (bestSX !== cx || bestSY !== cy) {
        let sumDiffR = 0, sumDiffG = 0, sumDiffB = 0;
        let diffCount = 0;

        for (let py = -patchR; py <= patchR; py++) {
          const tRow = (cy + py) * width;
          const sRow = (bestSY + py) * width;
          for (let px = -patchR; px <= patchR; px++) {
            const tIdx = tRow + (cx + px);
            if (isMasked[tIdx] === 0) { // On known pixels
              const sIdx = sRow + (bestSX + px);
              sumDiffR += imgData.data[4 * tIdx] - imgData.data[4 * sIdx];
              sumDiffG += imgData.data[4 * tIdx + 1] - imgData.data[4 * sIdx + 1];
              sumDiffB += imgData.data[4 * tIdx + 2] - imgData.data[4 * sIdx + 2];
              diffCount++;
            }
          }
        }

        if (diffCount === 0) {
          for (let py = -patchR; py <= patchR; py++) {
            const tRow = (cy + py) * width;
            const sRow = (bestSY + py) * width;
            for (let px = -patchR; px <= patchR; px++) {
              const tIdx = tRow + (cx + px);
              const sIdx = sRow + (bestSX + px);
              sumDiffR += imgData.data[4 * tIdx] - imgData.data[4 * sIdx];
              sumDiffG += imgData.data[4 * tIdx + 1] - imgData.data[4 * sIdx + 1];
              sumDiffB += imgData.data[4 * tIdx + 2] - imgData.data[4 * sIdx + 2];
              diffCount++;
            }
          }
        }

        const meanDiffR = sumDiffR / diffCount;
        const meanDiffG = sumDiffG / diffCount;
        const meanDiffB = sumDiffB / diffCount;

        // Copy pixels into target patch with dynamic boundary distance feathering
        for (let py = -patchR; py <= patchR; py++) {
          const tRow = (cy + py) * width;
          const sRow = (bestSY + py) * width;
          for (let px = -patchR; px <= patchR; px++) {
            const tx = cx + px;
            const ty = cy + py;
            if (tx >= 0 && tx < width && ty >= 0 && ty < height) {
              const tIdx = tRow + tx;
              if (isMasked[tIdx] === 1) { // Only copy to unfilled pixels
                const sIdx = sRow + (bestSX + px);

                const srcR = clamp(Math.round(imgData.data[4 * sIdx] + meanDiffR));
                const srcG = clamp(Math.round(imgData.data[4 * sIdx + 1] + meanDiffG));
                const srcB = clamp(Math.round(imgData.data[4 * sIdx + 2] + meanDiffB));

                // Feather blend at mask boundaries
                const dist = distances[tIdx];
                const wBlend = dist === Infinity ? 1.0 : Math.min(1.0, dist / rampWidth);

                if (wBlend < 1.0) {
                  const bgR = imgData.data[4 * tIdx];
                  const bgG = imgData.data[4 * tIdx + 1];
                  const bgB = imgData.data[4 * tIdx + 2];

                  imgData.data[4 * tIdx] = Math.round(wBlend * srcR + (1.0 - wBlend) * bgR);
                  imgData.data[4 * tIdx + 1] = Math.round(wBlend * srcG + (1.0 - wBlend) * bgG);
                  imgData.data[4 * tIdx + 2] = Math.round(wBlend * srcB + (1.0 - wBlend) * bgB);
                } else {
                  imgData.data[4 * tIdx] = srcR;
                  imgData.data[4 * tIdx + 1] = srcG;
                  imgData.data[4 * tIdx + 2] = srcB;
                }

                isMasked[tIdx] = 0; // Mark as filled/known
              }
            }
          }
        }
      }
    }

    // 7. Micro-sensor noise grain fallback for any unfilled pixels
    for (let k = 0; k < sortedMaskedIdxs.length; k++) {
      const idx = sortedMaskedIdxs[k];
      if (originallyMasked[idx]) {
        const grain = (Math.random() - 0.5) * 2.0;
        imgData.data[4 * idx] = clamp(Math.round(imgData.data[4 * idx] + grain));
        imgData.data[4 * idx + 1] = clamp(Math.round(imgData.data[4 * idx + 1] + grain));
        imgData.data[4 * idx + 2] = clamp(Math.round(imgData.data[4 * idx + 2] + grain));
      }
    }
  }

  // Download high-resolution restored image
  downloadResult() {
    if (!this.hasResult()) return;

    const dataUrl = this.originalCanvas.toDataURL('image/jpeg', 0.95);
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `selleros_watermark_free_${Date.now()}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Load preset demo samples dynamically generated on the fly via canvas!
  loadSampleImage(sampleName: string) {
    this.activeSample.set(sampleName);
    this.isProcessing.set(true);

    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 1000;
    const ctx = canvas.getContext('2d')!;

    if (sampleName === 'kurti') {
      // Generate a colorful cotton fabric pattern with ethnic curves
      const gradient = ctx.createLinearGradient(0, 0, 1000, 1000);
      gradient.addColorStop(0, '#fef08a'); // Warm yellow
      gradient.addColorStop(0.5, '#f472b6'); // Pastel pink
      gradient.addColorStop(1, '#818cf8'); // Soft Indigo
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 1000, 1000);

      // Draw ethnic striped texture lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 4;
      for (let i = -1000; i < 1000; i += 40) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.bezierCurveTo(i + 300, 300, i - 300, 700, i + 1000, 1000);
        ctx.stroke();
      }

      // Draw Kurti silhouette outline
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.beginPath();
      ctx.moveTo(350, 200);
      ctx.lineTo(650, 200);
      ctx.lineTo(750, 450);
      ctx.lineTo(680, 500);
      ctx.lineTo(800, 900);
      ctx.lineTo(200, 900);
      ctx.lineTo(320, 500);
      ctx.lineTo(250, 450);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 6;
      ctx.stroke();

      // Bake a simulated AI watermark text on it
      ctx.save();
      ctx.translate(500, 500);
      ctx.rotate(-Math.PI / 8);
      ctx.font = '700 48px "Outfit", "Inter", sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)'; // Semi-transparent white
      ctx.textAlign = 'center';
      ctx.fillText('STOCK SHOT - PROHIBITED COPY', 0, -20);
      
      ctx.font = '500 24px "Inter", sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.fillText('PROTECTED BY INTELLECTUAL PROPERTY LAW', 0, 20);
      ctx.restore();

    } else if (sampleName === 'shoe') {
      // Dynamic Shoe canvas generator
      const gradient = ctx.createRadialGradient(500, 500, 50, 500, 500, 600);
      gradient.addColorStop(0, '#1e293b'); // Dark Slate
      gradient.addColorStop(1, '#0f172a'); // Deep navy
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 1000, 1000);

      // Draw decorative neon rings in background
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.1)';
      ctx.lineWidth = 15;
      ctx.beginPath();
      ctx.arc(500, 500, 250, 0, Math.PI * 2);
      ctx.stroke();

      // Draw mockup Shoe silhouette
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 10;
      ctx.fillStyle = '#4f46e50d';
      ctx.beginPath();
      ctx.moveTo(250, 650);
      ctx.bezierCurveTo(270, 550, 400, 500, 500, 400);
      ctx.bezierCurveTo(550, 350, 680, 320, 750, 450);
      ctx.bezierCurveTo(800, 550, 850, 600, 800, 650);
      ctx.bezierCurveTo(700, 670, 400, 670, 250, 650);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Simulated grid watermark
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1.5;
      for (let y = 100; y < 900; y += 150) {
        ctx.beginPath();
        ctx.moveTo(100, y);
        ctx.lineTo(900, y);
        ctx.stroke();
      }
      for (let x = 100; x < 900; x += 150) {
        ctx.beginPath();
        ctx.moveTo(x, 100);
        ctx.lineTo(x, 900);
        ctx.stroke();
      }

      // Main diagonal text watermark
      ctx.save();
      ctx.translate(500, 500);
      ctx.rotate(-Math.PI / 6);
      ctx.font = '800 64px "Outfit", sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.38)';
      ctx.textAlign = 'center';
      ctx.fillText('AI GENERATED DEMO PHOTO', 0, 0);
      ctx.restore();

    } else {
      // Sample 3: Watch
      ctx.fillStyle = '#111827';
      ctx.fillRect(0, 0, 1000, 1000);

      // Gold-like circular gradient ring representing watch body
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.arc(500, 500, 200, 0, Math.PI * 2);
      ctx.stroke();

      // Subtle dials
      ctx.fillStyle = 'rgba(245, 158, 11, 0.15)';
      ctx.beginPath();
      ctx.arc(500, 500, 185, 0, Math.PI * 2);
      ctx.fill();

      // Hands
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(500, 500);
      ctx.lineTo(500, 360); // 12 o'clock hand
      ctx.moveTo(500, 500);
      ctx.lineTo(620, 500); // 3 o'clock hand
      ctx.stroke();

      // Grid watermarks
      ctx.font = '600 28px "Inter", sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.textAlign = 'center';
      for (let y = 150; y < 900; y += 200) {
        for (let x = 150; x < 900; x += 300) {
          ctx.fillText('PREVIEW ONLY', x, y);
        }
      }
    }

    // Convert generated canvas to data URL and load it
    const dataUrl = canvas.toDataURL('image/png');
    this.loadImage(dataUrl, true);
  }
}
