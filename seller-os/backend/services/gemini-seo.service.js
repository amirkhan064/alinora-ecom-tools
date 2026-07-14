/**
 * gemini-seo.service.js
 * High-Performance Google Gemini 2.5 Flash service for multi-platform e-commerce catalog generation.
 * 
 * KEY DESIGN DECISIONS:
 * - Platform-specific prompt templates with real marketplace algorithm rules
 * - Category-aware dynamic attributes (jewelry, clothing, electronics, home, etc.)
 * - Rule-based SEO scoring (NOT hallucinated by AI)
 * - Self-correction loop for title length compliance
 * - Temperature 0.4 for deterministic, accurate outputs
 */

const GEMINI_MODEL = 'gemini-2.5-flash';

// ============================================================================
// PLATFORM-SPECIFIC PROMPT TEMPLATES
// Each contains real marketplace algorithm rules and formatting requirements
// ============================================================================

const PLATFORM_RULES = {
  'Amazon India': {
    titleMaxChars: 125,
    bulletCount: 5,
    keywordCount: 15,
    maxKeywordBytes: 200,
    rules: `AMAZON INDIA A9/A10 ALGORITHM RULES:
- TITLE FORMAT: [Brand] + [Product Type] + [Key Feature/Material] + [Size/Quantity] + [Color/Variant]. STRICTLY under 125 characters. No promotional text ("Best Seller", "Hot Deal"), no emojis, no special characters except hyphens and commas.
- BULLET POINTS: Generate exactly 5 bullet points. Each MUST start with a CAPITALIZED HEADER WORD followed by a colon (e.g., "PREMIUM QUALITY: ..."). Each bullet 150-250 characters. Focus on benefits, not just features. Include relevant keywords naturally.
- DESCRIPTION: 150-300 words. Use short paragraphs. Weave in 5-8 high-volume keywords naturally. Include a call-to-action. Mention warranty/guarantee if applicable.
- BACKEND SEARCH TERMS: Exactly 15 keyword phrases. Total combined length MUST be under 200 bytes. Use single spaces only. NO punctuation, NO brand name repetition, NO ASINs, NO competitor brand names. Mix of short-tail (1-2 words) and long-tail (3-5 words) search terms.
- ATTRIBUTES: Return category-appropriate product attributes that map to Amazon's Browse Node specifications.`
  },
  'Flipkart': {
    titleMaxChars: 100,
    bulletCount: 5,
    keywordCount: 15,
    maxKeywordBytes: 500,
    rules: `FLIPKART CATALOG OPTIMIZATION RULES:
- TITLE FORMAT: [Brand] + [Product Type] + [Key Attribute] + [Color/Size]. Target 60-100 characters for optimal search-click visibility. Avoid filler words. Use only title case.
- BULLET POINTS: Generate 4-6 specification-style bullet points. These should translate directly into Flipkart's key-value technical specification pairs. Each bullet should be formatted as "Feature: Value description" (e.g., "Fabric: Premium 100% combed cotton, pre-shrunk").
- DESCRIPTION: 100-200 words. Focus on product benefits, care instructions, and sizing guidance. Flipkart buyers respond to practical details.
- SEARCH KEYWORDS: 15 highly relevant search terms. Include both Hindi transliterated terms (e.g., "kurta set", "saree") and English equivalents. Flipkart's search indexes both.
- ATTRIBUTES: Must include category-appropriate specification keys. Supply a REAL, VALID 4-digit Indian HSN code matching the product category.
- HSN CODES REFERENCE: Jewelry=7117, Imitation Jewelry=7117, Gold Jewelry=7113, Clothing/Garments=6204, Cotton Clothing=6205, Footwear=6404, Electronics=8517, Mobile Accessories=8518, Home Decor=9405, Kitchen=7323, Bags=4202, Watches=9102, Cosmetics=3304, Toys=9503.`
  },
  'Meesho': {
    titleMaxChars: 80,
    bulletCount: 4,
    keywordCount: 15,
    maxKeywordBytes: 500,
    rules: `MEESHO SUPPLIER HUB OPTIMIZATION RULES:
- TITLE FORMAT: Strictly under 80 characters. Meesho is mobile-first — shorter titles get higher click-through on small screens. Use simple, direct language. Include the most important search keyword within the first 40 characters.
- BULLET POINTS: Generate 4 concise, benefit-focused bullet points. Meesho buyers are budget-conscious — emphasize value, durability, and versatility. Each bullet 80-150 characters max.
- DESCRIPTION: 80-150 words. Write for mobile readability. Short sentences. Emphasize affordability, quality-for-price, and multi-use scenarios. Include vernacular/Hinglish phrases that Meesho's tier-2/tier-3 city shoppers actually search for (e.g., "trendy kurti", "daily wear", "combo pack", "free size", "anti-tarnish").
- SEARCH KEYWORDS: 15 keywords mixing vernacular, Hinglish, and English terms. Target low-cost, high-volume search phrases used by budget shoppers. Include regional descriptors.
- ATTRIBUTES: Focus on practical attributes — material, size, color, pack quantity, washability. Include HSN code.
- PRICING: Meesho buyers expect competitive prices. Margin guidance should account for Meesho's commission structure (15-20% platform fee).`
  },
  'Myntra': {
    titleMaxChars: 100,
    bulletCount: 5,
    keywordCount: 15,
    maxKeywordBytes: 500,
    rules: `MYNTRA PARTNER PORTAL (PPMP) OPTIMIZATION RULES:
- TITLE FORMAT: Highly descriptive and elegant, strictly under 100 characters. Format: [Brand] + [Product Type] + [Design/Pattern] + [Material]. Myntra buyers are fashion-conscious — use aspirational language.
- BULLET POINTS: Generate 5 lifestyle-oriented bullet points. Focus on: styling tips, fabric feel, design inspiration, occasion versatility, and care instructions. Each bullet should paint a picture of the wearing experience.
- DESCRIPTION: 150-250 words. Write with premium brand voice. Include styling suggestions, fabric composition percentages, fit guidance (slim fit, regular, relaxed), and wash care symbols interpretation. Mention seasonal relevance.
- SEARCH KEYWORDS: 15 fashion-specific search terms. Include style descriptors (boho, minimalist, ethnic-fusion), occasion tags (office wear, date night, festive), and trend keywords.
- ATTRIBUTES: Must include fashion-specific attributes — fabric composition %, fit type, pattern, neckline/collar style, sleeve type, wash care, model measurements if applicable.
- BRAND VOICE: Myntra positions as a premium fashion destination. Content should feel editorial, not transactional.`
  }
};

