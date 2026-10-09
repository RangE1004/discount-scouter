export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });

  const { sharedText, pText } = req.body;
  const SECRET_AI_KEY = process.env.GEMINI_API_KEY; 

  if (!SECRET_AI_KEY) return res.status(500).json({ error: '서버에 API 키가 없습니다.' });

  // 1. 크롤링(스니핑) 로직은 그대로 유지 (정확도를 위해)
  const urlMatch = sharedText.match(/(https?:\/\/[^\s]+)/);
  let scrapedTitle = "상품명 파악 불가";
  if (urlMatch) {
    try {
      const htmlResponse = await fetch(urlMatch[0], { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (htmlResponse.ok) {
        const htmlText = await htmlResponse.text();
        const titleMatch = htmlText.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"/i) || htmlText.match(/<title>([^<]*)<\/title>/i);
        if (titleMatch && titleMatch[1]) scrapedTitle = titleMatch[1].replace(/&amp;/g, '&').trim();
      }
    } catch (e) {}
  }

  const prompt = `쇼핑 할인 요약 AI. 텍스트: "${sharedText}", 상품명: "${scrapedTitle}", 조건: [${pText}]
  일반 혜택은 제외하고 숨은 할인 요령과 결제 주의점만 분석해. 반드시 JSON 형식으로 대답해: {"tips": ["요령1", "요령2"], "caution": "주의점"}`;

  const apiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${SECRET_AI_KEY}`;

  try {
    // 💡 꼼수 제거: 가짜 IP 없이 당당하게 구글 VIP 하이패스로 1번만 딱 찌릅니다.
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 200, temperature: 0.2, responseMimeType: "application/json" } 
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || "구글 API 거절" });
    
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: "서버 내부 에러" });
  }
}
