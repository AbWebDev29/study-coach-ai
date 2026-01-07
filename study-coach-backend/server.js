// server.js
require('dotenv').config();


const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const axios = require('axios');
const upload = multer({ storage: multer.memoryStorage() });

const app = express();

app.post('/api/analyze-pdf', upload.single('pdf'), async (req, res) => {
  const fileBuffer = req.file.buffer;   // 👈 use buffer, not path
  // send fileBuffer to Azure Doc Intelligence here
});
module.exports = app;
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// cache last analyzed course for chat
let lastCourseContext = null;

// ---------- Upload setup ----------
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
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

// ---------- Helper: call Azure OpenAI ----------
async function generatePlanWithOpenAI(syllabusText) {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-06-01';

  if (!endpoint || !apiKey || !deployment) {
    throw new Error('Azure OpenAI endpoint/key/deployment not configured');
  }

  // Keep prompt size safe
  const maxChars = 8000;
  const trimmed = (syllabusText || '').slice(0, maxChars);

  const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

  const systemPrompt =
    'You are StudyCoach AI for a university student. ' +
    'You receive a course syllabus (possibly messy text) and must design a focused 7-day exam preparation plan. ' +
    'Use ONLY the topics that appear in the syllabus.';

  const userPrompt =
    'Here is a course syllabus:\n\n' +
    trimmed +
    '\n\n' +
    'Tasks:\n' +
    '1) Identify 7 key topic groups/units from this syllabus (combine related subtopics).\n' +
    '2) Create a 7-day exam prep schedule where each day focuses on one or two of those topic groups.\n' +
    '3) For each day, output exactly one line in the format:\n' +
    '   Day X: <topics> – <short actionable study plan>\n' +
    '4) Do not add any extra explanation before or after the 7 lines.';

  const body = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.4,
    max_tokens: 500,
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

    let studyPlan;
    if (syllabusText.trim().length > 0) {
      studyPlan = await generatePlanWithOpenAI(syllabusText);
    } else {
      studyPlan =
        'Could not read text from this PDF, so a 7-day plan could not be generated.';
    }

    // cache for chat
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

// ---------- Chat route ----------
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

    // Day‑specific questions: map to line from LLM plan
    const dayMatch = q.match(/day\s*([1-7])/);
    if (dayMatch) {
      const day = parseInt(dayMatch[1], 10);
      const lines = studyPlan.split('\n').filter(l =>
        l.toLowerCase().startsWith('day ')
      );
      const line =
        lines.find(l => l.toLowerCase().startsWith(`day ${day}`)) ||
        lines[day - 1];

      return res.json({
        success: true,
        answer:
          (line || `No specific plan found for Day ${day}.`) +
          '\n\nTip: After this day, solve PYQs and log your mistakes.',
      });
    }

    // Generic syllabus-aware guidance
    const lowerSyl = syllabusText.toLowerCase();
    const words = q.split(/\s+/).filter(w => w.length > 4);
    const mentioned = words.filter(w => lowerSyl.includes(w));

    if (mentioned.length) {
      return res.json({
        success: true,
        answer:
          `Your question seems related to: ${mentioned.join(', ')} from your syllabus.\n` +
          'Use the 7-day plan to find which day covers these topics, revise notes that day, and solve 5–10 questions.',
      });
    }

    return res.json({
      success: true,
      answer:
        'Use your 7-day plan as the main guide. You can ask things like "What is planned on Day 3?" or "How should I revise important topics?" for more targeted tips.',
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
