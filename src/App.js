import React, { useState } from 'react';
import './App.css';

const BACKEND_URL = 'https://study-coach-ai-backend.vercel.app';

function App() {
  const [analyzing, setAnalyzing] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [userInput, setUserInput] = useState('');
  const [result, setResult] = useState(null);

  const handleSendMessage = async () => {
  if (!userInput.trim()) return;

  const newMessages = [...chatMessages, { role: 'user', content: userInput }];
  setChatMessages(newMessages);
  const question = userInput;
  setUserInput('');
  fetch(`${BACKEND_URL}/api/analyze-pdf`, { method: 'POST', body: formData });
 
  try {
    const res = await fetch(`${BACKEND_URL}/api/chat-course`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });

    const data = await res.json();
    const answer = data.answer || 'No answer generated.';

    setChatMessages([
      ...newMessages,
      { role: 'assistant', content: answer },
    ]);
  } catch (err) {
    setChatMessages([
      ...newMessages,
      { role: 'assistant', content: `Error in chat: ${err.message}` },
    ]);
  }
};


  // ✅ NEW: Azure‑powered PDF upload
  const handlePdfUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setAnalyzing(true);
    setResult(null);
    setChatMessages([]);

    const formData = new FormData();
    formData.append('pdf', file);

    try {
      const res = await fetch(`${BACKEND_URL}/api/analyze-pdf`, {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!data.success) throw new Error(data.error || 'Analysis failed');

      // Build message from Azure result
      setResult({
        pages: data.pages,
        syllabusPreview: data.syllabusPreview,
        studyPlan: data.studyPlan,
        filename: file.name,
      });

      setChatMessages([
        {
          role: 'assistant',
          content:
            `✅ **Azure PDF ANALYSIS COMPLETE** (${data.pages} pages)\n\n` +
            `📄 **File:** ${file.name}\n\n` +
            `📖 **Syllabus preview:**\n${data.syllabusPreview}\n\n` +
            `📅 **7‑DAY STUDY PLAN (from Azure OpenAI):**\n${data.studyPlan}`,
        },
      ]);
    } catch (err) {
      setChatMessages([
        {
          role: 'assistant',
          content: `❌ Error analyzing PDF: ${err.message}`,
        },
      ]);
    } finally {
      setAnalyzing(false);
    }
  };

  const clearChat = () => {
    setChatMessages([]);
    setResult(null);
    setUserInput('');
  };

  const sharePlan = () => {
    const planText = chatMessages[chatMessages.length-1]?.content || 'VIT StudyCoach AI Plan';
    const shareUrl = `https://studycoach-ai.vercel.app/?plan=${encodeURIComponent(planText.substring(0,100))}`;
    navigator.clipboard.writeText(shareUrl);
    alert('📱 Study plan link copied!\n\n' + shareUrl);
  };

  return (
    <div className="App">
      <header className="App-header">
        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          <h1 style={{ color: '#00bc77', margin: 0, fontSize: '3em' }}>
            📚 StudyCoach AI
          </h1>
          <p style={{ color: '#ccc', fontSize: '1.2em' }}>
            VIT BTech CS | Smart PDF → 7-Day Plans
          </p>
        </div>

        {/* VIT Quick Start Buttons */}
        <div style={{ marginBottom: '30px', textAlign: 'center' }}>
          <h3 style={{ color: '#fff', marginBottom: '15px' }}>🎓 VIT Semester Quick Plans:</h3>
          
          <button 
            onClick={() => {
              setChatMessages([]);
              setTimeout(() => {
                setChatMessages([{role: 'assistant', content: '🧑‍💻 **DSA 7-DAY PLAN** (CS3201):\n\n**Day 1:** Arrays + Strings\n**Day 2:** Linked Lists + Stacks\n**Day 3:** Trees + BFS/DFS\n**Day 4:** Graphs + Dijkstra\n**Day 5:** Sorting + Searching\n**Day 6:** DP + Greedy\n**Day 7:** Mock Test\n\n**Resources:** GFG + LeetCode'}]);
              }, 100);
            }}
            style={{margin: '5px', padding: '12px 20px', background: '#0078d4', color: 'white', border: 'none', borderRadius: '25px', fontSize: '16px', cursor: 'pointer'}}
          >
            Data Structures
          </button>
          
          <button 
            onClick={() => {
              setChatMessages([]);
              setTimeout(() => {
                setChatMessages([{role: 'assistant', content: '💾 **OS 7-DAY PLAN** (CS3202):\n\n**Day 1:** Processes + Threads\n**Day 2:** CPU Scheduling\n**Day 3:** Deadlock\n**Day 4:** Memory Management\n**Day 5:** Virtual Memory\n**Day 6:** File Systems\n**Day 7:** Practice\n\n**Resources:** Galvin + GFG'}]);
              }, 100);
            }}
            style={{margin: '5px', padding: '12px 20px', background: '#00bc77', color: 'white', border: 'none', borderRadius: '25px', fontSize: '16px', cursor: 'pointer'}}
          >
            Operating Systems
          </button>
          
          <button 
            onClick={() => {
              setChatMessages([]);
              setTimeout(() => {
                setChatMessages([{role: 'assistant', content: '🌐 **CN 7-DAY PLAN** (CS3203):\n\n**Day 1:** OSI Model\n**Day 2:** IP Addressing\n**Day 3:** TCP/UDP\n**Day 4:** Routing\n**Day 5:** Application Layer\n**Day 6:** Wireshark\n**Day 7:** NS3\n\n**Resources:** Kurose + GFG'}]);
              }, 100);
            }}
            style={{margin: '5px', padding: '12px 20px', background: '#ffc000', color: 'black', border: 'none', borderRadius: '25px', fontSize: '16px', cursor: 'pointer'}}
          >
            Computer Networks
          </button>
        </div>

        {/* PDF Upload */}
        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          <input
            type="file"
            accept="application/pdf"
            onChange={handlePdfUpload}
            disabled={analyzing}
            style={{ display: 'none' }}
            id="pdf-upload"
          />
          <label htmlFor="pdf-upload" style={{
            display: 'inline-block',
            padding: '15px 40px',
            background: analyzing ? '#666' : '#0078d4',
            color: 'white',
            borderRadius: '50px',
            cursor: analyzing ? 'not-allowed' : 'pointer',
            fontSize: '18px',
            fontWeight: 'bold'
          }}>
            {analyzing ? '🔄 AI Building 7-Day Plan...' : '📄 Upload ANY Syllabus PDF'}
          </label>
        </div>

        {/* Chat Input + Controls */}
        <div style={{ marginBottom: '20px', textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', maxWidth: '700px', margin: '0 auto', flexWrap: 'wrap' }}>
            <input 
              type="text" 
              placeholder="Ask about your study plan... (Day 3? Deadlock?)" 
              value={userInput}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && userInput.trim()) handleSendMessage();
              }}
              onChange={(e) => setUserInput(e.target.value)}
              style={{ 
                flex: 1, minWidth: '250px', padding: '15px', borderRadius: '25px', 
                border: '2px solid #0078d4', outline: 'none', fontSize: '16px',
                background: '#fff'
              }}
            />
            <button 
              onClick={handleSendMessage}
              disabled={!userInput.trim()}
              style={{
                padding: '15px 25px', background: '#0078d4', color: 'white',
                border: 'none', borderRadius: '25px', fontSize: '16px', cursor: 'pointer',
                opacity: userInput.trim() ? 1 : 0.5, minWidth: '80px'
              }}
            >
              Send
            </button>
            <button 
              onClick={clearChat}
              style={{
                padding: '15px 15px', background: '#ff4444', color: 'white',
                border: 'none', borderRadius: '25px', fontSize: '16px', cursor: 'pointer',
                minWidth: '80px'
              }}
            >
              🗑️ Clear
            </button>
            <button 
              onClick={sharePlan}
              style={{
                padding: '15px 15px', background: '#00bc77', color: 'white',
                border: 'none', borderRadius: '25px', fontSize: '16px', cursor: 'pointer',
                minWidth: '80px'
              }}
              disabled={!chatMessages.length}
            >
              📤 Share
            </button>
          </div>
        </div>

        {/* Chat Display */}
        <div style={{ 
          maxHeight: '400px', overflowY: 'auto', 
          background: 'rgba(255,255,255,0.05)', padding: '25px', borderRadius: '20px'
        }}>
          {result && (
  <div className="result-card">
    <p><strong>✅ Azure PDF ANALYSIS COMPLETE</strong> ({result.pages} pages)</p>
    <p><strong>📄 File:</strong> {result.filename}</p>

    <p><strong>📖 Syllabus preview:</strong></p>
<p>{result.syllabusPreview}</p>


    <p><strong>📅 7-DAY STUDY PLAN (from Azure OpenAI):</strong></p>
    <p>{result.studyPlan || 'Ask in the chat box above to get a day‑wise plan.'}</p>
  </div>
)}

          
          {chatMessages.map((msg, idx) => (
            <div key={idx} style={{
              marginBottom: '20px',
              textAlign: msg.role === 'user' ? 'right' : 'left'
            }}>
              <div style={{
                display: 'inline-block', padding: '15px 20px',
                background: msg.role === 'user' ? '#0078d4' : 'rgba(64,68,77,0.8)',
                borderRadius: '25px', maxWidth: '85%'
              }}>
                <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6', color: 'white' }}>
                  {msg.content}
                </div>
              </div>
            </div>
          ))}
          
          {analyzing && (
            <div style={{ textAlign: 'center', color: '#00bc77' }}>
              <div style={{ fontSize: '24px', marginBottom: '10px' }}>🔄</div>
              <p>AI reading PDF → Extracting syllabus → Building COMPLETE 7-day plan...</p>
            </div>
          )}
        </div>

        <div style={{ marginTop: '30px', textAlign: 'center', fontSize: '12px', color: '#888' }}>
          <p>⚡ VIT BTech CS | Imagine Cup 2025 | DAY 6 Azure Backend LIVE! 🚀</p>
        </div>
      </header>
    </div>
  );
}

export default App;
