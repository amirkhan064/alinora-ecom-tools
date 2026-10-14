const { PDFDocument, rgb, PDFStream, PDFArray, decodePDFRawStream, PDFName, PDFDict } = require('pdf-lib');
const { PDFParse } = require('pdf-parse');
const archiver = require('archiver');
const { Readable } = require('stream');

function resolveSortMode({ sortOnly, skipCropping } = {}) {
  const rawValue = sortOnly ?? skipCropping ?? 'false';
  const normalized = String(rawValue).toLowerCase() === 'true';
  return {
    skipCropping: normalized,
    shouldCrop: !normalized,
  };
}

/**
 * Bulk extracts text for all pages of a PDF buffer using Mozilla PDF.js (via pdf-parse v2).
 * Handles all font encodings, subsetted fonts, ToUnicode CMaps, UTF-16 hex, and object streams.
 * Returns Map<pageIndex (0-indexed), string (page text)>.
 */
async function extractAllPageTexts(fileBuffer) {
  const pageTexts = new Map();
  try {
    const parser = new PDFParse({ data: fileBuffer });
    const result = await parser.getText();
    if (result && Array.isArray(result.pages)) {
      for (let i = 0; i < result.pages.length; i++) {
        const p = result.pages[i];
        const pageIdx = typeof p.num === 'number' ? p.num - 1 : i;
        if (p.text && p.text.trim()) {
          const sanitized = p.text.replace(/\0/g, ' ').replace(/\r\n|\r/g, '\n').trim();
          pageTexts.set(pageIdx, sanitized);
        }
      }
    }
    console.log(`[LabelProcessor] extractAllPageTexts extracted text from ${pageTexts.size} pages.`);
  } catch (err) {
    console.warn('[LabelProcessor] PDFParse bulk text extraction warning:', err.message);
  }
  return pageTexts;
}

/**
 * Helper to inspect page Resources for Form XObjects and extract their streams.
 */
function extractFormStreams(page, pdfDoc) {
  const streams = [];
  try {
    const resources = page.node.Resources ? page.node.Resources() : null;
    if (resources && resources instanceof PDFDict) {
      const xObject = resources.lookup ? resources.lookup(PDFName.of('XObject')) : null;
      if (xObject && xObject instanceof PDFDict) {
        for (const [name, ref] of xObject.entries()) {
          const stream = pdfDoc.context.lookup(ref);
          if (stream instanceof PDFStream) {
            const subtype = stream.dict.get(PDFName.of('Subtype'));
            if (subtype && subtype.toString() === '/Form') {
              streams.push(stream);
            }
          }
        }
      }
    }
  } catch (err) {
    // Non-fatal if resources cannot be read
  }
  return streams;
}

/**
 * Decodes a hex string from PDF text operator (<hex> Tj).
 * Detects UTF-16BE (2 bytes / 4 hex chars per char) and avoids null bytes.
 */
function decodeHexText(hex) {
  if (!hex) return '';
  // Check for UTF-16BE encoding (every alternate 2 hex characters are '00')
  if (hex.length >= 4 && hex.length % 4 === 0) {
    let isUtf16 = true;
    for (let i = 0; i < hex.length; i += 4) {
      if (hex.substr(i, 2) !== '00') {
        isUtf16 = false;
        break;
      }
    }
    if (isUtf16) {
      let text = '';
      for (let i = 0; i < hex.length; i += 4) {
        text += String.fromCharCode(parseInt(hex.substr(i + 2, 2), 16));
      }
      return text;
    }
  }

  // Standard Latin-1 hex or fallback (skip null bytes so regexes match cleanly)
  let text = '';
  for (let i = 0; i < hex.length; i += 2) {
    const code = parseInt(hex.substr(i, 2), 16);
    if (code !== 0) {
      text += String.fromCharCode(code);
    }
  }
  return text;
}

/**
 * Ultra-fast text extraction directly from PDF content streams using pdf-lib.
 * This reads raw PDF text operators (Tj, TJ, ', ") from both page contents
 * and any embedded Form XObjects.
 */
function extractTextFast(page, pdfDoc) {
  try {
    const contents = page.node.Contents();
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

    // Include any Form XObjects
    const formStreams = extractFormStreams(page, pdfDoc);
    streams.push(...formStreams);

    const textParts = [];
    for (const stream of streams) {
      const decoded = decodePDFRawStream(stream);
      const bytes = decoded.decode();
      const raw = Buffer.from(bytes).toString('latin1');

      // Match hex strings followed by Tj operator: <hex> Tj
      const hexTjRegex = /<([0-9a-fA-F]+)>\s*Tj/g;
      let match;
      while ((match = hexTjRegex.exec(raw)) !== null) {
        textParts.push(decodeHexText(match[1]));
      }

      // Match parenthesized strings followed by Tj or ' or " operator
      const parenTjRegex = /\(([^)]*)\)\s*(?:Tj|'|")/g;
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
          textParts.push(decodeHexText(hexMatch[1]));
        }
        // Extract parenthesized strings from array
        const parenInner = /\(([^)]*)\)/g;
        let parenMatch;
        while ((parenMatch = parenInner.exec(inner)) !== null) {
          textParts.push(parenMatch[1]);
        }
      }
    }

    return textParts.join(' ').replace(/\0/g, ' ').replace(/\s+/g, ' ').trim();
  } catch (e) {
    return '';
  }
}

