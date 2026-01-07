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

let lastCourseContext = null;

// ---------- Upload setup ----------
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const upload = multer({ dest: uploadDir });

// ---------- Health route ----------
app.get('/api/chat', (req, res) => {
  res.json({
    message: 'Backend LIVE · Azure Document Intelligence + OpenAI.',
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

  while (true) {
    await new Promise(r => setTimeout(r, 2000));

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
  }
}

// ---------- Helper: call Azure OpenAI ----------
async function generatePlanWithOpenAI(syllabusText) {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-06-01';

  if (!endpoint || !apiKey || !deployment) {
    throw new Error('Azure OpenAI endpoint/key/deployment not configured');
  }

  // Truncate very long syllabi to keep token usage safe
  const maxChars = 8000;
  const trimmed = syllabusText.slice(0, maxChars);

  const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

  const systemPrompt =
    'You are a study planning assistant for a university student. ' +
    'You receive a course syllabus and must design a focused 7-day exam preparation plan. ' +
    'Use ONLY the topics that appear in the syllabus.';

  const userPrompt =
    'Here is a course syllabus:\n\n' +
    trimmed +
    '\n\n' +
    '1) First, extract 7 key topic groups or units (combine related subtopics).\n' +
    '2) Then create a 7-day study plan. For each day, specify: "Day X: <topics> – <short action plan>".\n' +
    '3) Output ONLY the 7-day plan lines, one per line, no extra explanation.';

  const body = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.4,
    max_tokens: 400,
  };

  const res = await axios.post(url, body, {
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
  });

  const choice = res.data.choices?.[0];
  const content = choice?.message?.content?.trim() || '';
  return content;
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

    // LLM-generated 7-day plan, syllabus-aware
    const studyPlan = syllabusText
      ? await generatePlanWithOpenAI(syllabusText)
      : 'Could not read text from this PDF to generate a plan.';

    lastCourseContext = {
      filename: req.file.originalname,
      pages,
      syllabusText,
      studyPlan,
    };

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

// ---------- Chat route (still syllabus-aware, rule-based) ----------
app.post('/api/chat-course', async (req, res) => {
  try {
    const { question } = req.body;

    if (!lastCourseContext) {
      return res.status(400).json({
        success: false,
        answer: 'Upload a syllabus PDF first so I know your course.',
      });
    }

    const { studyPlan, syllabusText } = lastCourseContext;
    const q = (question || '').toLowerCase();

    // If user asks about a specific day, roughly map it
    const dayMatch = q.match(/day\s*([1-7])/);
    if (dayMatch) {
      const day = dayMatch[1];
      const lines = studyPlan.split('\n').filter(l => l.toLowerCase().includes('day'));
      const line = lines.find(l => l.toLowerCase().startsWith(`day ${day}`)) || lines[day - 1];

      return res.json({
        success: true,
        answer:
          (line || `No specific plan found for Day ${day}.`) +
          '\n\nTip: After finishing this day, solve PYQs and log mistakes.',
      });
    }

    // Generic guidance based on syllabus presence
    const lower = syllabusText.toLowerCase();
    const words = q.split(/\s+/).filter(w => w.length > 4);
    const mentioned = words.filter(w => lower.includes(w));

    if (mentioned.length) {
      return res.json({
        success: true,
        answer:
          `Your question seems related to: ${mentioned.join(', ')} in your syllabus.\n` +
          'Use your 7-day plan to find which day covers these topics, revise notes, and solve 5–10 questions.',
      });
    }

    return res.json({
      success: true,
      answer:
        'Use the 7-day plan as your main guide. You can ask things like "What is planned on Day 3?" or "How to prioritize topics?" for more targeted tips.',
    });
  } catch (err) {
    console.error('Chat-course error:', err.message);
    return res
      .status(500)
      .json({ success: false, answer: 'Internal error in chat-course route.' });
  }
});

// ---------- Start server ----------
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend running locally on http://localhost:${PORT}`);
});
const cors = require('cors');

const allowedOrigins = [
  'https://study-coach-ai-ashy.vercel.app',
  'http://localhost:3000'
];

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: false
}));

