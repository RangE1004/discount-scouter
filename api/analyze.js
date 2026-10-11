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

    // 💡 [핵심] 화면 앵무새 차단, 숨은 쿠폰 발굴, 팩트 체크, 극강의 가독성을 강제하는 영문 프롬프트
    const prompt = `You are an elite, highly analytical online shopping discount strategist in South Korea.
Your goal is to provide the absolute best payment strategy based on the User's Profile and the parsed Screen Text. 
You must respond in Korean.

[User Profile]
${pText}

[Screen Text]
${sharedText}

[STRICT DIRECTIVES - DO NOT FAIL]
1. BEYOND THE SCREEN (No Echoing): The user can already see the screen. DO NOT just summarize or read the prices from the [Screen Text]. Your primary job is to find HIDDEN synergies and platform-specific background knowledge that are NOT written on the screen.
2. ACTIVE COUPON HUNTING (Domain Knowledge): Actively suggest hidden coupons based on the platform.
   - For Musinsa: Always remind the user to apply "Grade discounts (등급할인)", "Cart coupons (장바구니 쿠폰)", and "Pre-discount points (적립금 선할인)".
   - For Coupang: Check for Wow membership-specific card promotions or routine delivery savings.
   - For Naver/11st/etc.: Suggest combining specific Pay methods with their respective memberships.
3. TRUTHFULNESS & STRICT MATCHING: You must ONLY suggest cards, pays, or memberships that the user ACTUALLY possesses in their [User Profile]. Never hallucinate fake discounts or events. Filter out marketing clickbait (e.g., "Up to X%").
4. EXTREME READABILITY: No fluff, no conversational filler, no long explanations. Deliver punchy, direct action items. Focus only on "What to use" and "What the exact benefit is".

[OUTPUT FORMAT]
- You MUST return ONLY a valid JSON object. No markdown tags (\`\`\`json).
- "tips": An array of 1 to 2 strings (in Korean). Each string must be a concise, direct instruction. (e.g., "무신사 장바구니 쿠폰과 적립금 선할인을 먼저 적용한 뒤, 보유하신 현대카드로 결제하세요.")
- "caution": A single string (in Korean) for critical warnings (e.g., spending limits, excluded categories). Leave as empty string "" if none.

JSON Output:`;

    const apiEndpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=" + SECRET_AI_KEY;

    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { 
          maxOutputTokens: 2048,
          temperature: 0.1 // 💡 0.1로 낮추어 허위 사실이나 과장된 문장 생성을 극도로 억제함
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