// ============================================================================
// CATEGORY-AWARE ATTRIBUTE SCHEMAS
// ============================================================================

const CATEGORY_ATTRIBUTES = {
  jewelry: {
    keys: ['material', 'plating', 'stoneType', 'closureType', 'occasion', 'gender', 'chainLength', 'weight'],
    hint: 'This is a JEWELRY product. Focus on material purity, plating quality, stone details, and anti-tarnish properties.'
  },
  clothing: {
    keys: ['fabric', 'pattern', 'fit', 'sleeveType', 'neckline', 'careInstructions', 'occasion', 'season'],
    hint: 'This is a CLOTHING/APPAREL product. Focus on fabric composition %, fit type, sizing accuracy, and wash care.'
  },
  footwear: {
    keys: ['material', 'soleMaterial', 'closureType', 'heelHeight', 'occasion', 'width', 'waterproof', 'weight'],
    hint: 'This is a FOOTWEAR product. Focus on comfort, sole grip, material breathability, and sizing accuracy.'
  },
  electronics: {
    keys: ['powerSource', 'connectivity', 'warranty', 'compatibility', 'dimensions', 'weight', 'color', 'inTheBox'],
    hint: 'This is an ELECTRONICS product. Focus on specifications, compatibility, battery life, and warranty coverage.'
  },
  home: {
    keys: ['material', 'dimensions', 'weight', 'color', 'careInstructions', 'roomType', 'style', 'assemblyRequired'],
    hint: 'This is a HOME/KITCHEN product. Focus on material durability, exact dimensions, maintenance ease, and aesthetic fit.'
  },
  beauty: {
    keys: ['skinType', 'ingredients', 'volume', 'fragrance', 'spfRating', 'shelfLife', 'crueltyFree', 'suitableFor'],
    hint: 'This is a BEAUTY/COSMETICS product. Focus on ingredients, skin compatibility, certifications, and usage instructions.'
  },
  generic: {
    keys: ['material', 'color', 'size', 'weight', 'occasion', 'careInstructions', 'warranty', 'packContents'],
    hint: 'Detect the product category from the image/text and provide the most relevant technical attributes.'
  }
};

