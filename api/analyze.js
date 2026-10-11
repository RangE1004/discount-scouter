import { kv } from '@vercel/kv';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });

  const { sharedText, pText } = req.body;
  const SECRET_AI_KEY = process.env.GEMINI_API_KEY; 

  if (!SECRET_AI_KEY) return res.status(500).json({ error: '서버에 API 키(GEMINI_API_KEY)가 없습니다.' });
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

    // 💡 [핵심] 가독성, 허위광고 필터링, 공격적인 혜택 발굴을 모두 지시하는 프롬프트
    const prompt = `당신은 한국의 독보적인 온라인 쇼핑 결제/할인 스카우터입니다.
사용자의 [맞춤 프로필]과 [화면 텍스트(스크린리더)]를 분석하여, 결제 직전 가장 완벽한 혜택 조합을 찾아주세요.

[사용자 맞춤 프로필]
${pText}

[현재 화면 텍스트]
${sharedText}

[분석 및 추천 가이드라인 - 절대 준수]
1. 과장/허위/낚시 필터링: "최대 OO% 할인", "선착순", "눈속임용 정가 부풀리기" 등 마케팅 낚시 문구에 현혹되지 마세요. 사용자의 실제 프로필 조건으로 '확실히 받을 수 있는 팩트 혜택'만 계산하세요.
2. 맹렬한 숨은 혜택 발굴: 거짓 정보를 거른다고 소극적으로 답하지 마세요. 화면에 대놓고 보이지 않더라도, 해당 쇼핑몰(쿠팡, 무신사, 네이버 등)과 사용자의 [카드/페이/멤버십/통신사]가 만났을 때 쓸 수 있는 상시 혜택(정기 쿠폰, 페이 연동 추가 적립, 제휴 할인 등)을 반드시 찾아내어 제안하세요.
3. 팩트 기반 프로필 매칭: 화면에 "OO카드 결제 시 할인"이 있어도, 사용자의 [프로필]에 그 카드가 없다면 과감히 무시하고, 사용자가 '보유한 수단' 내에서 최적의 조합(페이+카드 시너지 등)을 찾으세요.
4. 극강의 가독성 (중복/TMI 금지): 구구절절한 설명, 인사말, 반복되는 단어를 철저히 배제하세요. "어떻게 결제해서 얼마(몇 %)를 이득 보는지" 핵심 행동만 직관적이고 날카롭게 짚어주세요.

[출력 규칙]
- 반드시 순수한 JSON 객체로만 응답하세요. 마크다운(\`\`\`json 등) 금지.
- "tips": 배열(Array). 가장 혜택이 큰 순서대로 1~2개의 문자열. (불필요한 서술어 없이 명확하고 짧게 작성)
- "caution": 문자열(String). 전월 실적, 결제 수단 제한, 쿠폰 중복 불가 등 치명적인 주의사항만 1줄로 작성. 없으면 빈 문자열("").

출력 JSON:`;

    const apiEndpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=" + SECRET_AI_KEY;

    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { 
          // 넉넉한 토큰을 유지해 답변이 잘리는 것을 막되, 프롬프트에서 '짧게 쓰라'고 지시하여 가독성 통제
          maxOutputTokens: 2048,
          temperature: 0.2
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
