export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });

  const { sharedText, pText } = req.body;
  const SECRET_AI_KEY = process.env.GEMINI_API_KEY; 

  if (!SECRET_AI_KEY) return res.status(500).json({ error: '서버에 API 키가 없습니다.' });

  // 💡 마지막 최상급 업그레이드: 한도 계산, 배송비 포함, 환각(거짓) 완전 차단
  const prompt = `당신은 대한민국 최고의 '쇼핑 결제 최적화 AI 비서'입니다.
[사용자 조건]: ${pText}
[화면 정보]: ${sharedText}

[최상급 분석 임무 및 절대 철칙]
1. 영끌 최적화: 화면 내의 상품 쿠폰, 장바구니 쿠폰, 결제수단(특정 카드/간편결제), 적립금 혜택을 모두 스캔하여 '가장 겹쳐 쓰기 좋은 최적의 조합'을 계산하세요.
2. 함정 및 한도 방어(매우 중요): "최대 OOO원 할인", "O만원 이상 결제 시", "배송비 별도/무료" 같은 제한 조건을 반드시 찾아내어 최종 계산에 팩트 그대로 반영하세요.
3. 팩트 절대주의(거짓/과장 0%): 화면 정보에 없는 수치나 쿠폰은 단 1%도 지어내지 마세요. 가격이나 할인 정보가 화면에 아예 안 보인다면 지어내지 말고 "정보가 부족하다"고 명시하세요.
4. 프로필 자동 매칭: 사용자의 [조건]에 맞는 플랫폼별 확정된 기본 혜택(예: 멤버십 전용 무료배송, 통신사 상시 할인 등)만 팩트 기반으로 더하세요.

[출력 형식]
반드시 아래 JSON 형식만 출력하세요. 마크다운(\`\`\`) 등은 절대 쓰지 마세요.
{
  "tips": [
    "[최적조합] 어떤 쿠폰과 결제수단을 조합해야 최대 혜택인지 1줄 요약",
    "[상세혜택] 화면 내 00쿠폰 10% + 00카드 5% 청구할인 등 명확한 수치 명시",
    "[최종체감가] 모든 혜택 및 배송비 유무를 반영한 실 결제 예상가"
  ],
  "caution": "할인 한도(최대 5천원 등), 조건(5만원 이상 등), 배송비 부과 여부 등 가장 중요한 주의사항 1문장. 없으면 빈 문자열(\"\")."
}`;

  const apiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${SECRET_AI_KEY}`;

  try {
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: prompt }] }],
        // 💡 온도(Temperature)를 0.1로 극한으로 낮춰, 소설(환각)을 쓰지 않고 오직 팩트와 계산에만 집중하도록 강제
        generationConfig: { maxOutputTokens: 600, temperature: 0.1, responseMimeType: "application/json" } 
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || `구글 통신 실패 (${response.status})` });
    }
    
    const candidate = data.candidates && data.candidates[0];
    if (!candidate) {
      return res.status(500).json({ error: "AI가 응답 데이터를 생성하지 않았습니다." });
    }
    if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
      return res.status(500).json({ error: `AI 답변 차단됨 (원인: ${candidate.finishReason || '알 수 없음'})` });
    }

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: `서버 오류 상세: ${error.message}` });
  }
}