// ============================================================================
// RULE-BASED SEO SCORING ENGINE
// Replaces hallucinated AI scores with deterministic, grounded evaluation
// ============================================================================

function calculateSeoScore(listing, platform) {
  const rules = PLATFORM_RULES[platform];
  if (!rules) return { overall: 70, title: 70, description: 70, keywords: 70 };

  // --- Title Score (0-100) ---
  let titleScore = 50;
  const titleLen = (listing.title || '').length;

  if (titleLen > 0 && titleLen <= rules.titleMaxChars) {
    // Within limit: base 60
    titleScore = 60;
    // Optimal length range bonus (60-90% of max)
    const optimalMin = Math.floor(rules.titleMaxChars * 0.55);
    const optimalMax = Math.floor(rules.titleMaxChars * 0.92);
    if (titleLen >= optimalMin && titleLen <= optimalMax) titleScore += 20;
    else if (titleLen >= Math.floor(rules.titleMaxChars * 0.4)) titleScore += 10;
    // Contains brand-like capitalized word at start
    if (/^[A-Z][a-zA-Z]+/.test(listing.title)) titleScore += 5;
    // Contains key product descriptor words
    const descriptors = ['for', 'with', 'set', 'pack', 'pair', 'combo'];
    if (descriptors.some(d => listing.title.toLowerCase().includes(d))) titleScore += 5;
    // No promotional spam
    const spamWords = ['best', '#1', 'guaranteed', 'free', '!!!', 'hot deal', 'limited'];
    if (!spamWords.some(s => listing.title.toLowerCase().includes(s))) titleScore += 5;
    // No excessive special characters
    if (!/[!@#$%^&*()+={}[\]|\\:;"'<>?/]{2,}/.test(listing.title)) titleScore += 5;
  } else if (titleLen > rules.titleMaxChars) {
    // Over limit: penalize proportionally
    const overBy = titleLen - rules.titleMaxChars;
    titleScore = Math.max(20, 60 - overBy * 2);
  }
  titleScore = Math.min(100, titleScore);

  // --- Description Score (0-100) ---
  let descScore = 50;
  const descWords = (listing.description || '').split(/\s+/).filter(w => w.length > 0).length;

  if (descWords >= 50 && descWords <= 350) {
    descScore = 65;
    // Optimal word count
    if (descWords >= 100 && descWords <= 250) descScore += 15;
    // Contains paragraphs (multiple sentences)
    if ((listing.description || '').split(/[.!?]/).filter(s => s.trim().length > 10).length >= 3) descScore += 10;
    // Contains some keywords from the keywords list
    const kwSet = new Set((listing.keywords || []).map(k => k.toLowerCase()));
    const descLower = (listing.description || '').toLowerCase();
    let kwHits = 0;
    kwSet.forEach(k => { if (descLower.includes(k)) kwHits++; });
    if (kwHits >= 3) descScore += 10;
    else if (kwHits >= 1) descScore += 5;
  } else if (descWords < 50) {
    descScore = 35 + descWords;
  }
  descScore = Math.min(100, descScore);

  // --- Keywords Score (0-100) ---
  let kwScore = 50;
  const keywords = listing.keywords || [];
  const kwCount = keywords.length;

  if (kwCount === rules.keywordCount) {
    kwScore = 70;
  } else if (kwCount >= rules.keywordCount - 2 && kwCount <= rules.keywordCount + 2) {
    kwScore = 60;
  }

  // Uniqueness check (no duplicates)
  const uniqueKws = new Set(keywords.map(k => k.toLowerCase().trim()));
  if (uniqueKws.size === kwCount) kwScore += 10;

  // Byte length check for Amazon
  if (platform === 'Amazon India') {
    const totalBytes = Buffer.byteLength(keywords.join(' '), 'utf8');
    if (totalBytes <= rules.maxKeywordBytes) kwScore += 10;
    else kwScore -= 10;
  } else {
    kwScore += 5;
  }

  // Long-tail mix (keywords with 2+ words)
  const longTailCount = keywords.filter(k => k.trim().split(/\s+/).length >= 2).length;
  const longTailRatio = longTailCount / Math.max(1, kwCount);
  if (longTailRatio >= 0.3 && longTailRatio <= 0.7) kwScore += 10;
  else if (longTailRatio > 0) kwScore += 5;

  kwScore = Math.min(100, kwScore);

  // --- Overall Score (weighted average) ---
  const overall = Math.round(titleScore * 0.35 + descScore * 0.30 + kwScore * 0.35);

  return {
    overall: Math.min(100, overall),
    title: titleScore,
    description: descScore,
    keywords: kwScore
  };
}

// ============================================================================
// CORE API CALL HELPER
// ============================================================================

async function callGemini(apiKey, systemInstruction, promptParts, temperature = 0.4) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: promptParts }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: {
          responseMimeType: 'application/json',
          temperature
        }
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Gemini Service] HTTP Error ${response.status}:`, errorText);
    if (response.status === 429 || errorText.includes('RESOURCE_EXHAUSTED') || errorText.includes('Quota exceeded') || errorText.includes('429')) {
      throw new Error("GEMINI_RATE_LIMIT_EXHAUSTED");
    }
    throw new Error(`Google Gemini API Error: ${errorText}`);
  }

  const responseData = await response.json();
  const rawText = responseData.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error('Empty response from Gemini API.');

  try {
    return JSON.parse(rawText.trim());
  } catch (err) {
    console.error('[Gemini Service] JSON Parse failed. Raw:', rawText.substring(0, 500));
    throw new Error('Gemini returned invalid JSON format.');
  }
}

// ============================================================================
// LEGACY SINGLE-PLATFORM GENERATION (Phase 13 SEO Optimizer)
// ============================================================================

const generateSeoData = async (imageBuffer, mimeType, platform, additionalContext) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY' || apiKey.trim() === '') {
    throw new Error("GEMINI_API_KEY is not configured in the backend environment. Please set a valid API key in .env");
  }

  const base64Data = imageBuffer.toString('base64');
  const promptText = `Analyze this product photo. Based on the selected target platform "${platform}" and the additional context "${additionalContext || 'None'}", generate listing copy.`;

  const systemInstruction = `You are a high-performing e-commerce SEO listing optimizer specializing in Indian marketplaces (Amazon India, Flipkart, Meesho). 
