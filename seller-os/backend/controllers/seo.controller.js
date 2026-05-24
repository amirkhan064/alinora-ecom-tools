/**
 * seo.controller.js
 * Controller handling e-commerce listing SEO optimization requests.
 */

const geminiSeoService = require('../services/gemini-seo.service');

const generateSeo = async (req, res) => {
  try {
    // Handle either files list (multer upload.any()) or single file (multer upload.single())
    const file = req.files?.[0] || req.file;
    if (!file) {
      return res.status(400).json({ error: "Missing product image file. Please upload an image." });
    }

    const { platform, additionalContext } = req.body;
    if (!platform) {
      return res.status(400).json({ error: "Missing target marketplace platform designation." });
    }

    console.log(`[SEO Controller] Received generate request. File: ${file.originalname}, Size: ${file.size} bytes, Platform: ${platform}`);

    // Call service to resolve SEO fields
    const seoData = await geminiSeoService.generateSeoData(
      file.buffer,
      file.mimetype,
      platform,
      additionalContext
    );

    return res.status(200).json(seoData);
  } catch (error) {
    console.error("[SEO Controller] Generation Error:", error.message);
    return res.status(500).json({ 
      error: error.message || "Failed to compile product listing SEO details." 
    });
  }
};

module.exports = {
  generateSeo
};
