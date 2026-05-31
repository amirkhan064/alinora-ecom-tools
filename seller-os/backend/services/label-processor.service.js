const { PDFDocument, rgb, PDFStream, PDFArray, decodePDFRawStream } = require('pdf-lib');
const archiver = require('archiver');
const { Readable } = require('stream');

/**
 * Ultra-fast text extraction directly from PDF content streams using pdf-lib.
 * This bypasses the heavy pdfjs rendering pipeline entirely by reading raw
 * PDF text operators (Tj, TJ, ', ") from the content stream bytes.
 * 
 * For our use case (keyword matching for SKU, Order ID, page classification),
 * this is 10-50x faster than pdf-parse on real-world shipping label PDFs.
 */
function extractTextFast(page, pdfDoc) {
  try {
    const contents = page.node.Contents();
    if (!contents) return '';

    const streams = [];
    if (contents instanceof PDFStream) {
      streams.push(contents);
    } else if (contents instanceof PDFArray) {
      for (let i = 0; i < contents.size(); i++) {
        const ref = contents.get(i);
        const resolved = pdfDoc.context.lookup(ref);
        if (resolved instanceof PDFStream) {
          streams.push(resolved);
        }
      }
    }

    const textParts = [];
    for (const stream of streams) {
      const decoded = decodePDFRawStream(stream);
      const bytes = decoded.decode();
      const raw = Buffer.from(bytes).toString('latin1');

      // Match hex strings followed by Tj operator: <hex> Tj
      const hexTjRegex = /<([0-9a-fA-F]+)>\s*Tj/g;
      let match;
      while ((match = hexTjRegex.exec(raw)) !== null) {
        const hex = match[1];
        let text = '';
        for (let i = 0; i < hex.length; i += 2) {
          text += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
        }
        textParts.push(text);
      }

      // Match parenthesized strings followed by Tj operator: (text) Tj
      const parenTjRegex = /\(([^)]*)\)\s*Tj/g;
      while ((match = parenTjRegex.exec(raw)) !== null) {
        textParts.push(match[1]);
      }

      // TJ arrays: [<hex> kerning <hex> ...] TJ  or  [(text) kerning (text) ...] TJ
      const tjArrayRegex = /\[((?:[^[\]]*?))\]\s*TJ/g;
      while ((match = tjArrayRegex.exec(raw)) !== null) {
        const inner = match[1];
        // Extract hex strings from array
        const hexInner = /<([0-9a-fA-F]+)>/g;
        let hexMatch;
        while ((hexMatch = hexInner.exec(inner)) !== null) {
          const hex = hexMatch[1];
          let text = '';
          for (let i = 0; i < hex.length; i += 2) {
            text += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
          }
          textParts.push(text);
        }
        // Extract parenthesized strings from array
        const parenInner = /\(([^)]*)\)/g;
        let parenMatch;
        while ((parenMatch = parenInner.exec(inner)) !== null) {
          textParts.push(parenMatch[1]);
        }
      }
    }

    return textParts.join(' ');
  } catch (e) {
    return '';
  }
}

/**
 * Scans page text to find Order IDs, SKUs, and Date strings.
 */
