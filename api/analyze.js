export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });

  const { sharedText, pText } = req.body;
  const SECRET_AI_KEY = process.env.GEMINI_API_KEY; 

  if (!SECRET_AI_KEY) return res.status(500).json({ error: '서버에 API 키가 없습니다.' });

  const urlMatch = sharedText.match(/(https?:\/\/[^\s]+)/);
  let scrapedTitle = "상품명 파악 불가";
  
  if (urlMatch) {
    // 💡 해결책: 쿠팡 크롤링에 '3초 타이머'를 걸어 10초 강제종료를 방어합니다.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3초 뒤 강제 중단 신호

    try {
      const htmlResponse = await fetch(urlMatch[0], { 
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: controller.signal // 타이머 신호 연결
      });
      if (htmlResponse.ok) {
        const htmlText = await htmlResponse.text();
        const titleMatch = htmlText.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"/i) || htmlText.match(/<title>([^<]*)<\/title>/i);
        if (titleMatch && titleMatch[1]) scrapedTitle = titleMatch[1].replace(/&amp;/g, '&').trim();
      }
    } catch (e) {
      // 3초가 지나면 여기서 조용히 크롤링을 포기하고 바로 다음 단계(AI)로 넘어갑니다.
      console.log("크롤링 타임아웃 통과"); 
    } finally {
      clearTimeout(timeoutId); // 메모리 누수 방지
    }
  }

  const prompt = `쇼핑 할인 요약 AI. 텍스트: "${sharedText}", 상품명: "${scrapedTitle}", 조건: [${pText}]
  일반 혜택은 제외하고 숨은 할인 요령과 결제 주의점만 분석해. 반드시 JSON 형식으로 대답해: {"tips": ["요령1", "요령2"], "caution": "주의점"}`;

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
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || "구글 통신 실패" });
    
    // 💡 추가 방어: 구글 AI가 글자를 중간에 끊고 보냈을 경우를 대비한 텍스트 검증
    if (!data.candidates || data.candidates.length === 0 || !data.candidates[0].content.parts[0].text) {
      return res.status(500).json({ error: "AI가 빈 답변을 보냈습니다." });
    }

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: "서버 내부 통신 에러가 발생했습니다." });
  }
}
