/**
 * catalog.controller.js
 * Controller managing catalog listings generation and isolated node refreshing.
 */

const scraperService = require('../services/scraper.service');
const geminiSeoService = require('../services/gemini-seo.service');

const buildCatalog = async (req, res) => {
  try {
    const file = req.files?.[0] || req.file;
    let { platforms, inputMethod, rawTitle, rawDescription, competitorUrl, additionalContext, category } = req.body;

    // Sanitize and parse platforms array
    if (typeof platforms === 'string') {
      try {
        platforms = JSON.parse(platforms);
      } catch (e) {
        platforms = [platforms];
      }
    }

    if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
      return res.status(400).json({ error: "Please select at least one marketplace platform." });
    }

    if (!inputMethod) {
      return res.status(400).json({ error: "Missing listing input method selection." });
    }

    console.log(`[Catalog Controller] Generate catalog request received. Platforms: ${platforms.join(', ')}, Input Method: ${inputMethod}`);

    const inputDataPayload = {
      additionalContext,
      category: category || 'generic'
    };

    // Process different input methods
    if (inputMethod === 'image') {
      if (!file) {
        return res.status(400).json({ error: "Missing product photo file upload for image input method." });
      }
      inputDataPayload.imageBuffer = file.buffer;
      inputDataPayload.mimeType = file.mimetype;
    } else if (inputMethod === 'text') {
      if (!rawTitle && !rawDescription) {
        return res.status(400).json({ error: "Please provide either a product Title or Description." });
      }
      inputDataPayload.rawTitle = rawTitle;
      inputDataPayload.rawDescription = rawDescription;
    } else if (inputMethod === 'url') {
      if (!competitorUrl || !competitorUrl.startsWith('http')) {
        return res.status(400).json({ error: "Please enter a valid competitor product listing URL." });
      }
      
      // Invoke the web scraper
      try {
        const scrapedInfo = await scraperService.scrapeCompetitorLink(competitorUrl);
        inputDataPayload.scrapedText = scrapedInfo.scrapedRawText;
        inputDataPayload.scraperBlocked = scrapedInfo.scraperBlocked;
        console.log(`[Catalog Controller] Scraper compiled successfully via: ${scrapedInfo.method}. Blocked: ${scrapedInfo.scraperBlocked}`);
      } catch (err) {
        console.error(`[Catalog Controller] Competitor scrape failed:`, err.message);
        return res.status(500).json({ error: `Failed to scrape competitor link: ${err.message}` });
      }
    } else {
      return res.status(400).json({ error: "Unsupported listing input method." });
    }

    // Call the multimodal multi-platform Gemini engine
    const catalogData = await geminiSeoService.generateCatalogData(platforms, inputDataPayload);
    return res.status(200).json(catalogData);

  } catch (error) {
    console.error("[Catalog Controller] Generate Catalog Error:", error.message);
    const status = error.message === 'GEMINI_RATE_LIMIT_EXHAUSTED' ? 429 : 500;
    return res.status(status).json({ 
      error: error.message || "Failed to generate optimized listing details." 
    });
  }
};


const refreshCatalogNode = async (req, res) => {
  try {
    const { platform, nodeType, currentDetails } = req.body;

    if (!platform || !nodeType || !currentDetails) {
      return res.status(400).json({ error: "Missing required parameters platform, nodeType, or currentDetails." });
    }

    console.log(`[Catalog Controller] Isolated node refresh request. Platform: ${platform}, Node Type: ${nodeType}`);

    const refreshedData = await geminiSeoService.refreshListingNode(platform, nodeType, currentDetails);
    return res.status(200).json(refreshedData);

  } catch (error) {
    console.error("[Catalog Controller] Refresh Node Error:", error.message);
    const status = error.message === 'GEMINI_RATE_LIMIT_EXHAUSTED' ? 429 : 500;
    return res.status(status).json({ 
      error: error.message || "Failed to refresh listing node." 
    });
  }
};

module.exports = {
  buildCatalog,
  refreshCatalogNode
};
