import { kv } from '@vercel/kv';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });

  const { sharedText, pText, appCategory } = req.body;
  const SECRET_AI_KEY = process.env.GEMINI_API_KEY;
  const TAVILY_API_KEY = process.env.TAVILY_API_KEY; // 💡 새로 추가된 환경변수

  if (!SECRET_AI_KEY) return res.status(500).json({ error: '서버에 Gemini API 키가 없습니다.' });
  if (!sharedText || !pText) return res.status(400).json({ error: '데이터가 없습니다.' });

  try {
    // 1. 캐시 생성 (동일 화면 반복 스캔 시 비용 방어)
    const noiseFreeText = sharedText.replace(/[0-9]{1,2}[:.][0-9]{2}/g, '').replace(/[0-9]+%/g, '').replace(/\s+/g, '').trim();
    const hashInput = noiseFreeText + pText;
    const cacheKey = 'discount_cache_' + crypto.createHash('sha256').update(hashInput).digest('hex');

    try {
      const cachedData = await kv.get(cacheKey);
      if (cachedData) return res.status(200).json(cachedData);
    } catch (e) { console.warn("KV 조회 실패:", e); }

    // ==========================================
    // 💡 [STEP 1] Tavily API를 이용한 타사 최저가 크롤링
    // ==========================================
    let externalMarketData = "외부 시세 데이터 없음";
    
    // 단순 메뉴 탐색이 아닌, 결제/장바구니 창이라고 판단될 때만 외부 API를 호출 (토큰/시간 아끼기)
    if (TAVILY_API_KEY && sharedText.includes('원') && (sharedText.includes('구매') || sharedText.includes('장바구니'))) {
      
      // 상품명 추출 꼼수 (첫 번째나 두 번째 줄 등 상단 텍스트를 상품명으로 간주)
      const lines = sharedText.split('\n').filter(line => line.trim().length > 2);
      const possibleProductName = lines.length > 0 ? lines[0] : ""; 

      if (possibleProductName) {
        try {
          const tavilyQuery = `"${possibleProductName}" 최저가 비교 무신사 크림 다나와 가격`;
          const tavilyRes = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key: TAVILY_API_KEY,
              query: tavilyQuery,
              search_depth: "basic", // 속도를 위해 basic (대략 1초 내외)
              include_answer: false,
              max_results: 3
            })
          });

          if (tavilyRes.ok) {
            const tavilyData = await tavilyRes.json();
            // Tavily가 가져온 3개의 링크와 제목/요약 문구를 하나로 합침
            externalMarketData = tavilyData.results.map(r => `출처: ${r.title}\n내용: ${r.content}`).join('\n\n');
          }
        } catch (e) {
          console.warn("Tavily 검색 실패 (무시하고 진행):", e);
        }
      }
    }

    // ==========================================
    // 💡 [STEP 2] 진화된 프롬프트 (데이터 병합 및 응답 포맷 강제)
    // ==========================================
    const prompt = `You are an elite, highly analytical online shopping and discount strategist in South Korea.
Your goal is to provide the absolute best payment strategy based on the User's Profile, Screen Text, and External Market Data. 

[User Profile]
${pText}

[Screen Text]
${sharedText}

[External Market Data (Tavily AI Search Results)]
${externalMarketData}

[STRICT DIRECTIVES - DO NOT FAIL]
1. CROSS-PLATFORM ARBITRAGE (CRITICAL): 
   - Analyze the [External Market Data]. If a cheaper, exact-match alternative exists elsewhere (e.g., KREAM, 11st, Danawa), your FIRST tip MUST start with [크로스체크] and explicitly state the price difference and platform name.
   - Example: "[크로스체크] 현재 화면 가격보다 KREAM(크림)에서 구매 시 32,000원 더 저렴합니다."
   - DO NOT make up prices. Use ONLY the data provided.
2. FLAWLESS MATH: NEVER guess prices. DO NOT subtract discounts already applied on the screen.
3. TRUTHFULNESS: ONLY suggest cards/pays the user possesses in [User Profile].
4. COUPON SYNERGY: Append "(추가 개인 보유 쿠폰 확인/사용)" at the end of coupon tips.
5. ULTRA-COMPACT UI FIT: 
   - EVERY tip MUST start with a bracket: [크로스체크], [최저가], [결제], [쿠폰], [적립].
   - Use strict noun-ending bullet points (명사형 종결). 

[OUTPUT SCHEMA REQUIREMENT]
Return ONLY a valid JSON object matching this exact structure:
{
  "tips": ["Array of 1 to 3 string tips"],
  "caution": "Single string for warnings (DCC etc), or empty string."
}`;

    // responseMimeType을 추가하여 무조건 JSON 문법으로만 출력되도록 강제합니다.
    const apiEndpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" + SECRET_AI_KEY;

    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: prompt }] }],
        // 💡 Google Search Tool을 뺍니다. (Tavily가 더 빠르고 정확하게 찾아오므로 충돌 방지)
        generationConfig: { 
          maxOutputTokens: 2048,
          temperature: 0.1,
          responseMimeType: "application/json" 
        } 
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: `[구글 API 오류] ${data.error?.message}` });
    
    // 캐시 저장
    try { await kv.set(cacheKey, data, { ex: 3600 }); } catch (e) {}

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: `서버 오류 상세: ${error.message}` });
  }
}
