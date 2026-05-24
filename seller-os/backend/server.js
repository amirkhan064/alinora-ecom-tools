const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

// Synchronously load env configurations from .env
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    envConfig.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.substring(0, eqIdx).trim();
          const value = trimmed.substring(eqIdx + 1).trim();
          process.env[key] = value;
        }
      }
    });
    console.log(`[Env Loader] Loaded variables successfully from ${envPath}`);
  } else {
    console.log(`[Env Loader] No local .env file found. Using existing system environments.`);
  }
} catch (e) {
  console.error(`[Env Loader] Critical failure parsing env file:`, e.message);
}

const imageController = require('./controllers/imageController');
const labelController = require('./controllers/label.controller');
const seoController = require('./controllers/seo.controller');
const catalogController = require('./controllers/catalog.controller');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

const app = express();
const PORT = process.env.PORT || 3333;

// Enable CORS for our Angular application on port 4200
app.use(cors({
  origin: ['http://localhost:4200', 'http://127.0.0.1:4200'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

// Logger middleware
app.use(morgan('dev'));

// Body parsing
app.use(express.json());

// Routes
app.post('/api/fetch-images', imageController.fetchImages);
app.get('/api/proxy-image', imageController.proxyImage);
app.post('/api/labels/process', upload.any(), labelController.processLabels);
app.post('/api/process-pdf', upload.any(), labelController.processLabels);
app.post('/api/seo/generate', upload.any(), seoController.generateSeo);
app.post('/api/catalog/build', upload.any(), catalogController.buildCatalog);
app.post('/api/catalog/refresh-node', catalogController.refreshCatalogNode);

// Asynchronous Business Lead Retention Capture Ledger Endpoint
app.post('/api/lead/capture', (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: "Invalid email address syntax." });
    }

    console.log(`[Lead Capture API] Enrolling new business subscriber: ${email}`);
    
    const leadsPath = path.join(__dirname, 'leads.json');
    let leads = [];
    if (fs.existsSync(leadsPath)) {
      try {
        const rawData = fs.readFileSync(leadsPath, 'utf8');
        leads = JSON.parse(rawData);
      } catch (err) {
        console.error("[Lead Capture API] Failed reading leads.json:", err.message);
      }
    }
    
    leads.push({
      email,
      timestamp: new Date().toISOString()
    });
    
    fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2), 'utf8');
    return res.status(200).json({ success: true, message: "Lead registered successfully." });

  } catch (error) {
    console.error("[Lead Capture API] Exception recording lead:", error.message);
    return res.status(500).json({ error: "Failed to persist subscriber lead data." });
  }
});

// Root health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: "OK", platform: "SellerOS Image Downloader Backend" });
});

// Start listening
app.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`🚀 SellerOS Image Downloader Backend running`);
  console.log(`🔗 Local Address: http://localhost:${PORT}`);
  console.log(`=========================================`);
});
