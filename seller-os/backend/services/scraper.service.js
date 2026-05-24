/**
 * scraper.service.js
 * In-memory scraper that pulls and parses competitor HTML pages from Amazon, Flipkart, or Meesho.
 * Outfitted with stealth header rotations, evasion delays, and robust selector fallback chains.
 */

const axios = require('axios');
const cheerio = require('cheerio');

// Random user agent array for browser fingerprint emulation
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0'
];

// Helper to construct randomized browser fingerprint headers
const getRandomHeaders = () => {
  const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  return {
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Connection': 'keep-alive',
    'Cache-Control': 'max-age=0',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1'
  };
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const scrapeCompetitorLink = async (url) => {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    throw new Error("Invalid competitor URL provided.");
  }

  const lowercaseUrl = url.toLowerCase();
  let platform = 'Unknown';
  if (lowercaseUrl.includes('amazon.')) platform = 'Amazon India';
  else if (lowercaseUrl.includes('flipkart.')) platform = 'Flipkart';
  else if (lowercaseUrl.includes('meesho.')) platform = 'Meesho';

  console.log(`[Scraper Service] Running stealth parser on competitor link for ${platform}. URL: ${url}`);

  // Throttling jitter evasion: sleep between 200ms and 600ms
  const jitterMs = Math.floor(Math.random() * 400) + 200;
  console.log(`[Scraper Evasion] Jitter throttling latency: sleeping for ${jitterMs}ms...`);
  await delay(jitterMs);

  try {
    const response = await axios.get(url, {
      headers: getRandomHeaders(),
      timeout: 10000,
      validateStatus: () => true // Handle statuses gracefully
    });

    if (response.status !== 200) {
      console.warn(`[Scraper Service] Non-200 HTTP code received (${response.status}). Triggering robust slug parsing fallback.`);
      const fallbackData = parseSlugFallback(url, platform, `HTTP ${response.status}`);
      fallbackData.scraperBlocked = true; // Set block flag for fail-safe compilation
      return fallbackData;
    }

    const html = response.data;
    const $ = cheerio.load(html);

    let title = '';
    let bullets = [];

    if (platform === 'Amazon India') {
      // 1. Amazon Title Selector Tree Fallback
      title = $('h1#title').text().trim() || 
              $('#productTitle').text().trim() || 
              $('meta[name="title"]').attr('content') ||
              $('meta[property="og:title"]').attr('content') ||
              $('title').text();
      
      // Amazon Feature Bullets
      $('#feature-bullets li:not(.a-disabled)').each((_, el) => {
        const txt = $(el).text().trim();
        if (txt && !txt.toLowerCase().includes('size:') && !txt.toLowerCase().includes('dimension:')) {
          bullets.push(txt);
        }
      });
    } else if (platform === 'Flipkart') {
      // 2. Flipkart Title Selector Tree Fallback
      title = $('.B_NuCI').text().trim() || 
              $('h1 span').text().trim() || 
              $('meta[name="title"]').attr('content') ||
              $('meta[property="og:title"]').attr('content') ||
              $('h1').text();
      
      // Flipkart Specifications
      $('.W2ZOPZ').each((_, el) => {
        const val = $(el).text().trim();
        if (val) bullets.push(val);
      });
      $('li._21A7uJ').each((_, el) => {
        bullets.push($(el).text().trim());
      });
    } else if (platform === 'Meesho') {
      title = $('span.dghxcu').text().trim() || 
              $('h3').text().trim() || 
              $('h1').text().trim() ||
              $('title').text();
      
      // Details spec text
      $('span.bLWyNz').each((_, el) => {
        bullets.push($(el).text().trim());
      });
    }

    // Double check: if DOM extraction returned empty results, run robust fallback
    if (!title || title.trim() === '') {
      console.warn(`[Scraper Service] Empty DOM parser results. Triggering robust slug parsing fallback.`);
      const fallbackData = parseSlugFallback(url, platform, "Empty DOM title");
      fallbackData.scraperBlocked = true; // Set block flag
      return fallbackData;
    }

    // Cleanup Title text
    title = title.replace(/\s+/g, ' ').trim();

    console.log(`[Scraper Service] DOM Parse success. Title: "${title.substring(0, 40)}...", Bullets Count: ${bullets.length}`);
    return {
      platform,
      scrapedTitle: title,
      scrapedBullets: bullets,
      scrapedRawText: `Scraped Title: ${title}\nScraped Bullets:\n${bullets.map(b => `- ${b}`).join('\n')}`,
      scraperBlocked: false,
      method: 'DOM Scrape'
    };

  } catch (error) {
    console.warn(`[Scraper Service] Network or parsing exception: ${error.message}. Triggering robust slug parsing fallback.`);
    const fallbackData = parseSlugFallback(url, platform, error.message);
    fallbackData.scraperBlocked = true; // Set block flag
    return fallbackData;
  }
};

// Robust slug fallback: decodes and extracts keywords out of the URL pathname slug directly
// Ensures the pipeline never throws fatal CORS/network block failures!
const parseSlugFallback = (url, platform, reason) => {
  try {
    const parsedUrl = new URL(url);
    const pathname = parsedUrl.pathname;
    
    // Split on slashes and hyphens, filters empty parts
    const parts = pathname.split(/[/\-_]/).filter(p => p.length > 2 && isNaN(Number(p)));
    
    // Throw away common tracking/system parameters
    const skippedKeywords = new Set(['buy', 'product', 'item', 'dp', 'p', 'gp', 'in', 'ref', 'buy', 'shop', 'online']);
    const keywords = parts.filter(p => !skippedKeywords.has(p.toLowerCase()));
    
    // Reconstruct title
    const reconstructedTitle = keywords.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    
    console.log(`[Scraper Fallback] Extracted keywords successfully. Reason: "${reason}". Reconstructed Title: "${reconstructedTitle}"`);

    return {
      platform,
      scrapedTitle: reconstructedTitle || `Product from ${platform}`,
      scrapedBullets: [`Analyzed via URL path search keywords: ${keywords.join(', ')}`],
      scrapedRawText: `Platform: ${platform}\nExtracted Product Metadata: ${keywords.join(' ')}`,
      scraperBlocked: true,
      method: 'URL Path Slug Extraction Fallback'
    };
  } catch (e) {
    console.error("[Scraper Fallback] Critical URL parse failure:", e.message);
    return {
      platform,
      scrapedTitle: `Product listing from ${platform}`,
      scrapedBullets: ['URL parsing failure.'],
      scrapedRawText: `Platform: ${platform}\nCompetitor link extraction failed.`,
      scraperBlocked: true,
      method: 'Default Fallback'
    };
  }
};

module.exports = {
  scrapeCompetitorLink
};
