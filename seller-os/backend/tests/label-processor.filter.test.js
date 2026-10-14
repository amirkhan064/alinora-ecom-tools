const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeOrderId,
  parseOrderIdsInput,
  pageMatchesOrderIds
} = require('../services/label-processor.service');

test('normalizeOrderId strips whitespace, quotes, and punctuation', () => {
  assert.equal(normalizeOrderId('  OD1234567890123456  '), 'OD1234567890123456');
  assert.equal(normalizeOrderId('#OD1234567890123456'), 'OD1234567890123456');
  assert.equal(normalizeOrderId('"403-1234567-1234567"'), '403-1234567-1234567');
  assert.equal(normalizeOrderId(':OD99887766:'), 'OD99887766');
  assert.equal(normalizeOrderId(''), '');
  assert.equal(normalizeOrderId(null), '');
});

test('parseOrderIdsInput parses various input formats and deduplicates', () => {
  // Newline-separated (e.g. pasted from Excel)
  const excelPasted = 'OD10001\nOD10002\r\nOD10003\nOD10001';
  assert.deepEqual(parseOrderIdsInput(excelPasted), ['OD10001', 'OD10002', 'OD10003']);

  // Comma and semicolon separated
  const commaSeparated = 'OD10001, OD10002; OD10003, OD10004';
  assert.deepEqual(parseOrderIdsInput(commaSeparated), ['OD10001', 'OD10002', 'OD10003', 'OD10004']);

  // JSON array string
  const jsonString = '["OD10001", "OD10002", "#OD10003"]';
  assert.deepEqual(parseOrderIdsInput(jsonString), ['OD10001', 'OD10002', 'OD10003']);

  // Plain array
  assert.deepEqual(parseOrderIdsInput([' OD10001 ', 'OD10002', 'OD10001']), ['OD10001', 'OD10002']);

  // Empty or invalid input
  assert.deepEqual(parseOrderIdsInput(''), []);
  assert.deepEqual(parseOrderIdsInput(null), []);
});

test('pageMatchesOrderIds matches by parsed metadata orderId', () => {
  const targetIds = ['OD1234567890123456', '403-1234567-1234567', '9876543210'];
  const targetSet = new Set(targetIds.map(t => t.toUpperCase()));

  const pageExact = {
    metadata: { orderId: 'OD1234567890123456' },
    text: 'Some random text on label'
  };
  assert.equal(pageMatchesOrderIds(pageExact, targetSet, targetIds), true);

  // Case-insensitive
  const pageLower = {
    metadata: { orderId: 'od1234567890123456' },
    text: ''
  };
  assert.equal(pageMatchesOrderIds(pageLower, targetSet, targetIds), true);

  // Flipkart OD prefix tolerance (target has OD, metadata lacks OD)
  const pageNoOd = {
    metadata: { orderId: '1234567890123456' },
    text: ''
  };
  assert.equal(pageMatchesOrderIds(pageNoOd, targetSet, targetIds), true);

  // Amazon hyphen tolerance (target has hyphens, metadata lacks)
  const pageNoHyphens = {
    metadata: { orderId: '40312345671234567' },
    text: ''
  };
  assert.equal(pageMatchesOrderIds(pageNoHyphens, targetSet, targetIds), true);

  // Non-matching metadata and text
  const pageDifferent = {
    metadata: { orderId: 'OD9999999999999999' },
    text: 'Item SKU: ABC-123 QTY: 1'
  };
  assert.equal(pageMatchesOrderIds(pageDifferent, targetSet, targetIds), false);
});

