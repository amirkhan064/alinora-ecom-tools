/**
 * gemini-seo.service.js
 * High-Performance Google Gemini 2.5 Flash service using native fetch.
 * Manages full multi-platform e-commerce catalog generation and isolated node refreshes.
 */

// Legacy helper for single platform generation (Phase 13 SEO Optimizer)
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

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { text: promptText },
          { inlineData: { mimeType, data: base64Data } }
        ]
      }],
      systemInstruction: { parts: [{ text: systemInstruction }] },
      generationConfig: { responseMimeType: "application/json" }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google Gemini API Error: ${errorText}`);
  }

  const responseData = await response.json();
  const rawText = responseData.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error("Empty response from Gemini API.");
  return JSON.parse(rawText.trim());
};


/**
 * ==========================================================================
 * PHASE 14: MULTI-PLATFORM CATALOG GENERATION ENGINE
 * ==========================================================================
 */
const generateCatalogData = async (platformsList, inputDataPayload) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY' || apiKey.trim() === '') {
    throw new Error("GEMINI_API_KEY is not configured. Please set a valid API key in .env");
  }

  // Construct text prompts mapping scraped raw data or past details
  let promptText = `Analyze the provided product inputs.
Generate high-converting optimized listings for the following requested platform markets: [${platformsList.join(', ')}].\n\n`;

  if (inputDataPayload.scrapedText) {
    promptText += `COMPETITOR SCRAED TEXT INFO:\n${inputDataPayload.scrapedText}\n\n`;
  }
  if (inputDataPayload.rawTitle || inputDataPayload.rawDescription) {
    promptText += `RAW ENTERED METADATA:\nTitle: ${inputDataPayload.rawTitle || 'None'}\nDescription: ${inputDataPayload.rawDescription || 'None'}\n\n`;
  }
  if (inputDataPayload.additionalContext) {
    promptText += `ADDITIONAL PRODUCT CONTEXT DETAILS: ${inputDataPayload.additionalContext}\n\n`;
  }
  if (inputDataPayload.scraperBlocked) {
    promptText += `OPERATIONAL WARNING: Scraper hit a block; please analyze any partial metadata strings or extract context parameters intelligently to return a clean layout response.\n\n`;
  }

  // Set up multimodal image data if buffer exists
  const partsArray = [{ text: promptText }];
  if (inputDataPayload.imageBuffer && inputDataPayload.mimeType) {
    partsArray.push({
      inlineData: {
        mimeType: inputDataPayload.mimeType,
        data: inputDataPayload.imageBuffer.toString('base64')
      }
    });
  }

  const systemInstruction = `You are an elite, data-driven e-commerce catalog optimizer engineered specifically for Indian marketplaces (Amazon India, Flipkart, Meesho, Myntra). 
Analyze the input data provided (whether it is an analyzed image asset, raw pasted values, or scraped text fields from a competitor listing). 

You must generate high-converting listings optimized for the following requested platform markets: ${platformsList.join(', ')}.

CRITICAL CONSTRAINTS TO ENFORCE PER MARKETPLACE:
- AMAZON INDIA: Product Title must be strictly under 125 characters max for Fashion/Jewelry categories. Do not include promotional text or emoji parameters. Generate exactly 5 feature bullet points starting with distinct bold text headers. Backend keywords must be strictly under 200 BYTES total, using single spaces with zero repetition or punctuation.
- FLIPKART: Title length should target 50 to 100 characters for high search-click visibility. Bullet data must translate directly into technical specification properties. Supply a real-world, valid 4-digit Indian HSN code mapping the visible asset category.
- MEESHO: Maximize mobile optimization. Keep titles strictly under 100 characters. Target highly relevant, low-cost vernacular search phrases used by budget shoppers (e.g., 'anti-tarnish minimal jewelry').
- MYNTRA: Highly descriptive and elegant fashion titles, strictly under 100 characters. Focus on brand identity, lifestyle value, premium material aesthetics, styling tips, and exact design attributes.

