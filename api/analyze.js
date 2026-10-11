import { kv } from '@vercel/kv';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });

  const { sharedText, pText } = req.body;
  const SECRET_AI_KEY = process.env.GEMINI_API_KEY; 

  if (!SECRET_AI_KEY) return res.status(500).json({ error: '서버에 API 키가 없습니다.' });
  if (!sharedText || !pText) return res.status(400).json({ error: '데이터가 없습니다.' });

  try {
    const noiseFreeText = sharedText
      .replace(/[0-9]{1,2}[:.][0-9]{2}/g, '')
      .replace(/[0-9]+%/g, '')
      .replace(/\s+/g, '')
      .trim();

    const hashInput = noiseFreeText + pText;
    const cacheKey = 'discount_cache_' + crypto.createHash('sha256').update(hashInput).digest('hex');

    try {
      const cachedData = await kv.get(cacheKey);
      if (cachedData) {
        return res.status(200).json(cachedData);
      }
    } catch (kvError) {
      console.warn("KV 캐시 조회 실패:", kvError);
    }

    // 💡 [최종 마스터 프롬프트] 지금까지의 모든 요구사항(콤보, 검색, 가독성, 논리)을 누적 통합
    const prompt = `You are an elite, highly analytical online shopping discount strategist in South Korea.
Your goal is to provide the absolute best payment strategy based on the User's Profile and the parsed Screen Text. 
You must respond in Korean.

[User Profile]
${pText}

[Screen Text]
${sharedText}

[STRICT DIRECTIVES - DO NOT FAIL]
1. OMNISCIENT EVENT TRACKING (INTERNET SEARCH): Actively use Google Search and your background knowledge. If an event (e.g., '킥스 페스티벌') is currently active today for the brand/platform, apply it even if the user scrolled past it and it's missing from the screen text.
2. SPECIFIC COUPON COMBINATION STRATEGY: Analyze all available coupons and suggest the EXACT BEST COMBINATION of stackable coupons (e.g., Platform Grade + Brand Coupon + Points). ALWAYS append this exact phrase at the end of the coupon tip: "(추가 개인 보유 쿠폰 확인/사용)".
3. EXACT NAME EXTRACTION & DATE CHECK: Extract the EXACT specific names of coupons/events (e.g., "뉴발란스 10월 킥스 페스티벌 5% 장바구니 쿠폰"). Verify expiration dates and times meticulously. DO NOT suggest expired benefits.
4. TRUTHFULNESS & STRICT MATCHING: ONLY suggest cards/pays/memberships the user ACTUALLY possesses in their [User Profile]. Never hallucinate or invent fake discounts.
5. LOGICAL CONSISTENCY & PRICE CHECK (CRITICAL): Logically compare the visible product price against any discount minimum spend conditions (e.g., "12만원 이상 결제 시"). NEVER contradict yourself. If suggesting a high-threshold discount, clearly frame it as "[장바구니] 합산 구매 시..." to avoid false hope.
6. NO REDUNDANT WORDS (CRITICAL): NEVER use unnecessary descriptive words like '보유한', '설정하신', '가지고 계신'. Just state the name directly (e.g., use "삼성카드" instead of "보유한 삼성카드").
7. ULTRA-COMPACT UI FIT (100x READABILITY): The output will be displayed in a very small mobile popup card. 
   - NO long sentences. NO conversational endings like "~하세요", "~적용 가능".
   - Use strict noun-ending bullet points (명사형 종결). 

[OUTPUT FORMAT]
- You MUST return ONLY a valid JSON object. No markdown tags (\`\`\`json).
- "tips": An array of 1 to 3 ultra-short strings. Each string MUST start with a category bracket and end with a noun.
  (Example 1: "[쿠폰조합] 뉴발란스 10월 5% 장바구니 쿠폰 + LV.3 패밀리 할인 + 적립금 선할인 (추가 개인 보유 쿠폰 확인/사용)")
  (Example 2: "[결제] 18만원 이상 합산 구매 시 카카오페이(BC카드) 6천원 즉시할인")
- "caution": A single ultra-short string for critical warnings (expiration dates, minimum spend). Leave empty "" if none. Do NOT write contradictory warnings against your own tips.

JSON Output:`;

    const apiEndpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=" + SECRET_AI_KEY;

    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }], // 실시간 이벤트/쿠폰 검색 허용 유지
        generationConfig: { 
          maxOutputTokens: 2048,
          temperature: 0.1 
        } 
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      const errorMsg = data.error?.message || `구글 통신 실패 (${response.status})`;
      return res.status(response.status).json({ error: `[구글 API 오류 ${response.status}] ${errorMsg}` });
    }
    
    const candidate = data.candidates && data.candidates[0];
    if (!candidate || !candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
      return res.status(500).json({ error: 'AI 응답 데이터 생성 실패 또는 차단됨' });
    }

    let aiTextResult = candidate.content.parts[0].text.trim();
    aiTextResult = aiTextResult.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();

    if (!aiTextResult.startsWith('{')) {
      aiTextResult = JSON.stringify({
        tips: [aiTextResult],
        caution: ""
      });
      candidate.content.parts[0].text = aiTextResult;
    } else {
      candidate.content.parts[0].text = aiTextResult;
    }

    try {
      if (aiTextResult.includes('{') && aiTextResult.includes('}')) {
        await kv.set(cacheKey, data, { ex: 3600 });
      }
    } catch (kvError) {
      console.warn("KV 캐시 저장 실패:", kvError);
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error("서버 에러:", error);
    return res.status(500).json({ error: `서버 오류 상세: ${error.message}` });
  }
}
