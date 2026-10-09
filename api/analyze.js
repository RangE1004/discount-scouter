export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });

  const { sharedText, pText } = req.body;
  const SECRET_AI_KEY = process.env.GEMINI_API_KEY; 

  if (!SECRET_AI_KEY) return res.status(500).json({ error: '서버에 API 키가 없습니다.' });

  const urlMatch = sharedText.match(/(https?:\/\/[^\s]+)/);
  let scrapedTitle = "상품명 파악 불가";
  
  if (urlMatch) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 쿠팡 3초 컷
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
      console.log("크롤링 타임아웃 통과"); 
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // 💡 프롬프트 통제 강화: 마크다운 절대 금지령 추가
  const prompt = `쇼핑 할인 요약 AI. 텍스트: "${sharedText}", 상품명: "${scrapedTitle}", 조건: [${pText}]
  일반 혜택은 제외하고 숨은 할인 요령과 결제 주의점만 분석해.
  [규칙] 반드시 마크다운(\`\`\`json 등) 없이 순수한 JSON 객체로만 응답해.
  [형식] {"tips": ["요령1", "요령2"], "caution": "주의점"}`;

  const apiEndpoint = `[https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=$](https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=$){SECRET_AI_KEY}`;

  try {
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: prompt }] }],
        // 💡 핵심 수정: 답변이 끊겨서 JSON이 깨지지 않도록 토큰을 800으로 넉넉히 상향
        generationConfig: { maxOutputTokens: 800, temperature: 0.2, responseMimeType: "application/json" } 
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || "구글 통신 실패" });
    
    if (!data.candidates || data.candidates.length === 0 || !data.candidates[0].content.parts[0].text) {
      return res.status(500).json({ error: "AI가 빈 답변을 보냈습니다." });
    }

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: "서버 내부 통신 에러가 발생했습니다." });
  }
}