function parseMetadata(text, platform) {
  let orderId = 'UNKNOWN';
  let sku = 'UNKNOWN';
  let dateStr = 'UNKNOWN';

  // 1. Extract Order ID based on platform patterns
  if (platform === 'amazon') {
    // Amazon order format: e.g. 403-1234567-1234567
    const match = text.match(/\b\d{3}-\d{7}-\d{7}\b/);
    if (match) orderId = match[0];
  } else if (platform === 'flipkart') {
    // Flipkart order format: e.g. OD123456789012345678
    const match = text.match(/\bOD\d{15,20}\b/i);
    if (match) orderId = match[0].toUpperCase();
  } else if (platform === 'myntra') {
    // Myntra order format: e.g. 10-15 digit numeric or standard alphanumeric
    const match = text.match(/\b[A-Z0-9-]{10,16}\b/i) || text.match(/\b\d{10,16}\b/);
    if (match) orderId = match[0];
  } else {
    // General order ID extraction fallback (alphanumeric, length 12-20)
    const match = text.match(/\b(Order[ -]?ID|Ord[ -]?No|ID)[:\s]+([A-Z0-9-]{12,20})\b/i) || 
                  text.match(/\b([A-Z0-9-]{12,20})\b/);
    if (match) orderId = match[2] || match[1];
  }

  if (orderId === 'UNKNOWN') {
    // Fallback: search for first sequence of 10+ digits
    const match = text.match(/\b\d{10,20}\b/);
    if (match) orderId = match[0];
  }

  // 2. Extract SKU names
  // Looks for terms like "SKU", "Listing ID", "Item Code", or capitalized codes
  const skuRegexes = [
    /SKU\s*(?:Code|Name|Id)?\s*[:\-]?\s*([A-Z0-9_\-\.\/]+)/i,
    /Listing\s*(?:Code|Name|Id)?\s*[:\-]?\s*([A-Z0-9_\-\.\/]+)/i,
    /Item\s*(?:Code|Name)?\s*[:\-]?\s*([A-Z0-9_\-\.\/]+)/i,
    /Style\s*(?:Code|Name)?\s*[:\-]?\s*([A-Z0-9_\-\.\/]+)/i
  ];

  for (const regex of skuRegexes) {
    const match = text.match(regex);
    if (match && match[1]) {
      sku = match[1].trim();
      break;
    }
  }

  // Fallback: search for words in brackets or parentheses that look like SKUs
  if (sku === 'UNKNOWN') {
    const match = text.match(/\[([A-Z0-9_\-\.]{5,20})\]/);
    if (match) sku = match[1];
  }

  // 3. Extract Date
  const dateMatch = text.match(/\b\d{2}[\-\/\.]\d{2}[\-\/\.]\d{4}\b/) || 
                    text.match(/\b\d{4}[\-\/\.]\d{2}[\-\/\.]\d{2}\b/);
  if (dateMatch) {
    dateStr = dateMatch[0];
  } else {
    // Fallback to current date if not found
    const d = new Date();
    dateStr = `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
  }

  return { orderId, sku, date: dateStr };
}

/**
 * Classifies a page as a Shipping Label or Tax Invoice.
 */
function classifyPage(text) {
  const lowerText = text.toLowerCase();
  
  // Invoice indicators
  const invoiceKeywords = [
    'tax invoice',
    'retail invoice',
    'invoice number',
    'taxable value',
    'cgst',
    'sgst',
    'igst',
    'gstin',
    'hsn',
    'billing address',
    'invoice date',
    'serial number'
  ];

  // Label indicators
  const labelKeywords = [
    'logistics partner',
    'courier',
    'prepaid',
    'collect',
    'cod',
    'tracking id',
    'awb',
    'routing',
    'return address',
    'delivery address',
    'shipping address',
    'ordered through',
    'flipkart',
    'meesho',
    'amazon',
    'myntra',
    'ppmp',
    'myntra logistics',
    'm-direct',
    'ndp',
    'nmf',
    'easy ship',
    'ats logistics',
    'ekart logistics',
    'delhivery',
    'shipping label',
    'handover',
    'barcode'
  ];

  let invoiceScore = 0;
  let labelScore = 0;

  invoiceKeywords.forEach(k => {
    if (lowerText.includes(k)) invoiceScore += 1.5;
  });

  labelKeywords.forEach(k => {
    if (lowerText.includes(k)) labelScore += 1.0;
  });

  // Combined pages with labels should be treated as labels so they can be cropped.
  // Only classify as invoice if there are invoice indicators but no label indicators.
  let pageType = 'label';
  if (labelScore > 0) {
    pageType = 'label';
  } else if (invoiceScore > 0) {
    pageType = 'invoice';
  } else {
    pageType = 'label'; // default fallback for scanned/unparsed pages
  }

  return pageType;
}

/**
 * Crops a single PDF page buffer to target platform boundaries.
 */
async function cropPage(page, platform) {
  const width = page.getWidth();
  const height = page.getHeight();

  // If the page is already small (e.g. native 4x6 labels), don't crop it
  if (width < 450 && height < 600) {
    return;
  }

  if (platform === 'flipkart' || platform === 'myntra') {
    // Target 3" x 5" = 216 x 360 points. Flipkart & Myntra labels are often top-left.
    const cropW = 230;
    const cropH = 380;
    // Set crop boundaries at the top left
    page.setCropBox(0, height - cropH, cropW, cropH);
    page.setMediaBox(0, height - cropH, cropW, cropH);
  } else if (platform === 'meesho') {
    // Target 4" x 5" = 288 x 360 points. Meesho labels are top-left.
    const cropW = 300;
    const cropH = 380;
    // Set crop boundaries at the top left
    page.setCropBox(0, height - cropH, cropW, cropH);
    page.setMediaBox(0, height - cropH, cropW, cropH);
  } else {
    // Target 4" x 6" = 288 x 432 points. Amazon labels are often top-left.
    const cropW = 300;
    const cropH = 450;
    // Set crop boundaries at the top left
    page.setCropBox(0, height - cropH, cropW, cropH);
    page.setMediaBox(0, height - cropH, cropW, cropH);
  }
}
// Helper to execute asynchronous tasks concurrently with a maximum limit
async function mapConcurrent(items, limit, fn) {
  const results = [];
  const executing = new Set();
  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item));
    results.push(p);
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean, clean);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  return Promise.all(results);
}

// Batch copies pages from source documents to a target PDF document at once.
// Uses cached PDFDocument instances from loadedDocs to eliminate redundant loads.
// Returns a Map of originalFilename -> Map(pageIndex -> copiedPageInstance)
async function batchCopyPages(targetPdf, pageItems, loadedDocs) {
  if (pageItems.length === 0) return new Map();

  const pagesByFile = new Map();
  for (const item of pageItems) {
    if (!pagesByFile.has(item.originalFilename)) {
      pagesByFile.set(item.originalFilename, []);
    }
    pagesByFile.get(item.originalFilename).push(item);
  }

  const copiedPagesMap = new Map();
  for (const [filename, items] of pagesByFile.entries()) {
    let srcDoc = loadedDocs.get(filename);
    if (!srcDoc) {
      srcDoc = await PDFDocument.load(items[0].fileBuffer, { ignoreEncryption: true });
      loadedDocs.set(filename, srcDoc);
    }
    const indices = items.map(item => item.pageIndex);
    const copied = await targetPdf.copyPages(srcDoc, indices);
    
    const fileCopiedMap = new Map();
    items.forEach((item, i) => {
      fileCopiedMap.set(item.pageIndex, copied[i]);
    });
    copiedPagesMap.set(filename, fileCopiedMap);
  }

  return copiedPagesMap;
}

// Direct embedding helper: uses cached PDFDocument instances from loadedDocs, crops in-place, overlays custom text,
// embeds pages into the target document, and returns a Map of originalFilename -> Map(pageIndex -> embeddedPageInstance)
async function batchEmbedPages(targetPdf, pageItems, platform, customText, loadedDocs) {
  if (pageItems.length === 0) return new Map();

  const pagesByFile = new Map();
  for (const item of pageItems) {
    if (!pagesByFile.has(item.originalFilename)) {
      pagesByFile.set(item.originalFilename, []);
    }
    pagesByFile.get(item.originalFilename).push(item);
  }

  const embeddedPagesMap = new Map();
  for (const [filename, items] of pagesByFile.entries()) {
    let srcDoc = loadedDocs.get(filename);
    if (!srcDoc) {
      srcDoc = await PDFDocument.load(items[0].fileBuffer, { ignoreEncryption: true });
      loadedDocs.set(filename, srcDoc);
    }
    const pagesToEmbed = [];
    
    for (const item of items) {
      const srcPage = srcDoc.getPage(item.pageIndex);
      const originalWidth = srcPage.getWidth();
      const originalHeight = srcPage.getHeight();

      if (originalWidth >= 450 || originalHeight >= 600) {
        let cropWidth = originalWidth;
        let cropHeight = originalHeight;
        let x = 0;
        let y = originalHeight - cropHeight;

        if (platform === 'amazon') {
          cropWidth = 296;
          cropHeight = 436;
          x = (originalWidth - cropWidth) / 2;
          y = originalHeight - cropHeight - 13;
        } else if (platform === 'meesho') {
          cropWidth = 296;
          cropHeight = 364;
          x = (originalWidth - cropWidth) / 2;
          y = originalHeight - cropHeight - 13;
        } else if (platform === 'myntra' || platform === 'flipkart') {
          cropWidth = 224;
          cropHeight = 364;
          x = (originalWidth - cropWidth) / 2;
          y = originalHeight - cropHeight - 23;
        }

        srcPage.setCropBox(x, y, cropWidth, cropHeight);
        srcPage.setMediaBox(x, y, cropWidth, cropHeight);

        if (customText) {
          const fontSize = 7;
          const textWidth = customText.length * 3.5;
          srcPage.drawRectangle({
            x: x,
            y: y,
            width: cropWidth,
            height: 12,
            color: rgb(1, 1, 1),
          });
          srcPage.drawText(customText, {
            x: x + (cropWidth - textWidth) / 2,
            y: y + 3,
            size: fontSize,
            color: rgb(0, 0, 0),
          });
        }
      }
      pagesToEmbed.push(srcPage);
    }

    const embedded = await targetPdf.embedPages(pagesToEmbed);
    
    const fileEmbeddedMap = new Map();
    items.forEach((item, i) => {
      fileEmbeddedMap.set(item.pageIndex, embedded[i]);
    });
    embeddedPagesMap.set(filename, fileEmbeddedMap);
  }

  return embeddedPagesMap;
}


/**
 * Core Processing Pipeline Service
 */
async function processLabels(files, { platform, sortBy, sortOrder, outputType, mergeLabels = 'false', customText = '' }) {
  const startTime = Date.now();
  console.log(`[LabelProcessor] Starting process: platform=${platform}, sortBy=${sortBy}, sortOrder=${sortOrder}, outputType=${outputType}, mergeLabels=${mergeLabels}, customText="${customText}"`);
  
  if (!files || files.length === 0) {
    throw new Error('No files uploaded to process.');
  }

  const allPages = [];
  const loadedDocs = new Map();

  // Step 1: Ultra-fast text extraction using pdf-lib content stream parsing
  // This replaces the extremely heavy pdf-parse library which takes 45+ seconds on real shipping labels.
  // pdf-lib reads raw PDF text operators (Tj/TJ) directly from content streams — no rendering pipeline needed.
  const tIngestionStart = Date.now();
  
  // Parse all files concurrently with a limit of 20 concurrent tasks
  const filesResults = await mapConcurrent(files, 20, async (file) => {
    console.log(`[LabelProcessor] Loading file: ${file.originalname}`);
    const fileBuffer = Buffer.from(file.buffer);
    const filePages = [];
    
    try {
      const pdfDoc = await PDFDocument.load(fileBuffer, { ignoreEncryption: true });
      loadedDocs.set(file.originalname, pdfDoc);
      const pages = pdfDoc.getPages();
      
      for (let index = 0; index < pages.length; index++) {
        const page = pages[index];
        let text = '';
        try {
          text = extractTextFast(page, pdfDoc);
        } catch (err) {
          console.error(`[LabelProcessor] Fast text extraction failed on page ${index} of ${file.originalname}:`, err.message);
        }
        const metadata = parseMetadata(text, platform);
        const pageType = classifyPage(text);

        filePages.push({
          fileBuffer,
          pageIndex: index,
          text,
          metadata,
          pageType,
          originalFilename: file.originalname
        });
      }
    } catch (error) {
      console.error(`[LabelProcessor] Error parsing file ${file.originalname}:`, error);
      
      // Fallback: If parsing fails, try loading without text extraction
      try {
        let pdfDoc = loadedDocs.get(file.originalname);
        if (!pdfDoc) {
          pdfDoc = await PDFDocument.load(fileBuffer, { ignoreEncryption: true });
          loadedDocs.set(file.originalname, pdfDoc);
        }
        const pageCount = pdfDoc.getPageCount();
        console.log(`[LabelProcessor] Executing fallback for ${file.originalname} (${pageCount} pages)`);
        for (let index = 0; index < pageCount; index++) {
          filePages.push({
            fileBuffer,
            pageIndex: index,
            text: '',
            metadata: parseMetadata('', platform),
            pageType: 'label',
            originalFilename: file.originalname
          });
        }
      } catch (fallbackErr) {
        console.error(`[LabelProcessor] Failed to load ${file.originalname} even for fallback:`, fallbackErr);
      }
    }
    return filePages;
  });

  for (const filePages of filesResults) {
    allPages.push(...filePages);
  }

  console.log(`[LabelProcessor] Step 1: Text extraction completed: ${allPages.length} pages in ${Date.now() - tIngestionStart}ms.`);

  // Step 2: Filter page types based on outputType
  // outputType: 'labels' (labels only), 'invoices' (invoices only), 'zip' (labels + invoices separated)
  let filteredPages = [...allPages];
  if (outputType === 'labels') {
    filteredPages = allPages.filter(p => p.pageType === 'label');
  } else if (outputType === 'invoices') {
    filteredPages = allPages.filter(p => p.pageType === 'invoice');
  }

  // Step 3: Sort page list according to criteria
  const tSortStart = Date.now();
  filteredPages.sort((a, b) => {
    let valA = a.metadata[sortBy] || '';
    let valB = b.metadata[sortBy] || '';

    // Case insensitive sorting
    valA = typeof valA === 'string' ? valA.toLowerCase() : valA;
    valB = typeof valB === 'string' ? valB.toLowerCase() : valB;

    if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
    if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  console.log(`[LabelProcessor] Step 2 & 3: Filtering & Sorting: ${Date.now() - tSortStart}ms. Pages count = ${filteredPages.length}`);

  // Step 4 & 5: Compile consolidated documents & apply cropping
  const isMerging = mergeLabels === 'true';
  const tCompileStart = Date.now();

  if (outputType === 'zip') {
    // Return a ZIP containing separate sorted labels and invoices
    const labelPages = filteredPages.filter(p => p.pageType === 'label');
    const invoicePages = filteredPages.filter(p => p.pageType === 'invoice');

    let labelsBuffer = null;

    if (isMerging) {
      if (labelPages.length > 0) {
        const mergedPdf = await PDFDocument.create();
        const embeddedLabelsMap = await batchEmbedPages(mergedPdf, labelPages, platform, customText, loadedDocs);

        const A4_W = 595;
        const A4_H = 842;
        const pad = 20;

        let curPg = mergedPdf.addPage([A4_W, A4_H]);
        let curX = pad;
        let curY = A4_H - pad;
        let maxRH = 0;

        for (const pageItem of labelPages) {
          const emb = embeddedLabelsMap.get(pageItem.originalFilename).get(pageItem.pageIndex);
          if (!emb) continue;

          if (curX + emb.width > A4_W - pad) {
            curX = pad;
            curY -= maxRH + pad;
            maxRH = 0;
          }
          if (curY - emb.height < pad) {
            curPg = mergedPdf.addPage([A4_W, A4_H]);
            curX = pad;
            curY = A4_H - pad;
            maxRH = 0;
          }
          curPg.drawPage(emb, { x: curX, y: curY - emb.height });
          curPg.drawRectangle({
            x: curX,
            y: curY - emb.height,
            width: emb.width,
            height: emb.height,
            borderColor: rgb(0.8, 0.8, 0.8),
            borderWidth: 0.5
          });
          curX += emb.width + pad;
          maxRH = Math.max(maxRH, emb.height);
        }
        labelsBuffer = Buffer.from(await mergedPdf.save({ useObjectStreams: false }));
      }
    } else {
      if (labelPages.length > 0) {
        const tempLabelsPdf = await PDFDocument.create();
        const copiedLabelsMap = await batchCopyPages(tempLabelsPdf, labelPages, loadedDocs);

        for (const pageItem of labelPages) {
          const copiedPage = copiedLabelsMap.get(pageItem.originalFilename).get(pageItem.pageIndex);
          const originalWidth = copiedPage.getWidth();
          const originalHeight = copiedPage.getHeight();

          if (originalWidth >= 450 || originalHeight >= 600) {
            let cropWidth = originalWidth;
            let cropHeight = originalHeight;
            let x = 0;
            let y = originalHeight - cropHeight;

            if (platform === 'amazon') {
              cropWidth = 296;
              cropHeight = 436;
              x = (originalWidth - cropWidth) / 2;
              y = originalHeight - cropHeight - 13;
            } else if (platform === 'meesho') {
              cropWidth = 296;
              cropHeight = 364;
              x = (originalWidth - cropWidth) / 2;
              y = originalHeight - cropHeight - 13;
            } else if (platform === 'myntra' || platform === 'flipkart') {
              cropWidth = 224;
              cropHeight = 364;
              x = (originalWidth - cropWidth) / 2;
              y = originalHeight - cropHeight - 23;
            }

            copiedPage.setCropBox(x, y, cropWidth, cropHeight);
            copiedPage.setMediaBox(x, y, cropWidth, cropHeight);

            if (customText) {
              const fontSize = 7;
              const textWidth = customText.length * 3.5;
              copiedPage.drawRectangle({
                x: x,
                y: y,
                width: cropWidth,
                height: 12,
                color: rgb(1, 1, 1),
              });
              copiedPage.drawText(customText, {
                x: x + (cropWidth - textWidth) / 2,
                y: y + 3,
                size: fontSize,
                color: rgb(0, 0, 0),
              });
            }
          }
          tempLabelsPdf.addPage(copiedPage);
        }
        labelsBuffer = Buffer.from(await tempLabelsPdf.save({ useObjectStreams: false }));
      }
    }

    // Compile Invoices (with Flipkart bottom invoice cropping)
    const invPdf = await PDFDocument.create();
    let invoicesBuffer = null;

    if (invoicePages.length > 0) {
      const copiedInvoicesMap = await batchCopyPages(invPdf, invoicePages, loadedDocs);
      for (const pageItem of invoicePages) {
        const copiedPage = copiedInvoicesMap.get(pageItem.originalFilename).get(pageItem.pageIndex);
        const originalWidth = copiedPage.getWidth();
        const originalHeight = copiedPage.getHeight();

        if (platform !== 'amazon' && platform !== 'meesho') {
          const labelH = 360;
          const invH = originalHeight - (labelH + 40);
          if (invH > 100) {
            copiedPage.setCropBox(0, 0, originalWidth, invH);
            copiedPage.setMediaBox(0, 0, originalWidth, invH);
          }
        }
        invPdf.addPage(copiedPage);
      }
      invoicesBuffer = Buffer.from(await invPdf.save({ useObjectStreams: false }));
    }

    console.log(`[LabelProcessor] Step 4 & 5: Compiling ZIP: ${Date.now() - tCompileStart}ms.`);
    console.log(`[LabelProcessor] Total time: ${Date.now() - startTime}ms.`);

    return {
      type: 'zip',
      labelBuffer: labelsBuffer,
      invoiceBuffer: invoicesBuffer
    };

  } else {
    // Return a single PDF containing sorted and cropped pages (Labels OR Invoices)
    const finalDoc = await PDFDocument.create();

    if (outputType === 'labels') {
      let labelsBuffer = null;
      if (isMerging) {
        if (filteredPages.length > 0) {
          const embeddedLabelsMap = await batchEmbedPages(finalDoc, filteredPages, platform, customText, loadedDocs);
          const A4_W = 595;
          const A4_H = 842;
          const pad = 20;

          let curPg = finalDoc.addPage([A4_W, A4_H]);
          let curX = pad;
          let curY = A4_H - pad;
          let maxRH = 0;

          for (const pageItem of filteredPages) {
            const emb = embeddedLabelsMap.get(pageItem.originalFilename).get(pageItem.pageIndex);
            if (!emb) continue;

            if (curX + emb.width > A4_W - pad) {
              curX = pad;
              curY -= maxRH + pad;
              maxRH = 0;
            }
            if (curY - emb.height < pad) {
              curPg = finalDoc.addPage([A4_W, A4_H]);
              curX = pad;
              curY = A4_H - pad;
              maxRH = 0;
            }
            curPg.drawPage(emb, { x: curX, y: curY - emb.height });
            curPg.drawRectangle({
              x: curX,
              y: curY - emb.height,
              width: emb.width,
              height: emb.height,
              borderColor: rgb(0.8, 0.8, 0.8),
              borderWidth: 0.5
            });
            curX += emb.width + pad;
            maxRH = Math.max(maxRH, emb.height);
          }
          labelsBuffer = Buffer.from(await finalDoc.save({ useObjectStreams: false }));
        }
      } else {
        if (filteredPages.length > 0) {
          const copiedLabelsMap = await batchCopyPages(finalDoc, filteredPages, loadedDocs);
          for (const pageItem of filteredPages) {
            const copiedPage = copiedLabelsMap.get(pageItem.originalFilename).get(pageItem.pageIndex);
            const originalWidth = copiedPage.getWidth();
            const originalHeight = copiedPage.getHeight();

            if (originalWidth >= 450 || originalHeight >= 600) {
              let cropWidth = originalWidth;
              let cropHeight = originalHeight;
              let x = 0;
              let y = originalHeight - cropHeight;

              if (platform === 'amazon') {
                cropWidth = 296;
                cropHeight = 436;
                x = (originalWidth - cropWidth) / 2;
                y = originalHeight - cropHeight - 13;
              } else if (platform === 'meesho') {
                cropWidth = 296;
                cropHeight = 364;
                x = (originalWidth - cropWidth) / 2;
                y = originalHeight - cropHeight - 13;
              } else if (platform === 'myntra' || platform === 'flipkart') {
                cropWidth = 224;
                cropHeight = 364;
                x = (originalWidth - cropWidth) / 2;
                y = originalHeight - cropHeight - 23;
              }

              copiedPage.setCropBox(x, y, cropWidth, cropHeight);
              copiedPage.setMediaBox(x, y, cropWidth, cropHeight);

              if (customText) {
                const fontSize = 7;
                const textWidth = customText.length * 3.5;
                copiedPage.drawRectangle({
                  x: x,
                  y: y,
                  width: cropWidth,
                  height: 12,
                  color: rgb(1, 1, 1),
                });
                copiedPage.drawText(customText, {
                  x: x + (cropWidth - textWidth) / 2,
                  y: y + 3,
                  size: fontSize,
                  color: rgb(0, 0, 0),
                });
              }
            }
            finalDoc.addPage(copiedPage);
          }
          labelsBuffer = Buffer.from(await finalDoc.save({ useObjectStreams: false }));
        }
      }

      console.log(`[LabelProcessor] Step 4 & 5: Compiling Single PDF file: ${Date.now() - tCompileStart}ms.`);
      console.log(`[LabelProcessor] Total time: ${Date.now() - startTime}ms.`);

      return {
        type: 'pdf',
        buffer: labelsBuffer
      };
    } else {
      // Invoices-Only (with Flipkart bottom invoice cropping)
      if (filteredPages.length > 0) {
        const copiedInvoicesMap = await batchCopyPages(finalDoc, filteredPages, loadedDocs);
        for (const pageItem of filteredPages) {
          const copiedPage = copiedInvoicesMap.get(pageItem.originalFilename).get(pageItem.pageIndex);
          const originalWidth = copiedPage.getWidth();
          const originalHeight = copiedPage.getHeight();

          if (platform !== 'amazon' && platform !== 'meesho') {
            const labelH = 360;
            const invH = originalHeight - (labelH + 40);
            if (invH > 100) {
              copiedPage.setCropBox(0, 0, originalWidth, invH);
              copiedPage.setMediaBox(0, 0, originalWidth, invH);
            }
          }
          finalDoc.addPage(copiedPage);
        }
      }
      const finalBuffer = Buffer.from(await finalDoc.save({ useObjectStreams: false }));

      console.log(`[LabelProcessor] Step 4 & 5: Compiling Single PDF file: ${Date.now() - tCompileStart}ms.`);
      console.log(`[LabelProcessor] Total time: ${Date.now() - startTime}ms.`);


      return {
        type: 'pdf',
        buffer: finalBuffer
      };
    }
  }
}

/**
 * Archives files into a ZIP stream.
 */
function createZipStream(labelBuffer, invoiceBuffer) {
  const archive = archiver('zip', { zlib: { level: 9 } });

  if (labelBuffer && labelBuffer.length > 0) {
    archive.append(labelBuffer, { name: 'sorted_cropped_labels.pdf' });
  }
  if (invoiceBuffer && invoiceBuffer.length > 0) {
    archive.append(invoiceBuffer, { name: 'sorted_invoices.pdf' });
  }

  // finalize the archive
  archive.finalize();
  return archive;
}

module.exports = {
  processLabels,
  createZipStream
};