/**
 * Checks if a candidate string is a common non-SKU code found on shipping labels.
 * Used to filter false positives from the product-code pattern matching.
 */
function isCommonCode(s) {
  const upper = s.toUpperCase();
  // Indian state/region codes (XX-YY format like IN-GA, IN-HR, IN-KL)
  if (/^[A-Z]{2}-[A-Z]{2,3}$/.test(upper)) return true;
  // Common label terms that happen to contain separators
  const commonPhrases = new Set([
    'E-KART', 'E-CART', 'SKU-ID', 'SKU-CODE', 'ITEM-CODE', 'STYLE-CODE',
    'NOT-FOR', 'FOR-RESALE', 'NON-REFUNDABLE', 'SELF-SHIP', 'EASY-SHIP',
    'PRE-PAID', 'PRE_PAID', 'CASH-ON', 'NO-RETURN', 'NON-RETURNABLE',
    'SEMI-PRECIOUS', 'GOLD-PLATED', 'SILVER-PLATED', 'ROSE-GOLD',
    'ANTI-TARNISH', 'STAINLESS-STEEL', 'CUBIC-ZIRCONIA', 'GSTIN', 'flipkart',
    'meesho', 'amazon', 'myntra', 'qty', 'description', 'serial', 'number',
    'order', 'prepaid', 'cod', 'invoice', 'retail', 'tax', 'hsn', 'cgst',
    'sgst', 'igst', 'billing', 'shipping', 'address', 'routing', 'tracking',
    'logistics', 'delivery', 'partner', 'courier'
  ]);
  if (commonPhrases.has(upper)) return true;
  return false;
}

// Generic list of noise words that are not SKUs
const NOISE_WORDS = new Set([
  'SKU', 'ID', 'CODE', 'DESCRIPTION', 'QTY', 'QUANTITY', 'TOTAL', 'PRICE',
  'GSTIN', 'ORDER', 'ORDERED', 'THROUGH', 'FLIPKART', 'AMAZON', 'MEESHO', 'MYNTRA',
  'INVOICE', 'TAX', 'RETAIL', 'LOGISTICS', 'SURFACE', 'COD', 'PREPAID', 'SHIP',
  'SHIPPING', 'BILLING', 'DELIVERY', 'ADDRESS', 'CUSTOMER', 'SELLER', 'NAME',
  'FMPC', 'AWB', 'TRACKING', 'COURIER', 'PARTNER', 'EKART', 'DELHIVERY', 'E-KART',
  'E-CART', 'LOGISTICS', 'PRODUCT', 'DETAILS', 'ITEM', 'ITEMS', 'SERIAL', 'NO',
  'GST', 'HSN', 'TAXABLE', 'VALUE', 'RATE', 'AMOUNT', 'CGST', 'SGST', 'IGST',
  'ROUND', 'OFF', 'TOTALS', 'AUTHORIZED', 'SIGNATORY', 'DATE', 'PACKED', 'BY',
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '0'
]);

function cleanToken(token) {
  return token.replace(/^[:,\-\.\|\(\)\[\]]+|[:,\-\.\|\(\)\[\]]+$/g, '').trim();
}

function getSkuScore(token, isGlobalScan = false) {
  const cleaned = cleanToken(token);
  const upper = cleaned.toUpperCase();

  if (cleaned.length < 3 || cleaned.length > 30) return -100;
  if (NOISE_WORDS.has(upper)) return -100;
  if (isCommonCode(cleaned)) return -100;
  if (!/^[A-Z0-9_\-\.\/]+$/i.test(cleaned)) return -100;

  let score = 10;

  const hasLetters = /[A-Z]/i.test(cleaned);
  const hasDigits = /[0-9]/.test(cleaned);
  const hasSeparators = /[_\-\.\/]/.test(cleaned);
  const isAllUppercase = (cleaned === upper);

  if (isAllUppercase) {
    score += 5;
  }

  if (hasLetters) {
    score += 5;
  }

  if (hasLetters && hasDigits) {
    score += 10;
  }

  if (hasSeparators) {
    score += 15;
  }

  // Description word detection / penalty:
  // If the token contains letters but is NOT all-uppercase, AND it has no digits and no separators
  // (e.g. "Alinora", "Stainless", "Plated"), it is almost certainly a description word.
  if (hasLetters && !isAllUppercase && !hasDigits && !hasSeparators) {
    score -= 25;
  }

  // Also penalize purely lowercase words aggressively (e.g. "alinora", "jewels")
  if (/^[a-z]+$/.test(cleaned)) {
    score -= 25;
  }

  if (isGlobalScan) {
    if (/^\d{10,}$/.test(cleaned)) score -= 15;
    if (/^OD\d{10,}$/i.test(cleaned) || /^FMPC\d{10,}$/i.test(cleaned)) score -= 30;
  }

  return score;
}