test('pageMatchesOrderIds matches by page text content if metadata is unknown or partial', () => {
  const targetIds = ['OD1234567890123456', '403-9876543-1234567'];
  const targetSet = new Set(targetIds.map(t => t.toUpperCase()));

  const pageWithTextMatch = {
    metadata: { orderId: 'UNKNOWN' },
    text: 'TAX INVOICE Shipping Order ID: OD1234567890123456 Courier: EKART'
  };
  assert.equal(pageMatchesOrderIds(pageWithTextMatch, targetSet, targetIds), true);

  const pageWithAmazonTextMatch = {
    metadata: { orderId: 'UNKNOWN' },
    text: 'Package details: Amazon order 403-9876543-1234567 delivery hub'
  };
  assert.equal(pageMatchesOrderIds(pageWithAmazonTextMatch, targetSet, targetIds), true);

  // Does not match random short tokens
  const pageNoMatch = {
    metadata: { orderId: 'UNKNOWN' },
    text: 'TAX INVOICE Total Amount: Rs 499 Qty: 1 Customer: John Doe'
  };
  assert.equal(pageMatchesOrderIds(pageNoMatch, targetSet, targetIds), false);
});

test('scanParentLabels and processLabels filter pipeline end-to-end', async () => {
  const { PDFDocument } = require('pdf-lib');
  const { scanParentLabels, processLabels } = require('../services/label-processor.service');

  // Build a test PDF in memory with 3 distinct shipping labels
  const testPdf = await PDFDocument.create();
  
  const page1 = testPdf.addPage([595, 842]);
  page1.drawText('Ordered through Flipkart', { x: 50, y: 800 });
  page1.drawText('Order ID: OD332309712019827000', { x: 50, y: 780 });
  page1.drawText('SKU: KURTA-RED-M', { x: 50, y: 760 });
  page1.drawText('Logistics: EKART', { x: 50, y: 740 });

  const page2 = testPdf.addPage([595, 842]);
  page2.drawText('Ordered through Flipkart', { x: 50, y: 800 });
  page2.drawText('Order ID: OD445566778899001122', { x: 50, y: 780 });
  page2.drawText('SKU: SAREE-BLUE-FREE', { x: 50, y: 760 });
  page2.drawText('Logistics: EKART', { x: 50, y: 740 });

  const page3 = testPdf.addPage([595, 842]);
  page3.drawText('Ordered through Flipkart', { x: 50, y: 800 });
  page3.drawText('Order ID: OD778899001122334455', { x: 50, y: 780 });
  page3.drawText('SKU: SHIRT-WHITE-L', { x: 50, y: 760 });
  page3.drawText('Logistics: EKART', { x: 50, y: 740 });

  const pdfBytes = await testPdf.save();
  const fileMock = { originalname: 'parent_batch.pdf', buffer: Buffer.from(pdfBytes) };

  // 1. Test scanning parent labels
  const scanResult = await scanParentLabels([fileMock], { platform: 'flipkart' });
  assert.equal(scanResult.summary.totalPages, 3);
  assert.equal(scanResult.summary.totalOrders, 3);
  const foundOrderIds = scanResult.orders.map(o => o.orderId);
  assert.ok(foundOrderIds.includes('OD332309712019827000'));
  assert.ok(foundOrderIds.includes('OD445566778899001122'));
  assert.ok(foundOrderIds.includes('OD778899001122334455'));

  // 2. Test processLabels with INCLUDE filter (should keep only 1 order)
  const includeResult = await processLabels([fileMock], {
    platform: 'flipkart',
    sortBy: 'sku',
    sortOrder: 'asc',
    outputType: 'labels',
    orderIds: 'OD332309712019827000',
    filterMode: 'include',
    sortOnly: true
  });
  assert.ok(includeResult.buffer);
  const includeDoc = await PDFDocument.load(includeResult.buffer);
  assert.equal(includeDoc.getPageCount(), 1);

  // 3. Test processLabels with EXCLUDE filter (should omit 1 order, leaving 2)
  const excludeResult = await processLabels([fileMock], {
    platform: 'flipkart',
    sortBy: 'sku',
    sortOrder: 'asc',
    outputType: 'labels',
    orderIds: 'OD332309712019827000',
    filterMode: 'exclude',
    sortOnly: true
  });
  assert.ok(excludeResult.buffer);
  const excludeDoc = await PDFDocument.load(excludeResult.buffer);
  assert.equal(excludeDoc.getPageCount(), 2);
});
