/**
 * scraper.service.js
 * In-memory scraper that pulls and parses competitor HTML pages from Amazon, Flipkart, Meesho, and Myntra.
 * Outfitted with stealth header rotations, evasion delays, and robust selector fallback chains.
 * 
 * Updated 2026: Refreshed CSS selectors, extracts price/rating/description data for competitive intelligence.
 */

const axios = require('axios');
const cheerio = require('cheerio');

// Random user agent array for browser fingerprint emulation
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0'
];

// Helper to construct randomized browser fingerprint headers
const getRandomHeaders = () => {
  const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  return {
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8',
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
  else if (lowercaseUrl.includes('myntra.')) platform = 'Myntra';

  console.log(`[Scraper Service] Running stealth parser on competitor link for ${platform}. URL: ${url}`);

  // Throttling jitter evasion: sleep between 200ms and 600ms
  const jitterMs = Math.floor(Math.random() * 400) + 200;
  console.log(`[Scraper Evasion] Jitter throttling latency: sleeping for ${jitterMs}ms...`);
  await delay(jitterMs);

  try {
    const response = await axios.get(url, {
      headers: getRandomHeaders(),
      timeout: 12000,
      validateStatus: () => true // Handle statuses gracefully
    });

    if (response.status !== 200) {
      console.warn(`[Scraper Service] Non-200 HTTP code received (${response.status}). Triggering robust slug parsing fallback.`);
      const fallbackData = parseSlugFallback(url, platform, `HTTP ${response.status}`);
      fallbackData.scraperBlocked = true;
      return fallbackData;
    }

    const html = response.data;
    const $ = cheerio.load(html);

    let title = '';
    let bullets = [];
    let description = '';
    let price = '';
    let rating = '';

    if (platform === 'Amazon India') {
      // Amazon Title — multi-selector fallback chain
      title = $('h1#title span#productTitle').text().trim() ||
              $('h1#title').text().trim() || 
              $('#productTitle').text().trim() || 
              $('meta[name="title"]').attr('content') ||
              $('meta[property="og:title"]').attr('content') ||
              $('title').text();
      
      // Amazon Feature Bullets
      $('#feature-bullets li:not(.a-disabled) span.a-list-item').each((_, el) => {
        const txt = $(el).text().trim();
        if (txt && txt.length > 5 && !txt.toLowerCase().includes('see more')) {
          bullets.push(txt);
        }
      });
      // Fallback bullet selector
      if (bullets.length === 0) {
        $('#feature-bullets li').each((_, el) => {
          const txt = $(el).text().trim();
          if (txt && txt.length > 5 && !txt.toLowerCase().includes('size:') && !txt.toLowerCase().includes('dimension:')) {
            bullets.push(txt);
          }
        });
      }

      // Amazon Description
      description = $('#productDescription p').text().trim() ||
                    $('#productDescription').text().trim() ||
                    $('div.a-section.a-spacing-small.a-spacing-top-small').text().trim() ||
                    '';

      // Amazon Price
      price = $('span.a-price-whole').first().text().trim() ||
              $('span#priceblock_dealprice').text().trim() ||
              $('span#priceblock_ourprice').text().trim() ||
              $('span.a-offscreen').first().text().trim() ||
              '';

      // Amazon Rating
      rating = $('span.a-icon-alt').first().text().trim() ||
               $('i.a-icon-star span.a-icon-alt').text().trim() ||
               '';

    } else if (platform === 'Flipkart') {
      // Flipkart Title — updated selector chain for 2026
      title = $('h1.yhB1nd span').text().trim() ||
              $('h1._6EBuvT span').text().trim() ||
              $('span.VU-ZEz').text().trim() ||
              $('h1.yhB1nd').text().trim() ||
              $('h1._6EBuvT').text().trim() ||
              $('.B_NuCI').text().trim() || 
              $('h1 span').text().trim() || 
              $('meta[name="title"]').attr('content') ||
              $('meta[property="og:title"]').attr('content') ||
              $('h1').first().text().trim();
      
      // Flipkart Highlights/Specifications
      $('li._7eSDEz').each((_, el) => {
        const val = $(el).text().trim();
        if (val) bullets.push(val);
      });
      // Fallback selectors
      if (bullets.length === 0) {
        $('.xFVion li, ._21Ahn-, .W2ZOPZ').each((_, el) => {
          const val = $(el).text().trim();
          if (val && val.length > 3) bullets.push(val);
        });
      }
      if (bullets.length === 0) {
        $('li._21A7uJ').each((_, el) => {
          bullets.push($(el).text().trim());
        });
      }

      // Flipkart Description
      description = $('div._4gvKMe div').text().trim() ||
                    $('div.RmoJUa').text().trim() ||
                    '';

      // Flipkart Price
      price = $('div.Nx9bqj.CxhGGd').text().trim() ||
              $('div._30jeq3._16Jk6d').text().trim() ||
              $('div.Nx9bqj').first().text().trim() ||
              $('div._30jeq3').first().text().trim() ||
              '';

      // Flipkart Rating
      rating = $('div.XQDdHH').text().trim() ||
               $('div._3LWZlK').first().text().trim() ||
               '';

    } else if (platform === 'Meesho') {
      // Meesho Title — updated for 2026 Meesho React SPA
      title = $('span.sc-eDvSVe').text().trim() ||
              $('span.dghxcu').text().trim() || 
              $('h1[class*="ProductTitle"]').text().trim() ||
              $('h3').first().text().trim() || 
              $('h1').first().text().trim() ||
              $('meta[property="og:title"]').attr('content') ||
              $('title').text();
      
      // Meesho Details/Specs
      $('div[class*="ProductSpec"] span, div[class*="ProductDetail"] span').each((_, el) => {
        const val = $(el).text().trim();
        if (val && val.length > 3) bullets.push(val);
      });
      if (bullets.length === 0) {
        $('span.bLWyNz').each((_, el) => {
          bullets.push($(el).text().trim());
        });
      }

      // Meesho Description
      description = $('div[class*="ProductDescription"]').text().trim() ||
                    $('p[class*="description"]').text().trim() ||
                    '';

      // Meesho Price
      price = $('h4[class*="Price"], span[class*="Price"]').first().text().trim() ||
              '';

      // Meesho Rating
      rating = $('span[class*="Rating"]').first().text().trim() ||
               '';

    } else if (platform === 'Myntra') {
      // Myntra Title
      title = $('h1.pdp-title').text().trim() ||
              $('h1.pdp-name').text().trim() ||
              $('meta[property="og:title"]').attr('content') ||
              $('title').text();

      // Myntra Product Details
      $('div.pdp-productDescriptorsContainer li').each((_, el) => {
        const val = $(el).text().trim();
        if (val) bullets.push(val);
      });

      // Myntra Description
      description = $('p.pdp-product-description-content').text().trim() ||
                    $('div.pdp-description-info').text().trim() ||
                    '';

      // Myntra Price
      price = $('span.pdp-price strong').text().trim() ||
              $('span.pdp-discount-container span').first().text().trim() ||
              '';

      // Myntra Rating
      rating = $('div.index-overallRating span').first().text().trim() ||
               '';
    }

    // Double check: if DOM extraction returned empty results, run robust fallback
    if (!title || title.trim() === '') {
      console.warn(`[Scraper Service] Empty DOM parser results. Triggering robust slug parsing fallback.`);
      const fallbackData = parseSlugFallback(url, platform, "Empty DOM title");
      fallbackData.scraperBlocked = true;
      return fallbackData;
    }

    // Cleanup
    title = title.replace(/\s+/g, ' ').trim();
    description = description.replace(/\s+/g, ' ').trim();
    price = price.replace(/\s+/g, ' ').trim();
    rating = rating.replace(/\s+/g, ' ').trim();

    // Build structured scraped text for AI consumption
    let scrapedRawText = `PLATFORM: ${platform}\n`;
    scrapedRawText += `TITLE: ${title}\n`;
    if (price) scrapedRawText += `PRICE: ${price}\n`;
    if (rating) scrapedRawText += `RATING: ${rating}\n`;
    if (bullets.length > 0) scrapedRawText += `HIGHLIGHTS:\n${bullets.map(b => `- ${b}`).join('\n')}\n`;
    if (description) scrapedRawText += `DESCRIPTION: ${description}\n`;

    console.log(`[Scraper Service] DOM Parse success. Title: "${title.substring(0, 50)}...", Bullets: ${bullets.length}, Price: "${price}", Rating: "${rating}"`);

    return {
      platform,
      scrapedTitle: title,
      scrapedBullets: bullets,
      scrapedDescription: description,
      scrapedPrice: price,
      scrapedRating: rating,
      scrapedRawText,
      scraperBlocked: false,
      method: 'DOM Scrape'
    };

  } catch (error) {
    console.warn(`[Scraper Service] Network or parsing exception: ${error.message}. Triggering robust slug parsing fallback.`);
    const fallbackData = parseSlugFallback(url, platform, error.message);
    fallbackData.scraperBlocked = true;
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
    const skippedKeywords = new Set(['buy', 'product', 'item', 'dp', 'p', 'gp', 'in', 'ref', 'buy', 'shop', 'online', 'itm', 'pid', 'lid']);
    const keywords = parts.filter(p => !skippedKeywords.has(p.toLowerCase()));
    
    // Reconstruct title
    const reconstructedTitle = keywords.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    
    console.log(`[Scraper Fallback] Extracted keywords successfully. Reason: "${reason}". Reconstructed Title: "${reconstructedTitle}"`);

    return {
      platform,
      scrapedTitle: reconstructedTitle || `Product from ${platform}`,
      scrapedBullets: [`Analyzed via URL path search keywords: ${keywords.join(', ')}`],
      scrapedDescription: '',
      scrapedPrice: '',
      scrapedRating: '',
      scrapedRawText: `PLATFORM: ${platform}\nTITLE: ${reconstructedTitle || 'Product from ' + platform}\nEXTRACTED KEYWORDS: ${keywords.join(' ')}`,
      scraperBlocked: true,
      method: 'URL Path Slug Extraction Fallback'
    };
  } catch (e) {
    console.error("[Scraper Fallback] Critical URL parse failure:", e.message);
    return {
      platform,
      scrapedTitle: `Product listing from ${platform}`,
      scrapedBullets: ['URL parsing failure.'],
      scrapedDescription: '',
      scrapedPrice: '',
      scrapedRating: '',
      scrapedRawText: `PLATFORM: ${platform}\nCompetitor link extraction failed.`,
      scraperBlocked: true,
      method: 'Default Fallback'
    };
  }
};

module.exports = {
  scrapeCompetitorLink
};
