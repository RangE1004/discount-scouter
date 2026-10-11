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

    // 💡 [핵심] 뻔한 소리 금지, 디테일한 중복 쿠폰 조합, 유효기간 체크, 개인 쿠폰 안내 강제
    const prompt = `You are an elite, highly analytical online shopping discount strategist in South Korea.
Your goal is to provide the absolute best payment strategy based on the User's Profile and the parsed Screen Text. 
You must respond in Korean.

[User Profile]
${pText}

[Screen Text]
${sharedText}

[STRICT DIRECTIVES - DO NOT FAIL]
1. SPECIFIC COUPON COMBINATION STRATEGY (CRITICAL): DO NOT give generic advice like "쿠폰을 적용하세요(Apply coupons)." 
   - You MUST analyze all available coupons from the [Screen Text] and your domain knowledge, and suggest the EXACT BEST COMBINATION of stackable coupons (e.g., Platform Grade Coupon + Brand/Store Coupon + Pre-discount points).
   - Carefully check for EXPIRATION DATES or times in the [Screen Text]. Do NOT suggest expired benefits.
   - If there might be personal coupons not visible on screen, ALWAYS append this exact phrase at the end of the coupon tip: "(추가 개인 보유 쿠폰 확인/사용)".
2. TRUTHFULNESS & STRICT MATCHING: ONLY suggest cards/pays/memberships the user ACTUALLY possesses in their [User Profile]. Never hallucinate or invent fake discounts.
3. LOGICAL CONSISTENCY & PRICE CHECK (CRITICAL): You must logically compare the visible product price against any discount minimum spend conditions (e.g., "12만원 이상 결제 시"). 
   - NEVER contradict yourself.
   - If you suggest a high-threshold discount, clearly frame it as "[장바구니] 합산 구매 시..." to avoid false hope.
4. NO REDUNDANT WORDS: NEVER use unnecessary descriptive words like '보유한', '설정하신', '가지고 계신'. Just state the name directly (e.g., use "삼성카드" instead of "보유한 삼성카드").
5. AT-A-GLANCE READABILITY: Deliver information in a highly scannable, structured keyword format. Use bracketed prefixes like [쿠폰조합], [결제], [장바구니].

[OUTPUT FORMAT]
- You MUST return ONLY a valid JSON object. No markdown tags (\`\`\`json).
- "tips": An array of 1 to 3 strings. Each string MUST follow the highly scannable bracket format. 
  (Example 1: "[쿠폰조합] 무신사 패밀리 등급 할인 + 15% 장바구니 쿠폰 + 적립금 선할인 콤보 적용 (추가 개인 보유 쿠폰 확인/사용)")
  (Example 2: "[결제] 12만원 이상 합산 구매 시 'IBK기업은행(BC)' 무신사페이 1.2만원 즉시할인")
- "caution": A single string for critical warnings (e.g., expiration dates closing soon, minimum spend limits). Leave as empty string "" if none. Do NOT write contradictory warnings against your own tips.

JSON Output:`;

    const apiEndpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=" + SECRET_AI_KEY;

    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: prompt }] }],
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