function parseSKUGenerically(text) {
  if (!text) return 'UNKNOWN';

  const cleanText = text.replace(/[|\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
  const upperText = cleanText.toUpperCase();
  const foundSkus = new Set();

  // 1. Keyword-based SKU extraction
  const skuKeywordRegexes = [
    /(?:SELLER\s+)?SKU\s*(?:CODE|ID|NAME)?\s*[:\-|=\s]\s*([A-Z0-9_\-\.\/]{3,30})/gi,
    /STYLE\s*(?:CODE|NAME|ID)?\s*[:\-|=\s]\s*([A-Z0-9_\-\.\/]{3,30})/gi,
    /ITEM\s*(?:CODE|NAME|ID)?\s*[:\-|=\s]\s*([A-Z0-9_\-\.\/]{3,30})/gi,
    /LISTING\s*(?:CODE|NAME|ID)?\s*[:\-|=\s]\s*([A-Z0-9_\-\.\/]{3,30})/gi
  ];

  for (const regex of skuKeywordRegexes) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(cleanText)) !== null) {
      const val = cleanToken(match[1]);
      const score = getSkuScore(val, false);
      if (score > 0) {
        foundSkus.add(val.toUpperCase());
      }
    }
  }

  // 2. Table-based SKU extraction
  const tableHeaders = [
    'SKU ID DESCRIPTION QTY',
    'SKU ID DESCRIPTION QUANTITY',
    'SKU DESCRIPTION QTY',
    'STYLE CODE DESCRIPTION QTY',
    'ITEM CODE DESCRIPTION QTY',
    'SELLER SKU ID',
    'SKU ID',
    'SKU CODE',
    'STYLE CODE',
    'ITEM CODE'
  ].sort((a, b) => b.length - a.length);

  let headerMatched = false;
  for (const header of tableHeaders) {
    if (headerMatched) break;

    const headerIdx = upperText.indexOf(header);
    if (headerIdx !== -1) {
      headerMatched = true; // Match only the most specific header
      const sub = cleanText.substring(headerIdx + header.length).trim();
      const tokens = sub.split(' ');

      // Score the first 20 tokens after the table header
      const scoredTokens = [];
      for (let i = 0; i < Math.min(tokens.length, 20); i++) {
        const token = tokens[i].trim();
        const cleaned = cleanToken(token);
        const score = getSkuScore(cleaned, false);
        if (score > 0) {
          scoredTokens.push({ token: cleaned, score });
        }
      }

      if (scoredTokens.length > 0) {
        const maxScore = Math.max(...scoredTokens.map(t => t.score));
        scoredTokens.forEach(t => {
          if (t.score >= maxScore - 10 && t.score >= 15) {
            foundSkus.add(t.token.toUpperCase());
          }
        });
      }
    }
  }

  // 3. Fallback to global scan if nothing found yet
  if (foundSkus.size === 0) {
    const tokens = cleanText.split(' ');
    let bestToken = null;
    let maxScore = 0;
    for (const token of tokens) {
      const cleaned = cleanToken(token);
      const score = getSkuScore(cleaned, true);
      if (score > maxScore) {
        maxScore = score;
        bestToken = cleaned;
      }
    }
    if (bestToken) {
      foundSkus.add(bestToken.toUpperCase());
    }
  }

  return foundSkus.size > 0 ? Array.from(foundSkus).sort().join('+') : 'UNKNOWN';
}

/**
 * Scans page text to find Order IDs, SKUs, and Date strings.
 */
