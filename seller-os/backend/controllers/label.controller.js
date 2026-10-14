const labelService = require('../services/label-processor.service');

async function processLabels(req, res) {
  try {
    let { platform, marketplace, outputType, invoiceFilter, sortBy = 'sku', sortOrder = 'asc', mergeLabels = 'false', customText = '', sortOnly = 'false', skipCropping = 'false', orderIds = '', filterMode = 'include' } = req.body;

    // Normalize platform / marketplace
    const finalPlatform = (platform || marketplace || 'flipkart').toLowerCase();

    // Normalize outputType / invoiceFilter
    let finalOutputType = outputType || 'labels';
    if (invoiceFilter) {
      if (invoiceFilter === 'onlyLabel') {
        finalOutputType = 'labels';
      } else if (invoiceFilter === 'onlyInvoice') {
        finalOutputType = 'invoices';
      } else if (invoiceFilter === 'separateInvoice' || invoiceFilter === 'all' || invoiceFilter === 'both') {
        finalOutputType = 'zip';
      }
    }

    // Normalize sortBy
    let finalSortBy = sortBy;
    if (sortBy === 'original') {
      finalSortBy = 'sku'; // fallback for original to SKU sorting
    }

    let files = req.files;
    if (files && files.length > 0) {
      // De-duplicate files based on originalname and size to prevent double-processing
      // when the client sends files under multiple compatibility field names (e.g. 'files' and 'pdf').
      const seen = new Set();
      files = files.filter(file => {
        const key = `${file.originalname}_${file.size}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
    }

    const finalSortOnly = String(sortOnly ?? skipCropping ?? 'false').toLowerCase() === 'true';

    console.log(`[LabelController] Request received: filesCount=${files ? files.length : 0}, platform=${finalPlatform}, sortBy=${finalSortBy}, sortOrder=${sortOrder}, outputType=${finalOutputType}, mergeLabels=${mergeLabels}, customText="${customText}", sortOnly=${finalSortOnly}, filterMode=${filterMode}`);

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({
        error: "No files uploaded. Please upload one or more shipping label PDF files."
      });
    }

    // Run the pipeline service
    const result = await labelService.processLabels(files, {
      platform: finalPlatform,
      sortBy: finalSortBy,
      sortOrder,
      outputType: finalOutputType,
      mergeLabels,
      customText,
      sortOnly: finalSortOnly,
      skipCropping: finalSortOnly,
      orderIds,
      filterMode
    });

    if (result.type === 'zip') {
      if ((!result.labelBuffer || result.labelBuffer.length === 0) && (!result.invoiceBuffer || result.invoiceBuffer.length === 0)) {
        return res.status(400).json({
          error: "Processing did not yield any labels or invoices based on your selected criteria."
        });
      }

      // Generate a clean filename based on platform
      const zipFilename = `selleros_${platform}_processed_${Date.now()}.zip`;

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

      // Compile archive zip stream and pipe directly to response
      const archiveStream = labelService.createZipStream(result.labelBuffer, result.invoiceBuffer);
      archiveStream.on('error', (err) => {
        console.error('[LabelController] Archive error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: `Archive generation failed: ${err.message}` });
        }
      });
      archiveStream.pipe(res);

    } else {
      if (!result.buffer || result.buffer.length === 0) {
        return res.status(400).json({
          error: "Processing did not yield any pages based on your selected criteria."
        });
      }

      // Generate a clean PDF filename based on platform
      const pdfFilename = `selleros_${platform}_processed_${Date.now()}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${pdfFilename}"`);
      res.send(result.buffer);
    }

  } catch (error) {
    console.error('[LabelController] Error processing labels:', error);
    return res.status(500).json({
      error: `Internal PDF processing failed: ${error.message || error}`
    });
  }
}

async function scanLabels(req, res) {
  try {
    let { platform, marketplace, orderIds, filterMode } = req.body;
    const finalPlatform = (platform || marketplace || 'flipkart').toLowerCase();

    let files = req.files;
    if (files && files.length > 0) {
      const seen = new Set();
      files = files.filter(file => {
        const key = `${file.originalname}_${file.size}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({
        error: "No files uploaded to scan. Please upload one or more shipping label PDF files."
      });
    }

    console.log(`[LabelController] scanLabels requested: filesCount=${files.length}, platform=${finalPlatform}, orderIdsProvided=${Boolean(orderIds)}`);
    const result = await labelService.scanParentLabels(files, {
      platform: finalPlatform,
      orderIds,
      filterMode
    });
    return res.json({
      success: true,
      summary: result.summary,
      orders: result.orders
    });
  } catch (error) {
    console.error('[LabelController] Error scanning parent labels:', error);
    return res.status(500).json({
      error: `Failed to scan parent label PDF: ${error.message || error}`
    });
  }
}

module.exports = {
  processLabels,
  scanLabels
};
