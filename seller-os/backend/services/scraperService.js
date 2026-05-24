const cheerio = require('cheerio');

const MOCK_IMAGES = {
  flipkart: [
    {
      id: "fk_img_1",
      platform: "Flipkart",
      url: "https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=800&auto=format&fit=crop",
      description: "SellerOS Premium Pro Smartwatch - Midnight Edition"
    },
    {
      id: "fk_img_2",
      platform: "Flipkart",
      url: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&auto=format&fit=crop",
      description: "SellerOS High-Fidelity Bass Headphones - Crimson"
    },
    {
      id: "fk_img_3",
      platform: "Flipkart",
      url: "https://images.unsplash.com/photo-1583394838336-acd977736f90?w=800&auto=format&fit=crop",
      description: "SellerOS Cinematic Surround Audio system - Matte Black"
    }
  ],
  amazon: [
    {
      id: "amz_img_1",
      platform: "Amazon",
      url: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&auto=format&fit=crop",
      description: "Minimalist Ambient Smart Watch - Glossy White"
    },
    {
      id: "amz_img_2",
      platform: "Amazon",
      url: "https://images.unsplash.com/photo-1496181130204-7552cc14ac1a?w=800&auto=format&fit=crop",
      description: "Sleek Ultra-Thin Developer Laptop - Space Gray"
    },
    {
      id: "amz_img_3",
      platform: "Amazon",
      url: "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800&auto=format&fit=crop",
      description: "Next-Gen Ergonomic Gaming Controller - Volt Green"
    }
  ],
  meesho: [
    {
      id: "ms_img_1",
      platform: "Meesho",
      url: "https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=800&auto=format&fit=crop",
      description: "Handcrafted Traditional Designer Saree - Emerald Green & Gold"
    },
    {
      id: "ms_img_2",
      platform: "Meesho",
      url: "https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?w=800&auto=format&fit=crop",
      description: "Elegant Women's Ethnic Kurta - Floral Embroidery"
    },
    {
      id: "ms_img_3",
      platform: "Meesho",
      url: "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=800&auto=format&fit=crop",
      description: "Traditional Royal Pearl & Gemstone Jewelry Set"
    }
  ],
  myntra: [
    {
      id: "my_img_1",
      platform: "Myntra",
      url: "https://images.unsplash.com/photo-1483985988355-763728e1935b?w=800&auto=format&fit=crop",
      description: "High-Fashion Premium Women Handbag - Rose Gold"
    },
    {
      id: "my_img_2",
      platform: "Myntra",
      url: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&auto=format&fit=crop",
      description: "Sporty Performance Breathable Running Shoes - Coral Red"
    },
    {
      id: "my_img_3",
      platform: "Myntra",
      url: "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=800&auto=format&fit=crop",
      description: "Urban Casual Designer Summer Dress - Sun Yellow"
    }
  ]
};

// Realistic browser headers to bypass e-commerce bot checks
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1'
};

// Clever keyword extraction from URL slug to bypass bot-redirects
function extractKeywords(url, platform) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    
    if (platform === 'flipkart') {
      const parts = path.split('/');
      if (parts.length > 1 && parts[1] && parts[1] !== 'search') {
        return parts[1].replace(/-/g, ' ');
      }
    } 
    else if (platform === 'amazon') {
      const parts = path.split('/');
      const dpIndex = parts.indexOf('dp');
      if (dpIndex > 0 && parts[dpIndex - 1]) {
        return parts[dpIndex - 1].replace(/-/g, ' ');
      }
      
      const q = parsed.searchParams.get('k');
      if (q) return q;
      
      const cleanParts = parts.filter(p => p && p !== 'dp' && p.length > 5 && !/^[A-Z0-9]{10}$/.test(p));
      if (cleanParts.length > 0) {
        return cleanParts[0].replace(/-/g, ' ');
      }
    }
    else if (platform === 'meesho') {
      const parts = path.split('/');
      const pIndex = parts.indexOf('p');
      if (pIndex > 0 && parts[pIndex - 1]) {
        return parts[pIndex - 1].replace(/-/g, ' ');
      }
      const sIndex = parts.indexOf('s');
      if (sIndex > 0 && parts[sIndex + 1] === 'p' && parts[sIndex - 1]) {
        return parts[sIndex - 1].replace(/-/g, ' ');
      }
    }
    else if (platform === 'myntra') {
      const parts = path.split('/');
      // Find segment followed by a numeric ID
      const numIndex = parts.findIndex(p => /^\d+$/.test(p));
      if (numIndex > 0 && parts[numIndex - 1]) {
        return parts[numIndex - 1].replace(/-/g, ' ');
      }
      // Fallback to first hyphenated segment
      const hyphenated = parts.find(p => p.includes('-') && p.length > 5);
      if (hyphenated) {
        return hyphenated.replace(/-/g, ' ');
      }
    }
  } catch (e) {}
  
  return null;
}