Your total response output must be delivered in a single, clean, valid JSON format matching this structural schema exactly. Do not embed any markdown code formatting delimiters (\`\`\`json):
{
  "[platform_name_key]": {
    "seoScore": { "overall": 85, "title": 82, "description": 78, "keywords": 88 },
    "title": "String",
    "bullets": ["Array strings"],
    "description": "String paragraph",
    "keywords": ["Array tags"],
    "attributes": { "material": "string", "plating": "string", "stoneType": "string", "occasion": "string", "netQuantity": "string" },
    "taxAndPricing": { "suggestedPrice": "₹X-₹Y", "competitivePrice": "₹A-₹B", "marginNote": "string text", "hsnCode": "4-digit string", "category": "string" }
  }
}

Use exact keys: "Amazon India", "Flipkart", "Meesho", "Myntra" depending on which ones are selected. Only return JSON.`;

  console.log(`[Gemini Catalog Service] Querying Gemini 2.5 Flash for platforms: ${platformsList.join(', ')}...`);

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: partsArray }],
      systemInstruction: { parts: [{ text: systemInstruction }] },
      generationConfig: { responseMimeType: "application/json" }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Gemini Catalog Service] HTTP Error ${response.status}:`, errorText);
    throw new Error(`Google Gemini API Catalog Error: ${errorText}`);
  }

  const responseData = await response.json();
  const rawText = responseData.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error("Empty response from Gemini catalog compiler.");

  try {
    return JSON.parse(rawText.trim());
  } catch (err) {
    console.error(`[Gemini Catalog Service] JSON Parsing failed. Raw response:`, rawText);
    throw new Error("Gemini returned invalid catalog JSON format.");
  }
};


/**
 * ==========================================================================
 * GRANULAR NODE REFRESH WRAPPER OPERATIONS
 * ==========================================================================
 */
const refreshListingNode = async (platform, nodeType, currentDetails) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY' || apiKey.trim() === '') {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  let promptText = `Acting as an expert e-commerce SEO listing editor, regenerate ONLY the requested data point for target platform "${platform}".\n\n`;
  promptText += `CURRENT DETAILS:\n`;
  promptText += `Title: ${currentDetails.title || 'None'}\n`;
  promptText += `Description: ${currentDetails.description || 'None'}\n`;
  promptText += `Keywords: ${Array.isArray(currentDetails.keywords) ? currentDetails.keywords.join(', ') : 'None'}\n\n`;

  let systemInstruction = '';
  
  if (nodeType === 'title') {
    promptText += `Regenerate a brand-new high-CTR indexable title.`;
    systemInstruction = `Regenerate ONLY a new high-converting listing title for "${platform}". 
Constraints: Under 125 characters for Amazon India, 50-100 characters for Flipkart/Meesho/Myntra. 
Must return exactly this JSON format. Do not use markdown wrappers:
{ "title": "string" }`;
  } else if (nodeType === 'keywords') {
    promptText += `Regenerate exactly 15 high-volume search term keywords tags.`;
    systemInstruction = `Regenerate exactly 15 highly relevant search term keyword tags for "${platform}". 
Must return exactly this JSON format. Do not use markdown wrappers:
{ "keywords": ["string", "string", ...] }`;
  } else if (nodeType === 'taxAndPricing') {
    promptText += `Re-calculate the tax, pricing, HSN codes, and margins.`;
    systemInstruction = `Re-calculate suggested price ranges, competitive price points, category mappings, HSN, and margin notes for "${platform}".
Must return exactly this JSON format. Do not use markdown wrappers:
{ "taxAndPricing": { "suggestedPrice": "₹X-₹Y", "competitivePrice": "₹A-₹B", "marginNote": "string text", "hsnCode": "4-digit string", "category": "string" } }`;
  } else {
    throw new Error("Unsupported isolated node refresh type.");
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: promptText }] }],
      systemInstruction: { parts: [{ text: systemInstruction }] },
      generationConfig: { responseMimeType: "application/json" }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Isolated Node Refresh Error: ${errText}`);
  }

  const responseData = await response.json();
  const rawText = responseData.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error("Empty response from isolated node refresh.");

  return JSON.parse(rawText.trim());
};

module.exports = {
  generateSeoData,
  generateCatalogData,
  refreshListingNode
};
