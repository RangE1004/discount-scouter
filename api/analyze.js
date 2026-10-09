// api/analyze.js (백엔드 서버 코드)

export default async function handler(req, res) {
  // 1. POST 방식의 요청만 받음 (보안)
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });
  }

  // 2. 폰(앱)에서 보낸 데이터 받기
  const { sharedText, pText } = req.body;
  
  // 3. 💡 핵심: 깃허브 코드에 키를 적지 않고, 클라우드 환경변수에서 몰래 꺼내옵니다.
  const SECRET_AI_KEY = process.env.GEMINI_API_KEY; 

  if (!SECRET_AI_KEY) {
    return res.status(500).json({ error: '클라우드 서버에 API 키가 설정되지 않았습니다.' });
  }

  const prompt = `쇼핑 할인 요약 AI. 텍스트:"${sharedText}" 조건:[${pText}]
  일반 혜택은 제외하고 숨은 할인 요령과 결제 주의점만 분석해.
  반드시 아래 JSON 형식으로만 대답해:
  {
    "tips": ["할인 요령 1", "할인 요령 2"],
    "caution": "주의점 1문장"
  }`;

  const apiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${SECRET_AI_KEY}`;

  try {
    // 4. 폰 대신 클라우드 서버가 구글을 찌릅니다.
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 200, temperature: 0.2, responseMimeType: "application/json" } 
      })
    });

    const data = await response.json();
    
    // 5. 구글에서 받은 결과를 다시 폰으로 쏴줍니다.
    if (!response.ok) {
      return res.status(response.status).json(data);
    }
    
    res.status(200).json(data);
    
  } catch (error) {
    res.status(500).json({ error: "서버 내부 통신 에러" });
  }
}
