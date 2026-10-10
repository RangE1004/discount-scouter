import { kv } from '@vercel/kv';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });

  const { sharedText, pText } = req.body;
  const SECRET_AI_KEY = process.env.GEMINI_API_KEY; 

  if (!SECRET_AI_KEY) return res.status(500).json({ error: '서버에 API 키가 없습니다.' });
  if (!sharedText || !pText) return res.status(400).json({ error: '데이터가 없습니다.' });

  try {
    // 💡 [캐시 1단계] 스마트폰 상단바 시간 노이즈를 지우고 검색어 기반 고유 캐시 암호(Key) 생성
    const cleanText = sharedText.replace(/[0-9]{1,2}[:.][0-9]{2}/g, ''); 
    const hashInput = cleanText + pText;
    const cacheKey = 'discount_cache_' + crypto.createHash('sha256').update(hashInput).digest('hex');

    // 💡 [캐시 2단계] Vercel 창고(KV)에 똑같은 검색 결과가 이미 있는지 확인
    const cachedData = await kv.get(cacheKey);
    if (cachedData) {
      console.log("⚡ 캐시 적중! 0.1초 만에 즉시 반환!");
      return res.status(200).json(cachedData); // AI를 부르지 않고 0.1초 만에 앱으로 즉시 전송
    }

    console.log("🔍 캐시 없음. Gemini AI 분석 시작...");

    // --- 기존에 작성하신 완벽한 프롬프트 및 AI 호출 로직 유지 ---
    const prompt = `당신은 대한민국 최고의 '쇼핑 결제 최적화 AI 비서'입니다.
[사용자 조건]: ${pText}
[화면 정보]: ${sharedText}

[최상급 분석 임무]
1. 영끌 최적화: 쿠폰, 카드 할인, 포인트를 모두 스캔하여 최적의 중복 조합을 계산하세요.
2. 함정 방어: 최대 할인 한도, 결제 조건, 배송비 유무를 반드시 찾아내어 팩트 그대로 반영하세요.
3. 팩트 절대주의: 화면에 정보가 없으면 절대 수치를 지어내지 마세요.

[출력 형식]
반드시 아래 JSON 형식만 정확히 출력하고 마지막 닫는 괄호(})까지 완벽하게 작성하세요.
{
  "tips": [
    "[최적조합] 어떤 쿠폰과 결제수단을 조합해야 최대 혜택인지 1줄 요약",
    "[상세혜택] 화면 내 확인된 쿠폰/할인의 명확한 수치 명시",
    "[최종체감가] 배송비 등을 모두 반영한 실 결제 예상가"
  ],
  "caution": "할인 한도, 특정 결제수단 한정 등 가장 중요한 주의사항 1문장 요약. 없으면 빈 문자열(\"\")."
}`;

    const apiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${SECRET_AI_KEY}`;

    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1500, temperature: 0.1 } 
      })
    });

    const data = await response.json();
    
    // 에러 검증 로직 유지
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || `구글 통신 실패 (${response.status})` });
    }
    
    const candidate = data.candidates && data.candidates[0];
    if (!candidate) {
      return res.status(500).json({ error: "AI가 응답 데이터를 생성하지 않았습니다." });
    }
    if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
      return res.status(500).json({ error: `AI 답변 차단됨` });
    }

    // 💡 [캐시 3단계] AI 분석이 에러 없이 완벽하게 성공했다면 결과를 창고에 '1시간(3600초)' 동안 보관!
    await kv.set(cacheKey, data, { ex: 3600 });

    res.status(200).json(data);
  } catch (error) {
    console.error("서버 에러:", error);
    res.status(500).json({ error: `서버 오류 상세: ${error.message}` });
  }
}
