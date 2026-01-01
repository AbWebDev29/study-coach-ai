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

// ---------- File upload setup ----------
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

// ---------- Helper: call Azure Document Intelligence ----------
async function extractTextWithAzure(buffer) {
  const endpoint = process.env.DOC_INTELLIGENCE_ENDPOINT;
  const key = process.env.DOC_INTELLIGENCE_KEY;
  const modelId = process.env.DOC_INTELLIGENCE_MODEL || 'prebuilt-layout';

  if (!endpoint || !key) {
    throw new Error('Azure Document Intelligence endpoint/key not configured');
  }

  // Start analysis
  const startUrl = `${endpoint}/formrecognizer/documentModels/${modelId}:analyze?api-version=2023-07-31`;
  const startRes = await axios.post(startUrl, buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Ocp-Apim-Subscription-Key': key,
    },
    validateStatus: () => true,
  });

  if (startRes.status !== 202) {
    throw new Error(`Azure start analyze failed: ${startRes.status} ${startRes.data?.error?.message || ''}`);
  }

  const operationLocation = startRes.headers['operation-location'];
  if (!operationLocation) {
    throw new Error('Missing operation-location from Azure response');
  }

  // Poll for result
  let result;
  for (;;) {
    await new Promise(r => setTimeout(r, 2000));
    const pollRes = await axios.get(operationLocation, {
      headers: { 'Ocp-Apim-Subscription-Key': key },
      validateStatus: () => true,
    });

    if (pollRes.status !== 200) {
      throw new Error(`Azure poll failed: ${pollRes.status} ${pollRes.data?.error?.message || ''}`);
    }

    if (pollRes.data.status === 'succeeded') {
      result = pollRes.data;
      break;
    }
    if (pollRes.data.status === 'failed') {
      throw new Error(`Azure analysis failed: ${JSON.stringify(pollRes.data.error)}`);
    }
  }

  // Concatenate all lines into plain text and count pages
  const pages = result.analyzeResult?.pages?.length || 1;
  const content = result.analyzeResult?.content || '';

  return { pages, text: content };
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

    // Use Azure to get pages + text
    const { pages, text } = await extractTextWithAzure(dataBuffer);
    const syllabusText = text || '';
    const syllabusPreview = syllabusText.slice(0, 800);

    const studyPlan =
      `Day 1–2: Read first half of syllabus.\n` +
      `Day 3–4: Practice questions from core topics.\n` +
      `Day 5: Revise key formulas / definitions.\n` +
      `Day 6: Previous year papers.\n` +
      `Day 7: Mock test & light revision.\n\n` +
      `(Azure text length = ${syllabusText.length} characters.)`;

    fs.unlinkSync(filePath);

    return res.json({
      success: true,
      pages,
      filename: req.file.originalname,
      syllabusPreview,
      studyPlan,
    });
  } catch (err) {
    console.error('PDF analysis error:', err);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ---------- Start server ----------
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend running locally on http://localhost:${PORT}`);
});