Analyze the provided product photo. Based on the selected platform and any additional context, return a clean, valid JSON object with the following keys:
- "title": A high-CTR, keyword-rich product title optimized for search indexability on the chosen platform.
- "features": An array of 4 to 5 core benefit bullet points that highlight features, selling points.
- "description": An engaging, keyword-optimized summary of the product.
- "keywords": An array of exactly 15 high-search-volume keywords/tags.

You MUST return ONLY the JSON object. Do not wrap in markdown code blocks like \`\`\`json. Match this structure:
{
  "title": "string",
  "features": ["string", "string", ...],
  "description": "string",
  "keywords": ["string", "string", ...]
}`;

  return await callGemini(apiKey, systemInstruction, [
    { text: promptText },
    { inlineData: { mimeType, data: base64Data } }
  ]);
};


// ============================================================================
// PHASE 14: MULTI-PLATFORM CATALOG GENERATION ENGINE (UPGRADED)
// ============================================================================

const generateCatalogData = async (platformsList, inputDataPayload) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY' || apiKey.trim() === '') {
    throw new Error("GEMINI_API_KEY is not configured. Please set a valid API key in .env");
  }

  const category = inputDataPayload.category || 'generic';
  const categoryInfo = CATEGORY_ATTRIBUTES[category] || CATEGORY_ATTRIBUTES.generic;

  // Build the user prompt with all available context
  let promptText = `Generate high-converting, SEO-optimized product listings for these marketplace platforms: [${platformsList.join(', ')}].\n\n`;

  if (inputDataPayload.scrapedText) {
    promptText += `COMPETITOR LISTING DATA (use this to understand the product and beat their listing quality):\n${inputDataPayload.scrapedText}\n\n`;
  }
  if (inputDataPayload.rawTitle || inputDataPayload.rawDescription) {
    promptText += `SELLER-PROVIDED PRODUCT INFO:\nTitle: ${inputDataPayload.rawTitle || 'Not provided'}\nDescription: ${inputDataPayload.rawDescription || 'Not provided'}\n\n`;
  }
  if (inputDataPayload.additionalContext) {
    promptText += `ADDITIONAL PRODUCT DETAILS FROM SELLER: ${inputDataPayload.additionalContext}\n\n`;
  }
  if (category !== 'generic') {
    promptText += `PRODUCT CATEGORY: ${category.toUpperCase()}\n\n`;
  }
  if (inputDataPayload.scraperBlocked) {
    promptText += `NOTE: The competitor page scraper was partially blocked. Work with whatever partial data is available and infer the product type from context clues.\n\n`;
  }

  // Build platform-specific rules section
  const platformRulesText = platformsList.map(p => {
    const rules = PLATFORM_RULES[p];
    return rules ? `\n### ${p}\n${rules.rules}` : '';
  }).join('\n');

  // Build the system instruction with category-aware attributes
  const systemInstruction = `You are an elite e-commerce catalog optimizer engineered for Indian marketplaces. You have deep expertise in search algorithm optimization for Amazon A9/A10, Flipkart's search ranking, Meesho's mobile-first discovery, and Myntra's fashion search.

YOUR TASK: Analyze the input data (image, text, or scraped competitor listing) and generate production-ready listing content for each requested platform.

${categoryInfo.hint}

PLATFORM-SPECIFIC RULES TO FOLLOW EXACTLY:
${platformRulesText}

ATTRIBUTE KEYS TO USE: ${JSON.stringify(categoryInfo.keys)}
For each platform, populate the "attributes" object using ONLY these keys (skip any that don't apply to the specific product). Add attribute values based on what you can observe or infer from the product.

CRITICAL QUALITY RULES:
1. Each platform's title MUST be a DIFFERENT, uniquely optimized version — NOT the same title copied across platforms.
2. Keywords MUST be unique within each platform (no duplicates). Mix short-tail and long-tail phrases.
3. For Amazon India: backend search terms MUST total under 200 bytes combined. No punctuation in keywords.
4. Bullet points should lead with BENEFIT, then support with feature details. No generic filler text.
5. Include a real, valid 4-digit Indian HSN code in taxAndPricing for each platform.
6. Price suggestions should reflect actual Indian marketplace price ranges for the product category.

OUTPUT FORMAT — Return a single valid JSON object with this exact structure. Do NOT wrap in markdown code blocks:
{
  "${platformsList[0]}": {
    "title": "string (platform-optimized title)",
    "bullets": ["string (benefit-led bullet point)", ...],
    "description": "string (SEO-rich product description)",
    "keywords": ["string (search term)", ...],
    "attributes": { ${categoryInfo.keys.map(k => `"${k}": "string"`).join(', ')} },
    "taxAndPricing": {
      "suggestedPrice": "₹X-₹Y",
      "competitivePrice": "₹A-₹B",
      "marginNote": "string (margin guidance text)",
      "hsnCode": "4-digit string",
      "category": "string (product category name)"
    }
  }
}

Use exact platform keys: ${platformsList.map(p => `"${p}"`).join(', ')}. Only return JSON.`;

  // Build multimodal parts array
  const partsArray = [{ text: promptText }];
  if (inputDataPayload.imageBuffer && inputDataPayload.mimeType) {
    partsArray.push({
      inlineData: {
        mimeType: inputDataPayload.mimeType,
        data: inputDataPayload.imageBuffer.toString('base64')
      }
    });
  }

  console.log(`[Gemini Catalog Service] Generating for platforms: ${platformsList.join(', ')}, category: ${category}`);

  let catalogData = await callGemini(apiKey, systemInstruction, partsArray, 0.4);

  // ---- POST-PROCESSING: Self-correction and SEO scoring ----
  for (const platform of platformsList) {
    if (!catalogData[platform]) continue;
    const listing = catalogData[platform];
    const rules = PLATFORM_RULES[platform];

    // 1. Self-correct title length if over limit
    if (rules && listing.title && listing.title.length > rules.titleMaxChars) {
      console.log(`[Gemini Catalog Service] Title too long for ${platform} (${listing.title.length}/${rules.titleMaxChars}). Running self-correction...`);
      try {
        const fixResult = await callGemini(apiKey,
          `You are a title editor. Shorten the following product title to STRICTLY under ${rules.titleMaxChars} characters while preserving the most important keywords and brand name. Return JSON: { "title": "shortened title" }`,
          [{ text: `Original title: "${listing.title}"\nPlatform: ${platform}\nMax characters: ${rules.titleMaxChars}` }],
          0.2
        );
        if (fixResult.title && fixResult.title.length <= rules.titleMaxChars) {
          listing.title = fixResult.title;
          console.log(`[Gemini Catalog Service] Title corrected to ${listing.title.length} chars for ${platform}.`);
        }
      } catch (e) {
        console.warn(`[Gemini Catalog Service] Title self-correction failed for ${platform}:`, e.message);
      }
    }

    // 2. Deduplicate keywords
    if (listing.keywords && Array.isArray(listing.keywords)) {
      const seen = new Set();
      listing.keywords = listing.keywords.filter(kw => {
        const normalized = kw.toLowerCase().trim();
        if (seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      });
    }

    // 3. Enforce Amazon keyword byte limit
    if (platform === 'Amazon India' && listing.keywords && Array.isArray(listing.keywords)) {
      let totalBytes = Buffer.byteLength(listing.keywords.join(' '), 'utf8');
      while (totalBytes > 200 && listing.keywords.length > 5) {
        // Remove the longest keyword to fit under 200 bytes
        let longestIdx = 0;
        let longestLen = 0;
        listing.keywords.forEach((kw, idx) => {
          if (Buffer.byteLength(kw, 'utf8') > longestLen) {
            longestLen = Buffer.byteLength(kw, 'utf8');
            longestIdx = idx;
          }
        });
        listing.keywords.splice(longestIdx, 1);
        totalBytes = Buffer.byteLength(listing.keywords.join(' '), 'utf8');
      }
    }

    // 4. Calculate rule-based SEO scores (replace any AI-hallucinated scores)
    listing.seoScore = calculateSeoScore(listing, platform);
  }

  return catalogData;
};


