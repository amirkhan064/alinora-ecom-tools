const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

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

// Configure secure SMTP Mail Transporter (Runs AFTER environment variables are loaded)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true', // true for 465, false for 587
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

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
app.post('/api/labels/scan', upload.any(), labelController.scanLabels);
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

// In-Memory User Feedback Capture Ledger Endpoint
app.post('/api/feedback/submit', (req, res) => {
  try {
    const { category, message, email } = req.body;
    if (!message) {
      return res.status(400).json({ error: "Message content is required." });
    }

    console.log(`[Feedback API] New ${category} logged: "${message.substring(0, 30)}..."`);
    
    const feedbackPath = path.join(__dirname, 'feedback.json');
    let feedbacks = [];
    if (fs.existsSync(feedbackPath)) {
      try {
        const rawData = fs.readFileSync(feedbackPath, 'utf8');
        feedbacks = JSON.parse(rawData);
      } catch (err) {
        console.error("[Feedback API] Failed reading feedback.json:", err.message);
      }
    }
    
    feedbacks.push({
      category: category || 'other',
      message,
      email: email || 'anonymous',
      timestamp: new Date().toISOString()
    });
    
    fs.writeFileSync(feedbackPath, JSON.stringify(feedbacks, null, 2), 'utf8');

    // Compile premium, styled HTML mail layout
    const mailOptions = {
      from: `"SellerOS Workspace Feedback" <${process.env.SMTP_USER || 'no-reply@selleros.in'}>`,
      to: 'amir.khan064@gmail.com, zeenatamir8811@gmail.com',
      subject: `[SellerOS Feedback] ${category.toUpperCase()}: ${message.substring(0, 40)}...`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; color: #1a202c; background-color: #ffffff;">
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 20px;">
            <span style="font-size: 24px; color: #4f46e5; font-weight: bold;">SellerOS</span>
            <span style="background-color: #4f46e50f; color: #4f46e5; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 20px; text-transform: uppercase;">Workspace Feedback</span>
          </div>
          <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 16px 0;">
          <p style="margin: 0 0 10px;"><strong>Feedback Category:</strong> <span style="background-color: #f3f4f6; color: #374151; padding: 3px 8px; border-radius: 6px; font-weight: 700; text-transform: capitalize;">${category}</span></p>
          <p style="margin: 0 0 10px;"><strong>Message Detail:</strong></p>
          <div style="background-color: #f9fafb; border-left: 4px solid #4f46e5; padding: 16px; font-size: 14px; line-height: 1.6; color: #1f2937; margin: 12px 0; border-radius: 6px; white-space: pre-wrap;">${message}</div>
          <p style="margin: 0 0 10px;"><strong>Sender Email:</strong> <a href="mailto:${email || 'anonymous'}" style="color: #4f46e5; text-decoration: none; font-weight: 600;">${email || 'Anonymous (Not Logged In)'}</a></p>
          <p style="margin: 0 0 20px;"><strong>Submission Timestamp:</strong> ${new Date().toLocaleString()}</p>
          <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 16px 0;">
          <p style="font-size: 11px; color: #9ca3af; text-align: center; margin: 0;">This is a live transactional email sent automatically from your local SellerOS express server instance.</p>
        </div>
      `
    };

    // Check if SMTP credentials exist inside backend configuration
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      transporter.sendMail(mailOptions, (err, info) => {
        if (err) {
          console.error('[Feedback Email System] Failed sending mail alert:', err.message);
        } else {
          console.log('[Feedback Email System] Mail alert dispatched to amir.khan064@gmail.com and zeenatamir8811@gmail.com!');
        }
      });
    } else {
      console.log('[Feedback Email System] SMTP credentials not set inside seller-os/backend/.env file. Skipping email dispatch (logged to local leads database instead).');
    }

    return res.status(200).json({ success: true, message: "Feedback submitted successfully." });

  } catch (error) {
    console.error("[Feedback API] Exception recording feedback:", error.message);
    return res.status(500).json({ error: "Failed to log feedback." });
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
