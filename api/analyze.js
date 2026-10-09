export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });

  const { sharedText, pText } = req.body;
  const SECRET_AI_KEY = process.env.GEMINI_API_KEY; 

  if (!SECRET_AI_KEY) return res.status(500).json({ error: '서버에 API 키가 없습니다.' });

  const urlMatch = sharedText.match(/(https?:\/\/[^\s]+)/);
  let scrapedTitle = "상품명 파악 불가";
  
  if (urlMatch) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); 
    try {
      const htmlResponse = await fetch(urlMatch[0], { 
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: controller.signal
      });
      if (htmlResponse.ok) {
        const htmlText = await htmlResponse.text();
        const titleMatch = htmlText.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"/i) || htmlText.match(/<title>([^<]*)<\/title>/i);
        if (titleMatch && titleMatch[1]) scrapedTitle = titleMatch[1].replace(/&amp;/g, '&').trim();
      }
    } catch (e) {
      console.log("크롤링 패스"); 
    } finally {
      clearTimeout(timeoutId);
    }
  }

  const prompt = `쇼핑 할인 요약 AI. 텍스트: "${sharedText}", 상품명: "${scrapedTitle}", 조건: [${pText}]
  일반 혜택은 제외하고 숨은 할인 요령과 결제 주의점만 분석해.
  [규칙] 반드시 마크다운(\`\`\`json 등) 없이 순수한 JSON 객체로만 응답해.
  [형식] {"tips": ["요령1", "요령2"], "caution": "주의점"}`;

  const apiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${SECRET_AI_KEY}`;

  try {
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 800, temperature: 0.2, responseMimeType: "application/json" } 
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || `구글 통신 실패 (${response.status})` });
    }
    
    // 💡 방어 로직 1: 구글이 빈 껍데기만 보냈을 때 뻗음 방지
    const candidate = data.candidates && data.candidates[0];
    if (!candidate) {
      return res.status(500).json({ error: "구글 AI가 응답 데이터를 생성하지 않았습니다." });
    }
    
    // 💡 방어 로직 2: 안전 필터(Safety) 등으로 답변 텍스트(content)가 누락되었을 때 뻗음 방지
    if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
      return res.status(500).json({ error: `AI 답변 차단됨 (원인: ${candidate.finishReason || '알 수 없음'})` });
    }

    res.status(200).json(data);
  } catch (error) {
    // 💡 방어 로직 3: 뭉뚱그린 에러 폐기. 서버가 뻗으면 무조건 자바스크립트 실제 에러 로그를 폰으로 직배송
    res.status(500).json({ error: `서버 오류 상세: ${error.message}` });
  }
}
