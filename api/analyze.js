import { kv } from '@vercel/kv';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });

  const { sharedText, pText } = req.body;
  const SECRET_AI_KEY = process.env.GEMINI_API_KEY; 

  if (!SECRET_AI_KEY) return res.status(500).json({ error: '서버에 API 키가 없습니다.' });
  if (!sharedText || !pText) return res.status(400).json({ error: '데이터가 없습니다.' });

  try {
    // 💡 [기존 방어 로직 유지] 시간, 배터리 등 무의미한 텍스트를 제거하여 캐시 적중률 극대화
    const noiseFreeText = sharedText
      .replace(/[0-9]{1,2}[:.][0-9]{2}/g, '')
      .replace(/[0-9]+%/g, '')
      .replace(/\s+/g, '')
      .trim();

    const hashInput = noiseFreeText + pText;
    const cacheKey = 'discount_cache_' + crypto.createHash('sha256').update(hashInput).digest('hex');

    const cachedData = await kv.get(cacheKey);
    if (cachedData) {
      console.log("⚡ 캐시 적중! 0.1초 만에 즉시 반환!");
      return res.status(200).json(cachedData);
    }

    console.log("🔍 캐시 없음. Gemini AI 4단계 최적화 분석 시작...");

    // 💡 [신규 프롬프트 적용] 작성해주신 가이드를 토큰 절약형 영어 프롬프트로 변환
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

    // 💡 최신 모델 적용 및 생성 토큰 제한(maxOutputTokens)으로 비용 2차 방어
    const apiEndpoint = `[https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=$](https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=$){SECRET_AI_KEY}`;

    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { 
          maxOutputTokens: 300, // JSON 응답은 짧으므로 토큰을 크게 제한하여 요금 낭비 방지
          temperature: 0.1 // 창의성 제한 (환각 방지)
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

    // 💡 [기존 방어 로직 유지] 불량 JSON 검열 및 캐시 저장
    const aiTextResult = candidate.content.parts[0].text;
    if (aiTextResult.includes('{') && aiTextResult.includes('}')) {
      await kv.set(cacheKey, data, { ex: 3600 });
      console.log("✅ 정상 결과 캐시에 성공적으로 보관 완료");
    } else {
      console.log("⚠️ 불량 형식 감지. 캐시에 저장하지 않습니다.");
    }

    res.status(200).json(data);
  } catch (error) {
    console.error("서버 에러:", error);
    res.status(500).json({ error: `서버 오류 상세: ${error.message}` });
  }
}
