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

    // 💡 [핵심 업데이트] 대체 상품 검색 시 "시간/일정 완벽 일치" 조건 강제
    const prompt = `You are an elite, highly analytical online shopping discount strategist in South Korea.
Your goal is to provide the absolute best payment strategy based on the User's Profile and the parsed Screen Text. 
You must respond in Korean.

[User Profile]
${pText}

[Screen Text]
${sharedText}

[STRICT DIRECTIVES - DO NOT FAIL]
1. EXACT PRICE MATCHING & FLAWLESS CALCULATION: NEVER guess or invent prices. You MAY mathematically calculate the final price based ONLY on visible numbers.
2. TRUTHFULNESS & STRICT MATCHING: ONLY suggest cards/pays/memberships the user ACTUALLY possesses in their [User Profile].
3. AGGRESSIVE PROMO HUNTING & STRICT TIME MATCHING (CRITICAL): Actively use Google Search. IF you find a cheaper alternative (e.g., flights, hotels), it MUST PERFECTLY MATCH the exact departure/arrival times, dates, and locations shown on the [Screen Text]. NEVER suggest a cheaper option if the time schedule is different. If you do find a valid cheaper alternative, explicitly state its name.
4. MANDATORY BENEFIT EXPLANATION: NEVER suggest a payment method without explicitly stating the EXACT BENEFIT AMOUNT OR REASON.
5. SPECIFIC COUPON COMBINATION STRATEGY: Analyze all available coupons/search results to suggest the EXACT BEST COMBINATION. ALWAYS append this exact phrase at the end of the coupon tip: "(추가 개인 보유 쿠폰 확인/사용)".
6. LOGICAL CONSISTENCY & PRICE CHECK: Logically compare the visible product price against minimum spend conditions. NEVER contradict yourself.
7. NO REDUNDANT WORDS & ULTRA-COMPACT UI FIT: NEVER use unnecessary words like '보유한', '설정하신'. NO long sentences. Use strict noun-ending bullet points (명사형 종결). 

[OUTPUT FORMAT]
- You MUST return ONLY a valid JSON object. No markdown tags (\`\`\`json).
- "tips": An array of 1 to 3 ultra-short strings. Each string MUST start with a category bracket and end with a noun.
- "caution": A single ultra-short string for critical warnings (expiration dates, minimum spend). Leave empty "" if none.

JSON Output:`;

    const apiEndpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=" + SECRET_AI_KEY;

    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }], 
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
