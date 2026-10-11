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

    const cachedData = await kv.get(cacheKey);
    if (cachedData) {
      return res.status(200).json(cachedData);
    }

    const prompt = `You are an extreme online shopping discount expert in South Korea.
User Profile: ${pText}
Screen Text: ${sharedText}

[Rules & Priority Fallback]
Evaluate in this strict order. Move to the next ONLY if the upper condition is not met. DO NOT invent fake promotions.
1. Synergy: Combine user's [Card] with [Pay] for double rewards, or match [Membership] with specific [Pay/Card].
2. Background Knowledge Reminder: Remind inherent/regular benefits based on the domain (e.g., Gmarket + Shinsegae Universe = monthly 5% coupon) without relying only on Screen Text.
3. Strong Single Method: Recommend the single best Card/Pay (e.g., no-condition reward cards).
4. Fallback: If no synergy/special benefit exists, honestly suggest the best basic Pay method. DO NOT return empty.

[Prohibitions]
- NEVER parrot/summarize the screen text's basic prices.
- NEVER hallucinate fake events/dates. Use factual background knowledge of the user's Profile.
- NEVER make up impossible card-pay connections.

[Output Format]
- Output strictly as a JSON object. NO markdown, NO code blocks.
- "tips": Array of Max 2 strings (Korean, 30-40 chars each, clear and intuitive).
- "caution": 1 string for key warnings (e.g., performance conditions, limits). Empty string if none.

[Examples]
Bad: {"tips": ["쿠팡 와우 회원 할인을 받고 신한카드로 결제하세요."], "caution": ""}
Good 1: {"tips": ["KB국민카드를 네이버페이에 등록 결제하여 쇼핑몰 혜택과 페이 기본 적립을 이중으로 챙기세요."], "caution": "네이버페이 포인트 적립 한도를 확인하세요."}
Good 2: {"tips": ["G마켓 화면입니다. 신세계 유니버스 회원에게 매월 주어지는 5% 정기 쿠폰을 먼저 적용하세요."], "caution": ""}
Good 3: {"tips": ["별도 조합 없이 보유하신 현대카드로 단독 결제하는 것이 전월 실적 제약 없이 가장 안정적입니다."], "caution": ""}

Output JSON now:`;

    // 💡 가장 안정적이고 응답이 빠른 gemini-1.5-flash 모델 유지
    const apiEndpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" + SECRET_AI_KEY;

    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { 
          maxOutputTokens: 800,
          temperature: 0.1
        } 
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || `구글 통신 실패 (${response.status})` });
    }
    
    const candidate = data.candidates && data.candidates[0];
    if (!candidate || !candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
      return res.status(500).json({ error: `AI 응답 데이터 생성 실패 또는 차단됨` });
    }

    let aiTextResult = candidate.content.parts[0].text.trim();
    
    // 💡 [핵심 안전망 1] AI가 불필요한 마크다운 기호를 섞어 보냈을 경우 서버에서 강제 삭제
    aiTextResult = aiTextResult.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();

    // 💡 [핵심 안전망 2] AI가 JSON 괄호를 빼먹고 "국민카드 등록하세요" 라는 글자만 보냈을 경우, 서버에서 JSON 모양으로 강제 포장
    if (!aiTextResult.startsWith('{')) {
      aiTextResult = JSON.stringify({
        tips: [aiTextResult],
        caution: ""
      });
      // 예쁘게 포장된 JSON 글자를 원본 데이터에 덮어씌워서 안드로이드 앱으로 전달
      candidate.content.parts[0].text = aiTextResult;
    }

    if (aiTextResult.includes('{') && aiTextResult.includes('}')) {
      await kv.set(cacheKey, data, { ex: 3600 });
    }

    res.status(200).json(data);
  } catch (error) {
    console.error("서버 에러:", error);
    res.status(500).json({ error: `서버 오류 상세: ${error.message}` });
  }
}
