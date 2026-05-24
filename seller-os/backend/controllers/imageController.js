const scraperService = require('../services/scraperService');

async function fetchImages(req, res) {
  try {
    const { urls } = req.body;

    if (!urls || !Array.isArray(urls)) {
      return res.status(400).json({
        error: "Invalid request payload. Expected an array of 'urls' in the request body."
      });
    }

    const successes = [];
    const failures = [];

    // Filter out invalid/empty elements
    const validUrls = urls.filter(url => url && typeof url === 'string' && url.trim() !== '');

    // Scrape all pages concurrently in parallel
    const scrapePromises = validUrls.map(async (url) => {
      try {
        return await scraperService.validateAndScrape(url);
      } catch (e) {
        return {
          success: false,
          url,
          error: `Unexpected system scraper error: ${e.message || e}`
        };
      }
    });

    const results = await Promise.all(scrapePromises);

    for (const result of results) {
      if (result.success) {
        successes.push({
          url: result.url,
          platform: result.platform,
          images: result.images
        });
      } else {
        failures.push({
          url: result.url,
          error: result.error
        });
      }
    }

    return res.status(200).json({
      successes,
      failures
    });
  } catch (error) {
    console.error("Error in fetchImages controller:", error);
    return res.status(500).json({
      error: "Internal Server Error occurred while processing product images."
    });
  }
}

async function proxyImage(req, res) {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: "Missing required 'url' query parameter." });
    }

    const decodedUrl = decodeURIComponent(url);

    // Validate that it's a valid URL
    try {
      new URL(decodedUrl);
    } catch (e) {
      return res.status(400).json({ error: "Invalid URL format." });
    }

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    };

    console.log(`[Proxy] Fetching image from URL: ${decodedUrl}`);
    const imageResponse = await fetch(decodedUrl, { headers, signal: AbortSignal.timeout(15000) });
    if (!imageResponse.ok) {
      console.error(`[Proxy] CDN returned HTTP ${imageResponse.status} for URL: ${decodedUrl}`);
      return res.status(imageResponse.status).json({ error: `CDN responded with HTTP ${imageResponse.status}` });
    }

    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day

    const arrayBuffer = await imageResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return res.send(buffer);
  } catch (error) {
    console.error("[Proxy] Error in proxyImage controller:", error);
    return res.status(500).json({ error: `Internal Image Proxy Error: ${error.message || error}` });
  }
}

module.exports = {
  fetchImages,
  proxyImage
};
