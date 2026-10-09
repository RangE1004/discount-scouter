// api/analyze.js (경량 크롤링 엔진 + AI 결합 버전)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });
  }

  const { sharedText, pText } = req.body;
  const SECRET_AI_KEY = process.env.GEMINI_API_KEY; 

  if (!SECRET_AI_KEY) {
    return res.status(500).json({ error: '클라우드 서버에 API 키가 설정되지 않았습니다.' });
  }

  // 1. 공유된 텍스트에서 'http'로 시작하는 진짜 링크(URL)만 쏙 뽑아냅니다.
  const urlMatch = sharedText.match(/(https?:\/\/[^\s]+)/);
  let scrapedTitle = "상품명 파악 불가";
  
  // 2. 🕵️ Vercel 서버가 직접 해당 쇼핑몰 URL로 몰래 접속해서 상품명을 긁어옵니다. (경량 스니핑)
  if (urlMatch) {
    const targetUrl = urlMatch[0];
    try {
      // 쇼핑몰 봇 차단막을 피하기 위해 진짜 사람(크롬 브라우저)인 척 위장합니다.
      const htmlResponse = await fetch(targetUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36' }
      });
      
      if (htmlResponse.ok) {
        const htmlText = await htmlResponse.text();
        
        // 정규식을 이용해 카카오톡 미리보기에 쓰이는 'og:title' (상품명)을 훔쳐옵니다.
        const titleMatch = htmlText.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"/i) 
                        || htmlText.match(/<title>([^<]*)<\/title>/i);
        
        if (titleMatch && titleMatch[1]) {
          scrapedTitle = titleMatch[1].replace(/&amp;/g, '&').trim();
        }
      }
    } catch (e) {
      console.log("크롤링 실패(방어막에 막힘):", e);
      // 실패해도 앱이 멈추면 안 되므로 쿨하게 넘깁니다.
    }
  }

  // 3. 긁어온 진짜 상품명을 AI에게 함께 먹여줍니다. (AI가 절대 환각에 빠지지 않음)
  const prompt = `쇼핑 할인 요약 AI. 
  사용자가 공유한 텍스트: "${sharedText}"
  서버가 파악한 실제 상품명: "${scrapedTitle}"
  사용자 조건: [${pText}]
  
  위 상품을 살 때, 일반 혜택은 제외하고 사용자 조건에 맞는 숨은 할인 요령과 결제 주의점만 분석해.
  반드시 아래 JSON 형식으로만 대답해:
  {
    "tips": ["할인 요령 1", "할인 요령 2"],
    "caution": "주의점 1문장"
  }`;

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
    if (!response.ok) return res.status(response.status).json(data);
    
    res.status(200).json(data);
    
  } catch (error) {
    res.status(500).json({ error: "서버 내부 통신 에러" });
  }
}
