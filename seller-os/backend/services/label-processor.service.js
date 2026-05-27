const { PDFDocument, rgb } = require('pdf-lib');
const pdfParseModule = require('pdf-parse');
const archiver = require('archiver');
const { Readable } = require('stream');

/**
 * Parses text out of a single-page PDF buffer.
 */
async function extractTextFromPage(buffer) {
  const parser = new pdfParseModule.PDFParse({ data: buffer });
  try {
    const data = await parser.getText();
    return data.text || '';
  } catch (error) {
    console.error('[LabelProcessor] Error parsing PDF page text:', error);
    return '';
  } finally {
    await parser.destroy();
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

// Simple concurrent batching mapper to parse multiple files in parallel
async function pMap(items, mapper, concurrency) {
  const results = [];
  const batches = [];
  for (let i = 0; i < items.length; i += concurrency) {
    batches.push(items.slice(i, i + concurrency));
  }
  for (const batch of batches) {
    await Promise.all(batch.map(item => mapper(item)));
  }
}

// Keep a cache of embedded pages from source documents to target documents to prevent redundant resource compilation.
// Map key: targetPdfInstance (WeakMap) -> Map(originalFilename -> Array of PDFEmbeddedPage)
const globalEmbedCache = new WeakMap();

async function getEmbeddedPages(targetPdf, srcDoc, originalFilename) {
  if (!globalEmbedCache.has(targetPdf)) {
    globalEmbedCache.set(targetPdf, new Map());
  }
  const fileMap = globalEmbedCache.get(targetPdf);
  if (!fileMap.has(originalFilename)) {
    console.log(`[LabelProcessor] Pre-compiling batch embedded pages for source doc: ${originalFilename}`);
    const embedded = await targetPdf.embedPages(srcDoc.getPages());
    fileMap.set(originalFilename, embedded);
  }
  return fileMap.get(originalFilename);
}

// Batch copies pages from source documents to a target PDF document at once.
// Returns a Map of originalFilename -> Map(pageIndex -> copiedPageInstance)
async function batchCopyPages(targetPdf, pageItems, loadedDocsMap) {
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
    const srcDoc = loadedDocsMap.get(filename) || await PDFDocument.load(items[0].fileBuffer);
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

/**
 * Core Processing Pipeline Service
 */
async function processLabels(files, { platform, sortBy, sortOrder, outputType, mergeLabels = 'false', customText = '' }) {
  console.log(`[LabelProcessor] Starting process: platform=${platform}, sortBy=${sortBy}, sortOrder=${sortOrder}, outputType=${outputType}, mergeLabels=${mergeLabels}, customText="${customText}"`);
  
  if (!files || files.length === 0) {
    throw new Error('No files uploaded to process.');
  }

  const allPages = [];
  const loadedDocsMap = new Map(); // file.originalname -> PDFDocument

  await pMap(files, async (file) => {
    console.log(`[LabelProcessor] Parsing file concurrently: ${file.originalname}`);
    const parser = new pdfParseModule.PDFParse({ data: file.buffer });
    
    // Cache the loaded pdf-lib PDFDocument to avoid extremely heavy redundant loads in loops
    try {
      const docInstance = await PDFDocument.load(file.buffer);
      loadedDocsMap.set(file.originalname, docInstance);
      console.log(`[LabelProcessor] Loaded and cached PDFDocument for ${file.originalname}`);
    } catch (loadErr) {
      console.error(`[LabelProcessor] Warning: failed to load PDFDocument for cache of ${file.originalname}:`, loadErr);
    }
    
    try {
      const doc = await parser.load();
      const total = doc.numPages;
      const results = new Array(total);
      const pageIndices = Array.from({ length: total }, (_, i) => i + 1);
      const concurrency = 30;
      const parseParams = {
        lineEnforce: false,
        parseHyperlinks: false,
        pageJoiner: ''
      };
      
      for (let i = 0; i < pageIndices.length; i += concurrency) {
        const chunk = pageIndices.slice(i, i + concurrency);
        await Promise.all(chunk.map(async (pageNum) => {
          const page = await doc.getPage(pageNum);
          try {
            const text = await parser.getPageText(page, parseParams, total);
            results[pageNum - 1] = {
              text: text || '',
              num: pageNum
            };
          } finally {
            page.cleanup();
          }
        }));
      }
      
      console.log(`[LabelProcessor] Successfully parsed text for all ${results.length} pages in ${file.originalname}`);
      
      results.forEach((pageObj) => {
        const index = pageObj.num - 1; // 0-indexed page index in the document
        const text = pageObj.text || '';
        const metadata = parseMetadata(text, platform);
        const pageType = classifyPage(text);

        // Keep console logging reasonable for bulk processing
        if (results.length <= 10 || index % 50 === 0 || index === results.length - 1) {
          console.log(`[LabelProcessor] Sample page trace: page ${pageObj.num}/${results.length} of ${file.originalname}: type=${pageType}, SKU=${metadata.sku}, OrderID=${metadata.orderId}`);
        }

        allPages.push({
          fileBuffer: file.buffer,
          pageIndex: index,
          text,
          metadata,
          pageType,
          originalFilename: file.originalname
        });
      });
    } catch (error) {
      console.error(`[LabelProcessor] Error parsing file ${file.originalname}:`, error);
      
      // Fallback: If full parsing fails, fallback to standard handling
      const doc = loadedDocsMap.get(file.originalname) || await PDFDocument.load(file.buffer);
      const pageIndices = doc.getPageIndices();
      console.log(`[LabelProcessor] Executing fallback parsing for ${file.originalname} (${pageIndices.length} pages)`);
      for (const index of pageIndices) {
        const text = ''; // assume empty on parsing error
        const metadata = parseMetadata(text, platform);
        const pageType = 'label'; // default fallback

        allPages.push({
          fileBuffer: file.buffer,
          pageIndex: index,
          text,
          metadata,
          pageType,
          originalFilename: file.originalname
        });
      }
    } finally {
      await parser.destroy();
    }
  }, 15);

  console.log(`[LabelProcessor] Split completed: total of ${allPages.length} pages extracted.`);

  // Step 2: Filter page types based on outputType
  // outputType: 'labels' (labels only), 'invoices' (invoices only), 'zip' (labels + invoices separated)
  let filteredPages = [...allPages];
  if (outputType === 'labels') {
    filteredPages = allPages.filter(p => p.pageType === 'label');
  } else if (outputType === 'invoices') {
    filteredPages = allPages.filter(p => p.pageType === 'invoice');
  }

  // Step 3: Sort page list according to criteria
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

  console.log(`[LabelProcessor] Filtering & Sorting completed. Pages count = ${filteredPages.length}`);

  // Step 4 & 5: Compile consolidated documents & apply cropping via page embedding
  const isMerging = mergeLabels === 'true';

  if (outputType === 'zip') {
    // Return a ZIP containing separate sorted labels and invoices
    const labelPages = filteredPages.filter(p => p.pageType === 'label');
    const invoicePages = filteredPages.filter(p => p.pageType === 'invoice');

    const tempLabelsPdf = await PDFDocument.create();
    const invPdf = await PDFDocument.create();

    // Group and batch copy all labels and invoices from their source documents in a single operation
    const copiedLabelsMap = await batchCopyPages(tempLabelsPdf, labelPages, loadedDocsMap);
    const copiedInvoicesMap = await batchCopyPages(invPdf, invoicePages, loadedDocsMap);

    // Compile Labels
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

    // Compile Invoices (with Flipkart bottom invoice cropping)
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

    // Check Merging for ZIP Labels
    let labelsBuffer = null;
    if (isMerging && tempLabelsPdf.getPageCount() > 0) {
      const mergedPdf = await PDFDocument.create();
      const embeddedLabels = await mergedPdf.embedPages(tempLabelsPdf.getPages());
      const A4_W = 595;
      const A4_H = 842;
      const pad = 20;

      let curPg = mergedPdf.addPage([A4_W, A4_H]);
      let curX = pad;
      let curY = A4_H - pad;
      let maxRH = 0;

      for (const emb of embeddedLabels) {
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
      labelsBuffer = Buffer.from(await mergedPdf.save());
    } else {
      labelsBuffer = tempLabelsPdf.getPageCount() > 0 ? Buffer.from(await tempLabelsPdf.save()) : null;
    }

    const invoicesBuffer = invPdf.getPageCount() > 0 ? Buffer.from(await invPdf.save()) : null;

    return {
      type: 'zip',
      labelBuffer: labelsBuffer,
      invoiceBuffer: invoicesBuffer
    };

  } else {
    // Return a single PDF containing sorted and cropped pages (Labels OR Invoices)
    const finalDoc = await PDFDocument.create();
    const tempLabelsPdf = await PDFDocument.create();

    if (outputType === 'labels') {
      const copiedLabelsMap = await batchCopyPages(tempLabelsPdf, filteredPages, loadedDocsMap);
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
        tempLabelsPdf.addPage(copiedPage);
      }

      // Check Merging for Labels-Only
      let labelsBuffer = null;
      if (isMerging && tempLabelsPdf.getPageCount() > 0) {
        const embeddedLabels = await finalDoc.embedPages(tempLabelsPdf.getPages());
        const A4_W = 595;
        const A4_H = 842;
        const pad = 20;

        let curPg = finalDoc.addPage([A4_W, A4_H]);
        let curX = pad;
        let curY = A4_H - pad;
        let maxRH = 0;

        for (const emb of embeddedLabels) {
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
        labelsBuffer = Buffer.from(await finalDoc.save());
      } else {
        // Just save and return the unmerged labels directly without saving, loading, copying and re-saving!
        labelsBuffer = tempLabelsPdf.getPageCount() > 0 ? Buffer.from(await tempLabelsPdf.save()) : null;
      }

      return {
        type: 'pdf',
        buffer: labelsBuffer
      };
    } else {
      // Invoices-Only (with Flipkart bottom invoice cropping)
      const copiedInvoicesMap = await batchCopyPages(finalDoc, filteredPages, loadedDocsMap);
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

    const finalBuffer = Buffer.from(await finalDoc.save());

    return {
      type: 'pdf',
      buffer: finalBuffer
    };
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