function parseMetadata(text, platform, targetOrderIds = []) {
  let orderId = 'UNKNOWN';
  let sku = 'UNKNOWN';
  let dateStr = 'UNKNOWN';

  const cleanText = (text || '').replace(/\0/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleanText) {
    const d = new Date();
    dateStr = `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
    return { orderId, sku, date: dateStr };
  }

  // 1. Priority: If user provided target Order IDs, test if this page directly contains any of them
  if (Array.isArray(targetOrderIds) && targetOrderIds.length > 0) {
    const strippedClean = cleanText.toUpperCase().replace(/[\s\-_#:]/g, '');
    for (const target of targetOrderIds) {
      const cleanTarget = String(target).trim().toUpperCase();
      if (!cleanTarget || cleanTarget.length < 4) continue;
      const strippedTarget = cleanTarget.replace(/[\s\-_#:]/g, '');
      const strippedWithoutOD = strippedTarget.startsWith('OD') ? strippedTarget.substring(2) : strippedTarget;
      const strippedWithOD = strippedTarget.startsWith('OD') ? strippedTarget : 'OD' + strippedTarget;

      if (
        strippedClean.includes(strippedTarget) ||
        (strippedWithoutOD.length >= 8 && strippedClean.includes(strippedWithoutOD)) ||
        (strippedWithOD.length >= 8 && strippedClean.includes(strippedWithOD))
      ) {
        orderId = cleanTarget;
        break;
      }
    }
  }

  // 2. Extract Order ID based on platform patterns
  if (orderId === 'UNKNOWN') {
    if (platform === 'flipkart') {
      // Flipkart format: OD followed by digits (with or without spaces/hyphens/#)
      const fkMatch = cleanText.match(/\bOD[\s\-_#]?(\d{6,25})\b/i) ||
                      cleanText.match(/\bO\s*D\s*[\s\-_#]?\s*(\d(?:\s*\d){5,24})\b/i);
      if (fkMatch) {
        orderId = 'OD' + (fkMatch[1] || '').replace(/\s+/g, '');
      }
    } else if (platform === 'amazon') {
      // Amazon format: 403-1234567-1234567
      const match = cleanText.match(/\b\d{3}-\d{7}-\d{7}\b/) ||
                    cleanText.match(/(?:Order\s*#?|Order\s*ID)[:\s]*(\d{3}-\d{7}-\d{7})/i);
      if (match) orderId = match[1] || match[0];
    } else if (platform === 'meesho') {
      // Meesho format: 10-16 digits with optional suborder _1
      const match = cleanText.match(/(?:Sub[ -]?Order[ -]?(?:No|ID|Number)|Order[ -]?(?:No|ID|Number))[:\s\-|=]+([0-9A-Z_-]{8,25})/i) ||
                    cleanText.match(/\b\d{10,16}(?:_\d+)?\b/);
      if (match) orderId = match[1] || match[0];
    } else if (platform === 'myntra') {
      const match = cleanText.match(/(?:Order[ -]?(?:No|ID))[:\s\-|=]+([A-Z0-9-]{10,20})/i) ||
                    cleanText.match(/\b[A-Z0-9-]{10,16}\b/i) || cleanText.match(/\b\d{10,16}\b/);
      if (match) orderId = match[1] || match[0];
    }
  }

  // 3. Explicit label header matching (Order ID, Order No, Order #, Cust Order, etc.)
  if (orderId === 'UNKNOWN') {
    const headerMatch = cleanText.match(/(?:Order|Ord|Cust\s*Order|Merchant\s*Order)\s*(?:ID|Id|No|Number|#)?[:\-#|=\s]+\s*(OD[\s\-_#]?[0-9A-Z]{6,25}|[0-9]{8,25})/i);
    if (headerMatch) {
      const raw = headerMatch[1].replace(/[\s\-_#]/g, '').toUpperCase();
      orderId = raw.startsWith('OD') ? raw : (platform === 'flipkart' ? 'OD' + raw : raw);
    }
  }

  // 4. Cross-platform fallback 1: Flipkart pattern
  if (orderId === 'UNKNOWN') {
    const fkMatch = cleanText.match(/\bOD[\s\-_#]?(\d{6,25})\b/i) ||
                    cleanText.match(/\bO\s*D\s*[\s\-_#]?\s*(\d(?:\s*\d){5,24})\b/i);
    if (fkMatch) {
      orderId = 'OD' + (fkMatch[1] || '').replace(/\s+/g, '');
    }
  }

  // 5. Cross-platform fallback 2: Amazon pattern
  if (orderId === 'UNKNOWN') {
    const amzMatch = cleanText.match(/\b\d{3}-\d{7}-\d{7}\b/);
    if (amzMatch) orderId = amzMatch[0];
  }

  // 6. Cross-platform fallback 3: Long numeric strings (14-22 digits)
  if (orderId === 'UNKNOWN') {
    const longNumMatch = cleanText.match(/\b(\d{14,22})\b/);
    if (longNumMatch) {
      orderId = platform === 'flipkart' ? 'OD' + longNumMatch[1] : longNumMatch[1];
    }
  }

  // 7. Cross-platform fallback 4: General numeric sequence (10-22 digits)
  if (orderId === 'UNKNOWN') {
    const numMatch = cleanText.match(/\b(\d{10,22})\b/);
    if (numMatch) {
      orderId = numMatch[1];
    }
  }

  // 8. Secondary fallback: Courier tracking / AWB (FMPC, LMP, etc.) so orders don't stay UNKNOWN
  if (orderId === 'UNKNOWN') {
    const awbMatch = cleanText.match(/\b(FMPC\d{10,20}|LMP\d{10,20}|FMP\d{10,20})\b/i);
    if (awbMatch) {
      orderId = awbMatch[1].toUpperCase();
    }
  }

  // Extract SKU using format-agnostic Token Scoring Parser
  sku = parseSKUGenerically(cleanText);

  // Extract Date
  const dateMatch = cleanText.match(/\b\d{2}[\-\/\.]\d{2}[\-\/\.]\d{4}\b/) ||
                    cleanText.match(/\b\d{4}[\-\/\.]\d{2}[\-\/\.]\d{2}\b/);
  if (dateMatch) {
    dateStr = dateMatch[0];
  } else {
    const d = new Date();
    dateStr = `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
  }

  return { orderId, sku, date: dateStr };
}

