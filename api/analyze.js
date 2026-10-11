import { kv } from '@vercel/kv';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });

  const { sharedText, pText } = req.body;
  const SECRET_AI_KEY = process.env.GEMINI_API_KEY; 

  if (!SECRET_AI_KEY) return res.status(500).json({ error: '서버에 API 키(GEMINI_API_KEY)가 등록되지 않았습니다.' });
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
      console.warn("KV 캐시 조회 실패 (계속 진행):", kvError);
    }

    // 💡 [핵심] 멍청한 답변을 막고 진짜 전문가처럼 대답하게 만드는 초정밀 프롬프트
    const prompt = `당신은 한국의 독보적인 온라인 쇼핑 결제/할인 스카우터입니다.
사용자의 [맞춤 프로필(카드/멤버십 등)]과 [화면 텍스트(스크린리더 데이터)]를 철저히 분석하여, 숨겨진 혜택과 시너지를 찾아주세요.

[사용자 맞춤 프로필]
${pText}

[현재 화면 텍스트]
${sharedText}

[분석 및 추천 가이드라인 - 절대 준수]
1. 뻔한 앵무새 요약 금지: "와우 회원으로 구매하세요", "쿠폰을 다운로드하세요", "단순 금액 맞추기" 같이 누구나 아는 당연한 소리나 화면의 가격을 그대로 읊는 행위는 절대 금지합니다.
2. 프로필과 화면 정보의 '정확한 팩트 매칭': 화면에 특정 카드/페이 할인(예: 삼성카드 결제 시 특별가)이 있다면, 사용자의 [맞춤 프로필]에 해당 카드/페이가 있는지 반드시 대조하여 강력하게 추천하세요.
3. 숨은 시너지 발굴: 화면에 적혀있지 않더라도, 현재 쇼핑몰 앱(무신사, 쿠팡, 네이버 등)에서 사용자의 [멤버십/통신사/신분]으로 받을 수 있는 상시 혜택(등급 할인, 간편결제 포인트 추가 적립 등)을 배경 지식으로 끌어와 제안하세요.
4. 구체적이고 가독성 높은 문장: "어떤 카드를", "어떤 페이에 묶어서", "어떻게 결제하면", "무슨 이득을 보는지" 명확하고 자연스러운 한국어로 설명하세요. 글자 수 제한 없이 충분히 설명해도 됩니다.

[출력 규칙]
- 반드시 순수한 JSON 객체로만 응답하세요. 마크다운(\`\`\`json 등)이나 인사말을 절대 포함하지 마세요.
- "tips": 배열(Array). 가장 강력한 맞춤형 혜택 순서대로 1~3개의 문자열을 작성하세요.
- "caution": 문자열(String). 혜택을 받기 위한 주의사항이나 전월 실적 조건 등. (예: "결제창에서 일반결제가 아닌 꼭 OO페이를 선택해야 할인이 적용됩니다.")

출력 JSON:`;

    const apiEndpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=" + SECRET_AI_KEY;

    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { 
          // 💡 [핵심] 토큰 아끼지 말고 충분히 생각하고 말 끝까지 다 하도록 한도 대폭 상향 (800 -> 2048)
          maxOutputTokens: 2048,
          // 💡 온도를 살짝 올려(0.1 -> 0.3) 기계적인 답변 대신 더 유연하게 맥락을 파악하도록 수정
          temperature: 0.3
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
    
    // 혹시라도 AI가 습관처럼 마크다운 기호를 붙이면 강제 제거
    aiTextResult = aiTextResult.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();

    // 중도에 끊기지 않았는지 기본 검사 후, 형식이 깨졌으면 억지로 묶어줌
    if (!aiTextResult.startsWith('{')) {
      aiTextResult = JSON.stringify({
        tips: [aiTextResult],
        caution: ""
      });
      candidate.content.parts[0].text = aiTextResult;
    } else {
      // 응답을 그대로 전달하기 위해 덮어쓰기
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
