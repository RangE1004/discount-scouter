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

  // 💡 핵심 변경: AI 프롬프트(명령어) 고도화 및 글자 짤림 방지
  const prompt = `쇼핑 할인 요약 AI. 텍스트: "${sharedText}", 상품명: "${scrapedTitle}", 조건: [${pText}]
  [요청] 일반 혜택은 제외하고, 숨은 할인 요령(할인율 % 및 구체적인 금액 강조)과 결제 주의점만 분석해.
  [규칙 1] 마크다운(\`\`\`json 등) 없이 순수한 JSON 객체로 응답해.
  [규칙 2] 데이터가 중간에 끊기지 않도록 문장을 간결하게 압축해. (최대 300자 이내)
  [형식] {"tips": ["할인율 5% 적용 요령", "요령2"], "caution": "주의점 짧게 요약"}`;

  const apiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${SECRET_AI_KEY}`;

  try {
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: prompt }] }],
        // 💡 짤림 방지 2차 대책: 토큰을 800으로 넉넉히 상향
        generationConfig: { maxOutputTokens: 800, temperature: 0.2, responseMimeType: "application/json" } 
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || `구글 통신 실패 (${response.status})` });
    }
    
    const candidate = data.candidates && data.candidates[0];
    if (!candidate) {
      return res.status(500).json({ error: "구글 AI가 응답 데이터를 생성하지 않았습니다." });
    }
    if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
      return res.status(500).json({ error: `AI 답변 차단됨 (원인: ${candidate.finishReason || '알 수 없음'})` });
    }

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: `서버 오류 상세: ${error.message}` });
  }
}