/**
 * Normalizes an Order ID by stripping surrounding noise characters and spaces.
 */
function normalizeOrderId(id) {
  if (!id) return '';
  return String(id).trim().replace(/^[:#\s"']+|[:#\s"']+$/g, '');
}

/**
 * Parses a variety of Order ID input formats:
 * - Array of strings
 * - JSON string array (e.g. '["OD123", "OD456"]')
 * - Delimited string (newline, comma, semicolon, tab, or space separated)
 * Returns a deduplicated array of clean Order IDs.
 */
function parseOrderIdsInput(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return Array.from(new Set(input.map(normalizeOrderId).filter(Boolean)));
  }
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return Array.from(new Set(parsed.map(normalizeOrderId).filter(Boolean)));
        }
      } catch (e) {
        // Fall back to delimiter splitting
      }
    }
    const tokens = trimmed.split(/[\r\n,;\t\s]+/);
    return Array.from(new Set(tokens.map(normalizeOrderId).filter(Boolean)));
  }
  return [];
}

/**
 * Robust check if a page matches any Order ID in targetOrderIdsSet or rawTargetOrderIds list.
 * Evaluates both parsed metadata.orderId AND page raw text.
 */
function pageMatchesOrderIds(page, targetOrderIdsSet, rawTargetOrderIds) {
  if (!targetOrderIdsSet || targetOrderIdsSet.size === 0) return true;

  const pageOrderId = normalizeOrderId(page.metadata?.orderId);
  const upperPageOrderId = pageOrderId.toUpperCase();

  // 1. Direct or normalized metadata match
  if (pageOrderId && pageOrderId !== 'UNKNOWN') {
    if (targetOrderIdsSet.has(upperPageOrderId)) return true;

    // Check with/without "OD" prefix for Flipkart
    if (upperPageOrderId.startsWith('OD') && targetOrderIdsSet.has(upperPageOrderId.substring(2))) {
      return true;
    }
    const withOd = 'OD' + upperPageOrderId;
    if (targetOrderIdsSet.has(withOd)) {
      return true;
    }

    // Check without hyphens for Amazon
    const strippedPage = upperPageOrderId.replace(/-/g, '');
    if (targetOrderIdsSet.has(strippedPage)) return true;
    if (rawTargetOrderIds && rawTargetOrderIds.some(t => t.toUpperCase().replace(/-/g, '') === strippedPage)) {
      return true;
    }
  }

  // 2. Full page text search for each target order ID
  if (page.text && rawTargetOrderIds && rawTargetOrderIds.length > 0) {
    const upperText = page.text.toUpperCase();
    for (const targetId of rawTargetOrderIds) {
      if (!targetId || targetId.length < 4) continue; // Minimum length to prevent false positives
      const upperTarget = targetId.toUpperCase();
      if (upperText.includes(upperTarget)) return true;

      // Also check target without OD if Flipkart
      if (upperTarget.startsWith('OD') && upperTarget.length >= 12) {
        if (upperText.includes(upperTarget.substring(2))) return true;
      }

      // Also check target without hyphens if Amazon
      if (upperTarget.includes('-')) {
        const strippedTarget = upperTarget.replace(/-/g, '');
        if (upperText.includes(strippedTarget)) return true;
      }
    }
  }

  return false;
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
async function processLabels(files, {
  platform,
  sortBy,
  sortOrder,
  outputType,
  mergeLabels = 'false',
  customText = '',
  sortOnly = false,
  skipCropping = false,
  orderIds = '',
  filterMode = 'include'
}) {
  const { skipCropping: sortOnlyMode } = resolveSortMode({ sortOnly, skipCropping });
  const shouldCrop = !sortOnlyMode;
  const startTime = Date.now();
  const targetOrderIdsList = parseOrderIdsInput(orderIds);
  console.log(`[LabelProcessor] Starting process: platform=${platform}, sortBy=${sortBy}, sortOrder=${sortOrder}, outputType=${outputType}, mergeLabels=${mergeLabels}, customText="${customText}", sortOnly=${sortOnlyMode}, orderIdsCount=${targetOrderIdsList.length}, filterMode=${filterMode}`);

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
      const [pdfDoc, pageTextsMap] = await Promise.all([
        PDFDocument.load(fileBuffer, { ignoreEncryption: true }),
        extractAllPageTexts(fileBuffer)
      ]);
      loadedDocs.set(file.originalname, pdfDoc);
      const pages = pdfDoc.getPages();

      let lastKnownOrderId = 'UNKNOWN';
      let lastKnownSku = 'UNKNOWN';

      for (let index = 0; index < pages.length; index++) {
        const page = pages[index];
        let text = pageTextsMap.get(index) || '';
        if (!text || text.trim().length === 0) {
          try {
            text = extractTextFast(page, pdfDoc);
          } catch (err) {
            console.error(`[LabelProcessor] Fast text extraction failed on page ${index} of ${file.originalname}:`, err.message);
          }
        }
        const metadata = parseMetadata(text, platform, targetOrderIdsList);
        const pageType = classifyPage(text);

        // Inherit metadata for consecutive pages within the same document (e.g. invoice following label)
        if (metadata.orderId === 'UNKNOWN' && lastKnownOrderId !== 'UNKNOWN' && pageType === 'invoice') {
          metadata.orderId = lastKnownOrderId;
          if (metadata.sku === 'UNKNOWN') {
            metadata.sku = lastKnownSku;
          }
        }

        if (metadata.orderId !== 'UNKNOWN') {
          lastKnownOrderId = metadata.orderId;
          lastKnownSku = metadata.sku;
        }

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

  // Diagnostic: log extracted text snippet + parsed metadata for first 10 pages
  // This helps trace SKU extraction issues without flooding the console
  const diagCount = Math.min(allPages.length, 10);
  for (let i = 0; i < diagCount; i++) {
    const p = allPages[i];
    const textSnippet = (p.text || '').substring(0, 250).replace(/\n/g, ' ');
    console.log(`[LabelProcessor] DIAG page[${i}] file=${p.originalFilename} pageIdx=${p.pageIndex} type=${p.pageType}`);
    console.log(`[LabelProcessor] DIAG page[${i}] text="${textSnippet}..."`);
    console.log(`[LabelProcessor] DIAG page[${i}] metadata=${JSON.stringify(p.metadata)}`);
  }

  // Step 2: Filter page types based on outputType
  // outputType: 'labels' (labels only), 'invoices' (invoices only), 'zip' (labels + invoices separated)
  let filteredPages = [...allPages];
  if (outputType === 'labels') {
    filteredPages = allPages.filter(p => p.pageType === 'label');
  } else if (outputType === 'invoices') {
    filteredPages = allPages.filter(p => p.pageType === 'invoice');
  }

  // Filter by Order IDs if provided
  if (targetOrderIdsList.length > 0) {
    const targetSet = new Set();
    targetOrderIdsList.forEach(id => {
      const upper = id.toUpperCase();
      targetSet.add(upper);
      if (upper.includes('-')) targetSet.add(upper.replace(/-/g, ''));
      if (upper.startsWith('OD')) targetSet.add(upper.substring(2));
      else targetSet.add('OD' + upper);
    });

    const isExcludeMode = String(filterMode).toLowerCase() === 'exclude';
    const beforeCount = filteredPages.length;

    filteredPages = filteredPages.filter(page => {
      const matched = pageMatchesOrderIds(page, targetSet, targetOrderIdsList);
      return isExcludeMode ? !matched : matched;
    });

    console.log(`[LabelProcessor] Filtered by orderIds (${targetOrderIdsList.length} targets, mode=${filterMode}): before=${beforeCount}, after=${filteredPages.length}`);
  }

  // Assign stable original-order index to each page BEFORE sorting.
  // This is used as a tiebreaker so pages with UNKNOWN metadata stay near
  // their original neighbors rather than clumping randomly.
  filteredPages.forEach((p, idx) => { p._originalIndex = idx; });

  // Step 3: Sort page list according to criteria
  // KEY FIX: Multi-level stable sort:
  //   1. Primary: sortBy field (sku, orderId, or date)
  //   2. Secondary: orderId (groups same-SKU labels by order)
  //   3. Tertiary: original file position (preserves input order for ties)
  // UNKNOWN values sort LAST so they don't break up properly-identified groups.
  const tSortStart = Date.now();

  // Log SKU extraction diagnostics for debugging
  const skuDistribution = {};
  filteredPages.forEach(p => {
    const s = p.metadata.sku || 'UNKNOWN';
    skuDistribution[s] = (skuDistribution[s] || 0) + 1;
  });
  const uniqueSkus = Object.keys(skuDistribution).length;
  const unknownCount = skuDistribution['UNKNOWN'] || 0;
  console.log(`[LabelProcessor] SKU extraction: ${uniqueSkus} unique SKUs found, ${unknownCount} pages with UNKNOWN SKU.`);
  if (uniqueSkus <= 30) {
    console.log(`[LabelProcessor] SKU distribution:`, JSON.stringify(skuDistribution));
  }

  filteredPages.sort((a, b) => {
    // Helper: get the sort value, treating UNKNOWN as a special high-value
    // so unrecognized pages sort to the end rather than the beginning
    const getSortVal = (page, field) => {
      const raw = page.metadata[field] || '';
      const val = typeof raw === 'string' ? raw.toLowerCase() : raw;
      return val === 'unknown' || val === '' ? null : val;
    };

    const primaryA = getSortVal(a, sortBy);
    const primaryB = getSortVal(b, sortBy);

    // Both UNKNOWN → preserve original order
    if (primaryA === null && primaryB === null) {
      return a._originalIndex - b._originalIndex;
    }
    // UNKNOWN sorts last
    if (primaryA === null) return 1;
    if (primaryB === null) return -1;

    // Primary comparison
    if (primaryA < primaryB) return sortOrder === 'asc' ? -1 : 1;
    if (primaryA > primaryB) return sortOrder === 'asc' ? 1 : -1;

    // Secondary: sort by orderId within same primary key
    // This groups all pages for the same order together, which is critical
    // for multi-item orders where multiple labels share the same orderId
    if (sortBy !== 'orderId') {
      const orderA = (a.metadata.orderId || '').toLowerCase();
      const orderB = (b.metadata.orderId || '').toLowerCase();
      if (orderA < orderB) return -1;
      if (orderA > orderB) return 1;
    }

    // Tertiary: preserve original input order for complete stability
    return a._originalIndex - b._originalIndex;
  });

  console.log(`[LabelProcessor] Step 2 & 3: Filtering & Sorting: ${Date.now() - tSortStart}ms. Pages count = ${filteredPages.length}`);

  // Step 4 & 5: Compile consolidated documents & apply cropping
  const isMerging = String(mergeLabels).toLowerCase() === 'true';
  const tCompileStart = Date.now();

  if (outputType === 'zip') {
    // Return a ZIP containing separate sorted labels and invoices
    const labelPages = filteredPages.filter(p => p.pageType === 'label');
    const invoicePages = filteredPages.filter(p => p.pageType === 'invoice');

    let labelsBuffer = null;

    if (isMerging && shouldCrop) {
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
    } else if (!isMerging && shouldCrop) {
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
    } else if (labelPages.length > 0) {
      const tempLabelsPdf = await PDFDocument.create();
      const copiedLabelsMap = await batchCopyPages(tempLabelsPdf, labelPages, loadedDocs);
      for (const pageItem of labelPages) {
        const copiedPage = copiedLabelsMap.get(pageItem.originalFilename).get(pageItem.pageIndex);
        tempLabelsPdf.addPage(copiedPage);
      }
      labelsBuffer = Buffer.from(await tempLabelsPdf.save({ useObjectStreams: false }));
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

        if (shouldCrop && platform !== 'amazon' && platform !== 'meesho') {
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
      if (isMerging && shouldCrop) {
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
      } else if (!isMerging && shouldCrop) {
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
      } else if (filteredPages.length > 0) {
        const copiedLabelsMap = await batchCopyPages(finalDoc, filteredPages, loadedDocs);
        for (const pageItem of filteredPages) {
          const copiedPage = copiedLabelsMap.get(pageItem.originalFilename).get(pageItem.pageIndex);
          finalDoc.addPage(copiedPage);
        }
        labelsBuffer = Buffer.from(await finalDoc.save({ useObjectStreams: false }));
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

          if (shouldCrop && platform !== 'amazon' && platform !== 'meesho') {
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

/**
 * Scans parent PDF files to extract all detected orders, SKUs, and page indices
 * without performing cropping or re-encoding. Ultra-fast preview scanner.
 */
async function scanParentLabels(files, { platform = 'flipkart', orderIds = '', filterMode = 'include' } = {}) {
  const startTime = Date.now();
  const targetOrderIdsList = parseOrderIdsInput(orderIds);
  console.log(`[LabelProcessor] scanParentLabels starting: filesCount=${files ? files.length : 0}, platform=${platform}, targetOrderIdsCount=${targetOrderIdsList.length}`);

  if (!files || !Array.isArray(files) || files.length === 0) {
    throw new Error('No files uploaded to scan.');
  }

  const targetSet = new Set();
  targetOrderIdsList.forEach(id => {
    const upper = id.toUpperCase();
    targetSet.add(upper);
    if (upper.includes('-')) targetSet.add(upper.replace(/-/g, ''));
    if (upper.startsWith('OD')) targetSet.add(upper.substring(2));
    else targetSet.add('OD' + upper);
  });

  const allPages = [];
  const loadedDocs = new Map();

  const filesResults = await mapConcurrent(files, 20, async (file) => {
    const fileBuffer = Buffer.from(file.buffer);
    const filePages = [];

    try {
      const [pdfDoc, pageTextsMap] = await Promise.all([
        PDFDocument.load(fileBuffer, { ignoreEncryption: true }),
        extractAllPageTexts(fileBuffer)
      ]);
      loadedDocs.set(file.originalname, pdfDoc);
      const pages = pdfDoc.getPages();

      let lastKnownOrderId = 'UNKNOWN';
      let lastKnownSku = 'UNKNOWN';

      for (let index = 0; index < pages.length; index++) {
        const page = pages[index];
        let text = pageTextsMap.get(index) || '';
        if (!text || text.trim().length === 0) {
          try {
            text = extractTextFast(page, pdfDoc);
          } catch (err) {
            console.error(`[LabelProcessor] Fast text extraction failed on page ${index} of ${file.originalname}:`, err.message);
          }
        }
        const metadata = parseMetadata(text, platform, targetOrderIdsList);
        const pageType = classifyPage(text);

        if (index < 5) {
          console.log(`[scanParentLabels DIAG] page[${index}] orderId=${metadata.orderId}, sku=${metadata.sku}, textLen=${text.length}, preview="${text.substring(0, 100).replace(/\n/g, ' ')}"`);
        }

        // Inherit metadata for consecutive pages within the same document (e.g. invoice following label)
        if (metadata.orderId === 'UNKNOWN' && lastKnownOrderId !== 'UNKNOWN' && pageType === 'invoice') {
          metadata.orderId = lastKnownOrderId;
          if (metadata.sku === 'UNKNOWN') {
            metadata.sku = lastKnownSku;
          }
        }

        if (metadata.orderId !== 'UNKNOWN') {
          lastKnownOrderId = metadata.orderId;
          lastKnownSku = metadata.sku;
        }

        const isMatchedFilter = targetOrderIdsList.length > 0
          ? pageMatchesOrderIds({ text, metadata }, targetSet, targetOrderIdsList)
          : false;

        filePages.push({
          pageIndex: index,
          text,
          metadata,
          pageType,
          matchedFilter: isMatchedFilter,
          originalFilename: file.originalname
        });
      }
    } catch (error) {
      console.error(`[LabelProcessor] Error parsing file ${file.originalname} during scan:`, error);
    }
    return filePages;
  });

  for (const filePages of filesResults) {
    allPages.push(...filePages);
  }

  // Aggregate by orderId
  const orderGroups = new Map();
  let unknownOrderIndex = 1;

  for (const page of allPages) {
    let rawOrderId = page.metadata?.orderId;
    const isUnknown = !rawOrderId || rawOrderId === 'UNKNOWN';
    const groupKey = isUnknown ? `UNKNOWN_${page.originalFilename}_p${page.pageIndex + 1}` : rawOrderId;

    if (!orderGroups.has(groupKey)) {
      orderGroups.set(groupKey, {
        orderId: isUnknown ? `UNKNOWN (#${unknownOrderIndex++})` : rawOrderId,
        isUnknown,
        matchedFilter: false,
        skus: new Set(),
        dates: new Set(),
        pageCount: 0,
        pageTypes: [],
        pageIndices: [],
        files: new Set()
      });
    }

    const group = orderGroups.get(groupKey);
    group.pageCount++;
    group.files.add(page.originalFilename);
    group.pageIndices.push(page.pageIndex + 1);
    group.pageTypes.push(page.pageType);
    if (page.matchedFilter) {
      group.matchedFilter = true;
    }
    if (page.metadata?.sku && page.metadata.sku !== 'UNKNOWN') {
      group.skus.add(page.metadata.sku);
    }
    if (page.metadata?.date && page.metadata.date !== 'UNKNOWN') {
      group.dates.add(page.metadata.date);
    }
  }

  const orders = Array.from(orderGroups.values()).map(g => ({
    orderId: g.orderId,
    isUnknown: g.isUnknown,
    matchedFilter: g.matchedFilter,
    skus: Array.from(g.skus),
    date: Array.from(g.dates)[0] || 'N/A',
    pageCount: g.pageCount,
    pageTypes: Array.from(new Set(g.pageTypes)),
    pageIndices: g.pageIndices,
    files: Array.from(g.files)
  }));

  const totalLabels = allPages.filter(p => p.pageType === 'label').length;
  const totalInvoices = allPages.filter(p => p.pageType === 'invoice').length;
  const unknownCount = orders.filter(o => o.isUnknown).length;
  const matchedFilterCount = orders.filter(o => o.matchedFilter).length;

  console.log(`[LabelProcessor] scanParentLabels completed in ${Date.now() - startTime}ms. Found ${orders.length} orders across ${allPages.length} pages (${matchedFilterCount} matched filter).`);

  return {
    summary: {
      totalFiles: files.length,
      totalPages: allPages.length,
      totalOrders: orders.length,
      totalLabels,
      totalInvoices,
      unknownCount,
      matchedCount: matchedFilterCount
    },
    orders
  };
}

module.exports = {
  resolveSortMode,
  processLabels,
  createZipStream,
  scanParentLabels,
  parseOrderIdsInput,
  pageMatchesOrderIds,
  normalizeOrderId,
  parseMetadata,
  extractTextFast,
  extractAllPageTexts
};
