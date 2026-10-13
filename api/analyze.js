import { kv } from '@vercel/kv';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });

  const { sharedText, pText, appCategory } = req.body;
  const SECRET_AI_KEY = process.env.GEMINI_API_KEY;
  const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

  if (!SECRET_AI_KEY) return res.status(500).json({ error: '서버에 Gemini API 키가 없습니다.' });
  if (!sharedText || !pText) return res.status(400).json({ error: '데이터가 없습니다.' });

  try {
    // 1. 캐시 생성 (중복 스캔 방지 및 비용 절감)
    const noiseFreeText = sharedText.replace(/[0-9]{1,2}[:.][0-9]{2}/g, '').replace(/[0-9]+%/g, '').replace(/\s+/g, '').trim();
    const hashInput = noiseFreeText + pText;
    const cacheKey = 'discount_cache_' + crypto.createHash('sha256').update(hashInput).digest('hex');

    try {
      const cachedData = await kv.get(cacheKey);
      if (cachedData) return res.status(200).json(cachedData);
    } catch (e) { console.warn("KV 조회 실패:", e); }

    // ==========================================
    // 💡 [STEP 1] Tavily API를 이용한 타사 최저가 크롤링 (업그레이드 완료)
    // ==========================================
    let externalMarketData = "외부 시세 데이터 없음";
    
    // 단순 메뉴가 아닌 상품/결제 창이라고 판단될 때만 외부 API 호출
    if (TAVILY_API_KEY && sharedText.includes('원') && (sharedText.includes('구매') || sharedText.includes('장바구니'))) {
      
      // 🚨 쓸데없는 UI 텍스트(노이즈) 필터링 로직 추가
      const ignoreWords = ['장바구니', '무료배송', '쿠폰', '결제', '할인', '총 결제금액', '주문', '옵션', '배송비', '당일발송', '주 7일', '뒤로가기', '홈', '검색', '전체'];
      const lines = sharedText.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 3) // 3글자 이하 무시 (예: "찜", "톡")
        .filter(line => !ignoreWords.some(w => line.includes(w))); // 쓰레기 단어 포함된 줄 무시

      // 살아남은 첫 번째 줄을 진짜 상품명으로 간주
      const possibleProductName = lines.length > 0 ? lines[0] : ""; 

      if (possibleProductName) {
        try {
          // 검색어 최적화 (따옴표 제거 후 핵심 키워드 추가)
          const tavilyQuery = `${possibleProductName} KREAM 크림 무신사 최저가`;
          const tavilyRes = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key: TAVILY_API_KEY,
              query: tavilyQuery,
              search_depth: "basic",
              include_answer: false,
              max_results: 3
            })
          });

          if (tavilyRes.ok) {
            const tavilyData = await tavilyRes.json();
            if (tavilyData.results) {
              externalMarketData = tavilyData.results.map(r => `출처: ${r.title}\n내용: ${r.content}`).join('\n\n');
            }
          }
        } catch (e) {
          console.warn("Tavily 검색 실패 (무시하고 진행):", e);
        }
      }
    }

    // ==========================================
    // 💡 [STEP 2] 진화된 프롬프트 (데이터 병합 및 응답 포맷 강제)
    // ==========================================
    const prompt = `You are an elite, highly analytical online shopping and discount strategist in South Korea.
Your goal is to provide the absolute best payment strategy based on the User's Profile, Screen Text, and External Market Data. 

[User Profile]
${pText}

[Screen Text]
${sharedText}

[External Market Data (Tavily AI Search Results)]
${externalMarketData}

[STRICT DIRECTIVES - DO NOT FAIL]
1. CROSS-PLATFORM ARBITRAGE (CRITICAL): 
   - Analyze the [External Market Data]. If a cheaper, exact-match alternative exists elsewhere (e.g., KREAM, 11st, Danawa), your FIRST tip MUST start with [크로스체크] and explicitly state the price difference and platform name.
   - Example: "[크로스체크] 현재 화면 가격보다 KREAM(크림)에서 구매 시 32,000원 더 저렴합니다."
   - DO NOT make up prices. Use ONLY the data provided.
2. FLAWLESS MATH: NEVER guess prices. DO NOT subtract discounts already applied on the screen.
3. TRUTHFULNESS: ONLY suggest cards/pays the user possesses in [User Profile].
4. COUPON SYNERGY: Append "(추가 개인 보유 쿠폰 확인/사용)" at the end of coupon tips.
5. ULTRA-COMPACT UI FIT: 
   - EVERY tip MUST start with a bracket: [크로스체크], [최저가], [결제], [쿠폰], [적립].
   - Use strict noun-ending bullet points (명사형 종결). 

[OUTPUT SCHEMA REQUIREMENT]
Return ONLY a valid JSON object matching this exact structure:
{
  "tips": ["Array of 1 to 3 string tips"],
  "caution": "Single string for warnings (DCC etc), or empty string."
}`;

    // 사용자님 요청 모델명 적용 (gemini-3.8-flash)
    const apiEndpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=" + SECRET_AI_KEY;

    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { 
          maxOutputTokens: 2048,
          temperature: 0.1,
          responseMimeType: "application/json" 
        } 
      })
    });

    const data = await response.json();
    
    // ==========================================
    // 💡 [STEP 3] 에러 탐정 로직 (키 갱신 여부 확인)
    // ==========================================
    if (!response.ok) {
      // 서버가 현재 읽고 있는 API 키의 앞 5자리를 잘라서 에러 메시지에 붙여 보냅니다.
      const currentKeyPrefix = SECRET_AI_KEY ? SECRET_AI_KEY.substring(0, 5) : '키없음';
      return res.status(response.status).json({ 
        error: `[구글 API 오류] (적용된키: ${currentKeyPrefix}...) ${data.error?.message || '알 수 없는 오류'}` 
      });
    }
    
    // 정상 처리 시 캐시 저장
    try { await kv.set(cacheKey, data, { ex: 3600 }); } catch (e) {}

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: `서버 오류 상세: ${error.message}` });
  }
}