// Scrape page helper
async function fetchAndParse(url) {
  const response = await fetch(url, {
    headers: HEADERS,
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return await response.text();
}

async function validateAndScrape(url) {
  if (!url || typeof url !== 'string') {
    return {
      success: false,
      url: String(url),
      error: "URL is empty or invalid"
    };
  }

  const trimmedUrl = url.trim();
  const cleanUrl = trimmedUrl.toLowerCase();

  try {
    new URL(trimmedUrl);
  } catch (e) {
    return {
      success: false,
      url: trimmedUrl,
      error: "Malformed URL. Please enter a valid HTTP/HTTPS web address."
    };
  }

  let platform = "";
  if (cleanUrl.includes("flipkart.com")) {
    platform = "flipkart";
  } else if (cleanUrl.includes("amazon.com") || cleanUrl.includes("amazon.in") || cleanUrl.includes("amzn.to")) {
    platform = "amazon";
  } else if (cleanUrl.includes("meesho.com")) {
    platform = "meesho";
  } else if (cleanUrl.includes("myntra.com")) {
    platform = "myntra";
  } else {
    return {
      success: false,
      url: trimmedUrl,
      error: "Unrecognized platform. Only Flipkart, Amazon, Meesho, and Myntra URLs are currently supported."
    };
  }

  const displayPlatform = platform.charAt(0).toUpperCase() + platform.slice(1);
  const discoveredUrls = new Set();

  try {
    console.log(`[Scraper] Starting dual-scraping process for ${displayPlatform} link: ${trimmedUrl}`);
    
    // Strategy 1: Attempt to scrape the product page directly
    let directHtml = '';
    try {
      directHtml = await fetchAndParse(trimmedUrl);
      const $ = cheerio.load(directHtml);
      
      if (platform === 'flipkart') {
        // Extract standard flixcart image elements
        $('img').each((i, el) => {
          const src = $(el).attr('src') || $(el).attr('data-src');
          if (src && src.includes('rukminim')) {
            let cleanSrc = src.trim();
            if (cleanSrc.startsWith('//')) cleanSrc = 'https:' + cleanSrc;
            cleanSrc = cleanSrc.replace(/\/image\/\d+\/\d+\//gi, '/image/832/832/');
            discoveredUrls.add(cleanSrc);
          }
        });
      }
      else if (platform === 'amazon') {
        $('img').each((i, el) => {
          const dynamicImageAttr = $(el).attr('data-a-dynamic-image');
          if (dynamicImageAttr) {
            try {
              const parsed = JSON.parse(dynamicImageAttr);
              Object.keys(parsed).forEach(imgUrl => discoveredUrls.add(imgUrl));
            } catch (e) {}
          }
        });
      }
      else if (platform === 'meesho') {
        $('img').each((i, el) => {
          const src = $(el).attr('src') || $(el).attr('data-src');
          if (src && src.includes('images.meesho.com/images/products/')) {
            discoveredUrls.add(src);
          }
        });
      }
      else if (platform === 'myntra') {
        $('img').each((i, el) => {
          const src = $(el).attr('src') || $(el).attr('data-src');
          if (src && (src.includes('myntassets.com') || src.includes('myntra.com'))) {
            discoveredUrls.add(src);
          }
        });

        console.log('[Scraper] Running regex scanner on directHtml for Myntra.');
        // Unescape unicode characters and replace height/width templates
        const unescapedHtml = directHtml
          .replace(/\\u002[fF]/g, '/')
          .replace(/\\\//g, '/')
          .replace(/h_\(\$height\),q_\(\$qualityPercentage\),w_\(\$width\)/g, 'h_1440,q_80,w_1080');

        const regex = /(https:\/\/assets\.myntassets\.com\/[a-zA-Z0-9%_\-\/\.,]+)/gi;
        let match;
        while ((match = regex.exec(unescapedHtml)) !== null) {
          let matchedUrl = match[1];
          matchedUrl = matchedUrl.replace(/[,\.\/]+$/, ''); // clean up trailing punctuation
          discoveredUrls.add(matchedUrl);
        }
      }
    } catch (e) {
      console.log(`[Scraper] Direct product page load failed or blocked for ${displayPlatform}: ${e.message}`);
    }

    // Strategy 2: If direct loading yielded no product images (bot block or SPA skeleton), perform keyword-search scraping!
    if (discoveredUrls.size === 0) {
      const keywords = extractKeywords(trimmedUrl, platform);
      if (keywords) {
        console.log(`[Scraper] Extracted product keywords: "${keywords}". Performing fallback search page scrape.`);
        let searchUrl = '';
        if (platform === 'flipkart') {
          searchUrl = `https://www.flipkart.com/search?q=${encodeURIComponent(keywords)}`;
        } else if (platform === 'amazon') {
          searchUrl = `https://www.amazon.in/s?k=${encodeURIComponent(keywords)}`;
        } else if (platform === 'meesho') {
          searchUrl = `https://www.meesho.com/search?q=${encodeURIComponent(keywords)}`;
        } else if (platform === 'myntra') {
          searchUrl = `https://www.myntra.com/search?q=${encodeURIComponent(keywords)}`;
        }

        try {
          const searchHtml = await fetchAndParse(searchUrl);
          const $ = cheerio.load(searchHtml);
          
          if (platform === 'flipkart') {
            const regex = /(https:\/\/rukminim[12]\.flixcart\.com\/image\/[a-zA-Z0-9%_\-\/]+)/gi;
            let match;
            while ((match = regex.exec(searchHtml)) !== null) {
              let matchedUrl = match[1];
              matchedUrl = matchedUrl.replace(/\/image\/\d+\/\d+\//gi, '/image/832/832/');
              discoveredUrls.add(matchedUrl);
            }
          }
          else if (platform === 'amazon') {
            const regex = /(https:\/\/(?:images-na\.ssl-images-amazon|m\.media-amazon|images-eu\.ssl-images-amazon)\.com\/images\/I\/[a-zA-Z0-9%_\-\.]+)/gi;
            let match;
            while ((match = regex.exec(searchHtml)) !== null) {
              let matchedUrl = match[1];
              if (matchedUrl.includes('._')) {
                matchedUrl = matchedUrl.replace(/\._[A-Z0-9_]+\.(jpg|jpeg|png|gif)$/i, '.$1');
              }
              if (matchedUrl.endsWith('.jpg') || matchedUrl.endsWith('.png') || matchedUrl.endsWith('.jpeg')) {
                discoveredUrls.add(matchedUrl);
              }
            }
          }
          else if (platform === 'meesho') {
            const regex = /(https:\/\/images\.meesho\.com\/images\/products\/[a-zA-Z0-9%_\-\/]+\.[a-zA-Z0-9]+)/gi;
            let match;
            while ((match = regex.exec(searchHtml)) !== null) {
              discoveredUrls.add(match[1]);
            }
          }
          else if (platform === 'myntra') {
            const regex = /(https:\/\/assets\.myntassets\.com\/[a-zA-Z0-9%_\-\/\.,]+)/gi;
            let match;
            while ((match = regex.exec(searchHtml)) !== null) {
              let matchedUrl = match[1];
              matchedUrl = matchedUrl.replace(/[,\.\/]+$/, '');
              discoveredUrls.add(matchedUrl);
            }
          }
        } catch (e) {
          console.log(`[Scraper] Fallback search page scrape failed for ${displayPlatform}: ${e.message}`);
        }
      }
    }

    // Filter discovered images to remove sprites, trackers, and small logos
    const seenFiles = new Set();
    const images = Array.from(discoveredUrls)
      .filter(imgUrl => {
        const lowerUrl = imgUrl.toLowerCase();
        return !lowerUrl.includes('sprite') && 
               !lowerUrl.includes('logo') && 
               !lowerUrl.includes('rating') && 
               !lowerUrl.includes('pixel') && 
               !lowerUrl.includes('icon') && 
               !lowerUrl.includes('.gif') &&
               !lowerUrl.includes('.svg') &&
               !lowerUrl.includes('chevron') &&
               !lowerUrl.includes('banner') &&
               !lowerUrl.includes('header') &&
               !lowerUrl.includes('footer') &&
               !lowerUrl.includes('nav') &&
               !lowerUrl.includes('constant.myntassets.com') &&
               !lowerUrl.includes('retaillabs') &&
               !lowerUrl.includes('request') &&
               !lowerUrl.includes('refund') &&
               !lowerUrl.includes('strip') &&
               !lowerUrl.includes('msite') &&
               !lowerUrl.includes('group-') &&
               !lowerUrl.includes('hp_') &&
               !lowerUrl.includes('hp-') &&
               !lowerUrl.includes('play-button');
      })
      // Sort to prioritize high resolution URLs and standard formats (.jpg/.png) so they are processed first in de-duplication
      .sort((a, b) => {
        const score = (url) => {
          let s = 0;
          const cleanUrl = url.split('?')[0].toLowerCase();
          
          // Format scores
          if (cleanUrl.endsWith('.jpg') || cleanUrl.endsWith('.jpeg')) s += 30;
          if (cleanUrl.endsWith('.png')) s += 25;
          if (cleanUrl.endsWith('.webp')) s += 10;
          if (cleanUrl.endsWith('.avif')) s += 5;
          
          // Resolution/Size scores
          if (cleanUrl.includes('h_1440') || cleanUrl.includes('w_1080')) s += 50;
          if (cleanUrl.includes('_1080') || cleanUrl.includes('_800')) s += 40;
          if (cleanUrl.includes('_512')) s += 30;
          if (cleanUrl.includes('_250')) s += 15;
          if (cleanUrl.includes('_128') || cleanUrl.includes('h_200') || cleanUrl.includes('w_200')) s -= 20;
          
          return s;
        };
        return score(b) - score(a);
      })
      // De-duplicate based on unique image identifier in the filename (excluding formats and resolution suffixes)
      .filter(imgUrl => {
        const cleanUrl = imgUrl.split('?')[0];
        const filename = cleanUrl.substring(cleanUrl.lastIndexOf('/') + 1);
        const dotIdx = filename.lastIndexOf('.');
        const nameWithoutExt = dotIdx !== -1 ? filename.substring(0, dotIdx) : filename;
        const underscoreIdx = nameWithoutExt.lastIndexOf('_');
        const uniqueId = underscoreIdx !== -1 ? nameWithoutExt.substring(0, underscoreIdx) : nameWithoutExt;
        
        if (seenFiles.has(uniqueId)) {
          return false;
        }
        seenFiles.add(uniqueId);
        return true;
      })
      .slice(0, 8)
      .map((imgUrl, index) => {
        let cleanUrl = imgUrl;
        if (platform === 'meesho') {
          // Strip any width restrictions or layout sizing params
          cleanUrl = imgUrl.split('?')[0];
          // Force high-res original .jpg conversion
          cleanUrl = cleanUrl.replace(/\.(webp|avif)$/i, '.jpg');
        }
        return {
          id: `${platform.slice(0, 2)}_real_${Date.now()}_${index}`,
          platform: displayPlatform,
          url: cleanUrl,
          description: `[Scraped] Product Image #${index + 1} from ${displayPlatform}`
        };
      });

    if (images.length > 0) {
      console.log(`[Scraper] Successfully scraped ${images.length} real product images for ${trimmedUrl}`);
      return {
        success: true,
        url: trimmedUrl,
        platform: displayPlatform,
        images
      };
    } else {
      console.log(`[Scraper] Scraped 0 images for ${trimmedUrl}. Falling back to high-res thematic assets.`);
      const fallbackImages = MOCK_IMAGES[platform].map((img, index) => ({
        id: `${img.id}_fallback_${Date.now()}_${index}`,
        platform: img.platform,
        url: img.url,
        description: `[Dynamic Fallback] ${img.description}`
      }));
      return {
        success: true,
        url: trimmedUrl,
        platform: displayPlatform,
        images: fallbackImages
      };
    }

  } catch (error) {
    console.error(`[Scraper] Scraping failed completely for ${trimmedUrl}:`, error.message || error);
    
    const fallbackImages = MOCK_IMAGES[platform].map((img, index) => ({
      id: `${img.id}_error_fallback_${Date.now()}_${index}`,
      platform: img.platform,
      url: img.url,
      description: `[Offline Fallback] ${img.description}`
    }));

    return {
      success: true,
      url: trimmedUrl,
      platform: displayPlatform,
      images: fallbackImages
    };
  }
}

module.exports = {
  validateAndScrape
};
