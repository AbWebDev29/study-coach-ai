// server.js

require('dotenv').config();


const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const axios = require('axios');


const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));


// ---------- Upload setup ----------
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const upload = multer({ dest: uploadDir });


// ---------- Health route ----------
app.get('/api/chat', (req, res) => {
  res.json({
    message: 'Backend LIVE · Azure Document Intelligence mode.',
    status: 'success',
    docIntelPlanned: true,
  });
});


// ---------- Helper: Azure Document Intelligence ----------
async function extractWithAzure(buffer) {
  const endpoint = process.env.DOC_INTELLIGENCE_ENDPOINT;
  const key = process.env.DOC_INTELLIGENCE_KEY;
  const modelId = process.env.DOC_INTELLIGENCE_MODEL || 'prebuilt-layout';


  if (!endpoint || !key) {
    throw new Error('Azure Document Intelligence endpoint/key not configured');
  }


  const startUrl =
    `${endpoint}/formrecognizer/documentModels/${modelId}:analyze?api-version=2023-07-31`;


  const startRes = await axios.post(startUrl, buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Ocp-Apim-Subscription-Key': key,
    },
    validateStatus: () => true,
  });


  if (startRes.status !== 202) {
    const msg = startRes.data?.error?.message || 'Unknown Azure start error';
    throw new Error(`Azure analyze start failed (${startRes.status}): ${msg}`);
  }


  const operationLocation = startRes.headers['operation-location'];
  if (!operationLocation) {
    throw new Error('Missing operation-location header from Azure');
  }


  // Poll until completed
  while (true) {
    await new Promise((r) => setTimeout(r, 2000));


    const pollRes = await axios.get(operationLocation, {
      headers: { 'Ocp-Apim-Subscription-Key': key },
      validateStatus: () => true,
    });


    if (pollRes.status !== 200) {
      const msg = pollRes.data?.error?.message || 'Unknown Azure poll error';
      throw new Error(`Azure analyze poll failed (${pollRes.status}): ${msg}`);
    }


    const status = pollRes.data.status;
    if (status === 'succeeded') {
      const analyzeResult = pollRes.data.analyzeResult || {};
      const pages = analyzeResult.pages?.length || 1;
      const text = analyzeResult.content || '';
      return { pages, text };
    }


    if (status === 'failed') {
      const msg = pollRes.data.error?.message || 'Azure analysis failed';
      throw new Error(msg);
    }


    // otherwise status is 'notStarted' or 'running' → loop again
  }
}


// ---------- PDF analysis route ----------
app.post('/api/analyze-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No PDF uploaded' });
    }


    console.log('📄 PDF received:', req.file.originalname);


    const filePath = req.file.path;
    const dataBuffer = fs.readFileSync(filePath);


    const { pages, text } = await extractWithAzure(dataBuffer);
    const syllabusText = text || '';
    const syllabusPreview =
      syllabusText.slice(0, 800) ||
      '[Azure] No readable text found in this PDF (might be scanned/image-only).';


    const studyPlan =
      `Day 1–2: Read first half of syllabus.\n` +
      `Day 3–4: Practice questions from core topics.\n` +
      `Day 5: Revise key formulas / definitions.\n` +
      `Day 6: Previous year questions.\n` +
      `Day 7: Light revision + mock exam.\n\n` +
      `(Azure text length = ${syllabusText.length} characters.)`;


    fs.unlinkSync(filePath);


    return res.json({
      success: true,
      pages,
      filename: req.file.originalname,
      syllabusPreview,
      studyPlan,
      fullTextLength: syllabusText.length,
    });
  } catch (err) {
    console.error('PDF analysis error:', err.message);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    return res.status(500).json({
      success: false,
      error: err.message || 'Internal server error',
    });
  }
});


// ---------- Start server ----------
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend running locally on http://localhost:${PORT}`);
});