// ============================================================================
// GRANULAR NODE REFRESH OPERATIONS (EXPANDED)
// Now supports: title, keywords, taxAndPricing, bullets, description
// ============================================================================

const refreshListingNode = async (platform, nodeType, currentDetails) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY' || apiKey.trim() === '') {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const rules = PLATFORM_RULES[platform];
  let promptText = `Acting as an expert e-commerce SEO listing optimizer for "${platform}", regenerate ONLY the requested content field.\n\n`;
  promptText += `CURRENT LISTING CONTEXT:\n`;
  promptText += `Title: ${currentDetails.title || 'None'}\n`;
  promptText += `Description: ${currentDetails.description || 'None'}\n`;
  promptText += `Keywords: ${Array.isArray(currentDetails.keywords) ? currentDetails.keywords.join(', ') : 'None'}\n`;
  promptText += `Bullets: ${Array.isArray(currentDetails.bullets) ? currentDetails.bullets.join(' | ') : 'None'}\n\n`;

  let systemInstruction = '';

  if (nodeType === 'title') {
    promptText += `Generate a completely NEW, different high-CTR title. Do NOT repeat the existing title.`;
    const maxChars = rules ? rules.titleMaxChars : 100;
    systemInstruction = `Regenerate a NEW high-converting product title for "${platform}".
CONSTRAINTS: STRICTLY under ${maxChars} characters. Different from the current title. Keyword-rich and formatted per ${platform}'s style guide.
Return exactly this JSON: { "title": "new optimized title" }`;

  } else if (nodeType === 'keywords') {
    promptText += `Generate a completely fresh set of 15 high-volume search keywords. Different from the current set.`;
    systemInstruction = `Regenerate exactly 15 NEW, unique search keyword phrases for "${platform}".
CONSTRAINTS: No duplicates. Mix short-tail and long-tail phrases.${platform === 'Amazon India' ? ' Total combined length MUST be under 200 bytes. No punctuation.' : ''}
Return exactly this JSON: { "keywords": ["term1", "term2", ...] }`;

  } else if (nodeType === 'bullets') {
    const bulletCount = rules ? rules.bulletCount : 5;
    promptText += `Generate ${bulletCount} completely NEW bullet points. Different from the current ones.`;
    systemInstruction = `Regenerate ${bulletCount} NEW, benefit-led bullet points for "${platform}".
CONSTRAINTS: Each starts with a CAPITALIZED HEADER WORD followed by colon. Focus on benefits, not just features. Different from current bullets.
Return exactly this JSON: { "bullets": ["HEADER: benefit text", ...] }`;

  } else if (nodeType === 'description') {
    promptText += `Write a completely NEW product description. Different angle from the current one.`;
    systemInstruction = `Regenerate a NEW SEO-optimized product description for "${platform}".
CONSTRAINTS: 100-300 words. Weave in relevant search keywords naturally. Different from current description. Include practical details.
Return exactly this JSON: { "description": "new description text" }`;

  } else if (nodeType === 'taxAndPricing') {
    promptText += `Re-calculate the pricing, HSN code, and margin guidance.`;
    systemInstruction = `Re-calculate suggested price ranges, competitive price points, category mappings, HSN code, and margin notes for "${platform}".
Return exactly this JSON: { "taxAndPricing": { "suggestedPrice": "₹X-₹Y", "competitivePrice": "₹A-₹B", "marginNote": "guidance text", "hsnCode": "4-digit string", "category": "category name" } }`;

  } else {
    throw new Error(`Unsupported node refresh type: ${nodeType}`);
  }

  let result = await callGemini(apiKey, systemInstruction, [{ text: promptText }], 0.5);

  // Post-process: recalculate SEO score after refresh
  if (nodeType === 'title' || nodeType === 'keywords' || nodeType === 'description' || nodeType === 'bullets') {
    const mergedListing = { ...currentDetails, ...result };
    result.seoScore = calculateSeoScore(mergedListing, platform);
  }

  return result;
};

module.exports = {
  generateSeoData,
  generateCatalogData,
  refreshListingNode
};
