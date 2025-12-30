require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const FormData = require('form-data');
const fetch = require('node-fetch');
const OpenAI = require('openai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Create uploads folder
const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// Multer for PDF
const upload = multer({ dest: uploadDir });

// OpenAI Client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_KEY,
  baseURL: process.env.OPENAI_ENDPOINT,
  defaultQuery: { 'api-version': '2024-10-21-preview' }
});

// ROOT - Test server
app.get('/', (req, res) => {
  res.json({ 
    message: "Study Coach Backend LIVE! 🚀", 
    endpoints: ["/api/chat", "/api/analyze-pdf"],
    status: "success"
  });
});

// CHAT TEST
app.get('/api/chat', (req, res) => {
  res.json({ 
    message: "PDF Backend LIVE! Ready for syllabus analysis 🚀", 
    status: "success",
    docIntel: process.env.DOC_INTELLIGENCE_ENDPOINT ? "✅ READY" : "❌ Missing"
  });
});

// PDF Analysis
app.post('/api/analyze-pdf', upload.single('pdf'), async (req, res) => {
  try {
    console.log('📄 PDF received:', req.file.originalname);
    
    // Document Intelligence REST API
    const formData = new FormData();
    formData.append('file', fs.createReadStream(req.file.path));
    
    const analyzeResponse = await fetch(
      `${process.env.DOC_INTELLIGENCE_ENDPOINT}/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=2024-07-31-preview`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': process.env.DOC_INTELLIGENCE_KEY
        },
        body: formData
      }
    );
    
    const analyzeResult = await analyzeResponse.json();
    const operationLocation = analyzeResponse.headers.get('operation-location');
    
    // Poll for results
    let result;
    while (true) {
      const pollResponse = await fetch(operationLocation, {
        headers: {
          'Ocp-Apim-Subscription-Key': process.env.DOC_INTELLIGENCE_KEY
        }
      });
      result = await pollResponse.json();
      
      if (result.status === 'succeeded') break;
      if (result.status === 'failed') throw new Error('Document analysis failed');
      
      await new Promise(r => setTimeout(r, 1000));
    }
    
    // Extract text
    let syllabusText = '';
    if (result.analyzeResult?.pages) {
      for (const page of result.analyzeResult.pages) {
        if (page.lines) {
          for (const line of page.lines) {
            syllabusText += line.content + '\n';
          }
        }
      }
    }
    
    // AI Study Plan
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_DEPLOYMENT,
      messages: [{
        role: "user",
        content: `Create DETAILED 7-day study plan from this syllabus:

${syllabusText.substring(0, 8000)}

Include: Daily goals, resources, practice problems, time estimates.`
      }],
      max_tokens: 2000
    });
    
    // Cleanup
    fs.unlinkSync(req.file.path);
    
    res.json({
      success: true,
      syllabusPreview: syllabusText.substring(0, 800) + '...',
      studyPlan: completion.choices[0].message.content,
      pages: result.analyzeResult?.pages?.length || 0
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Backend: http://localhost:${PORT}`);
  console.log(`📄 Test: http://localhost:${PORT}/api/chat`);
});