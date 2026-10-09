export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST 요청만 허용' });

  const { sharedText, pText } = req.body;
  const SECRET_AI_KEY = process.env.GEMINI_API_KEY; 

  if (!SECRET_AI_KEY) return res.status(500).json({ error: 'Vercel에 API 키가 없습니다.' });

  const urlMatch = sharedText.match(/(https?:\/\/[^\s]+)/);
  let scrapedTitle = "상품명 파악 불가";
  
  if (urlMatch) {
    try {
      const htmlResponse = await fetch(urlMatch[0], {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      if (htmlResponse.ok) {
        const htmlText = await htmlResponse.text();
        const titleMatch = htmlText.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"/i) || htmlText.match(/<title>([^<]*)<\/title>/i);
        if (titleMatch && titleMatch[1]) scrapedTitle = titleMatch[1].replace(/&amp;/g, '&').trim();
      }
    } catch (e) {}
  }

  const prompt = `쇼핑 할인 요약 AI. 
  텍스트: "${sharedText}"
  상품명: "${scrapedTitle}"
  조건: [${pText}]
  일반 혜택은 제외하고 숨은 할인 요령과 결제 주의점만 분석해.
  반드시 아래 JSON 형식으로만 대답해:
  {"tips": ["요령1", "요령2"], "caution": "주의점"}`;

  // 💡 수정 완료: 현재(2026년) 정상 작동하는 3.8 Flash 모델로 복구!
  const apiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${SECRET_AI_KEY}`;

  try {
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 200, temperature: 0.2, responseMimeType: "application/json" } 
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || "구글 API 거절" });
    }
    
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: "서버 내부 통신 에러" });
  }
}
