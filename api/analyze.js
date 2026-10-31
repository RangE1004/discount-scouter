import { kv } from '@vercel/kv';
import crypto from 'crypto';

// 💡 쿠팡 파트너스 API 전용 HMAC 인증키 생성 로직
function getCoupangAuth(method, uri, accessKey, secretKey) {
  const dateStr = new Date().toISOString(); 
  const datetime = dateStr.slice(2, 19).replace(/[-:]/g, '') + 'Z'; // YYMMDDTHHmmssZ 포맷
  const [path, query] = uri.split('?');
  const message = datetime + method + path + (query || '');
  const signature = crypto.createHmac('sha256', secretKey).update(message).digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });

  const { sharedText, pText, appCategory } = req.body;
  const SECRET_AI_KEY = process.env.GEMINI_API_KEY;
  const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
  const COUPANG_ACCESS_KEY = process.env.COUPANG_ACCESS_KEY;
  const COUPANG_SECRET_KEY = process.env.COUPANG_SECRET_KEY;

  if (!SECRET_AI_KEY) return res.status(500).json({ error: '서버에 Gemini API 키가 없습니다.' });
  if (!sharedText || !pText) return res.status(400).json({ error: '데이터가 없습니다.' });

  try {
    const noiseFreeText = sharedText.replace(/[0-9]{1,2}[:.][0-9]{2}/g, '').replace(/[0-9]+%/g, '').replace(/\s+/g, '').trim();
    const hashInput = noiseFreeText + pText;
    const cacheKey = 'discount_cache_' + crypto.createHash('sha256').update(hashInput).digest('hex');

    try {
      const cachedData = await kv.get(cacheKey);
      if (cachedData) return res.status(200).json(cachedData);
    } catch (e) { console.warn("KV 조회 실패:", e); }

    // ==========================================
    // 💡 [STEP 1] 검색어(상품명) 추출
    // ==========================================
    let possibleProductName = "";
    if (sharedText.includes('원') && (sharedText.includes('구매') || sharedText.includes('장바구니'))) {
      const ignoreWords = ['장바구니', '무료배송', '쿠폰', '결제', '할인', '총 결제금액', '주문', '옵션', '배송비', '당일발송', '주 7일', '뒤로가기', '홈', '검색', '전체'];
      const lines = sharedText.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 3) 
        .filter(line => !ignoreWords.some(w => line.includes(w)));
      if (lines.length > 0) possibleProductName = lines[0];
    }

    // ==========================================
    // 💡 [STEP 2] 외부 API 병렬 호출 (Tavily 메타검색 + Coupang 파트너스)
    // ==========================================
    let externalMarketData = "외부 시세 데이터 없음";
    let coupangDataText = "쿠팡 검색 결과 없음";
    let fallbackCoupangUrl = "";

    if (possibleProductName) {
      const promises = [];

      // 1. Tavily 크로스체크
      if (TAVILY_API_KEY) {
        const tavilyQuery = `${possibleProductName} KREAM 크림 무신사 최저가`;
        const tavilyReq = fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: TAVILY_API_KEY, query: tavilyQuery, search_depth: "basic", include_answer: false, max_results: 2 })
        }).then(r => r.json()).then(data => {
          if (data.results) externalMarketData = data.results.map(r => `출처: ${r.title}\n내용: ${r.content}`).join('\n\n');
        }).catch(e => console.warn("Tavily 오류 무시"));
        promises.push(tavilyReq);
      }

      // 2. 쿠팡 파트너스 검색
      if (COUPANG_ACCESS_KEY && COUPANG_SECRET_KEY) {
        const method = 'GET';
        const keyword = encodeURIComponent(possibleProductName);
        const uri = `/v2/providers/affiliate_open_api/apis/openapi/products/search?keyword=${keyword}&limit=3`;
        const authHeader = getCoupangAuth(method, uri, COUPANG_ACCESS_KEY, COUPANG_SECRET_KEY);

        const coupangReq = fetch(`https://api-gateway.coupang.com${uri}`, {
          method: 'GET',
          headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' }
        }).then(r => r.json()).then(data => {
          if (data.data && data.data.productData && data.data.productData.length > 0) {
            const topItem = data.data.productData[0];
            const isRocket = topItem.isRocket ? "(🚀로켓배송)" : "";
            coupangDataText = `상품명: ${topItem.productName}, 가격: ${topItem.productPrice}원 ${isRocket}`;
            fallbackCoupangUrl = topItem.productUrl; // 내 수익이 되는 파트너스 단축 URL
          }
        }).catch(e => console.warn("Coupang 오류 무시"));
        promises.push(coupangReq);
      }

      await Promise.all(promises);
    }

    // ==========================================
    // 💡 [STEP 3] 진화된 프롬프트 (데이터 병합 및 JSON 스키마 강제)
    // ==========================================
    const prompt = `You are an elite online shopping strategist in South Korea.

[User Profile]
${pText}

[Screen Text]
${sharedText}

[External Market Data (Tavily AI Search)]
${externalMarketData}

[Coupang Partners Data]
${coupangDataText}
Affiliate URL: ${fallbackCoupangUrl}

[STRICT DIRECTIVES]
1. CROSS-PLATFORM ARBITRAGE: Start tips with [크로스체크] if a cheaper price is found on KREAM, 11st, etc.
2. COUPANG AFFILIATE: If [Coupang Partners Data] has a product, you MUST create a tip starting with [쿠팡 최저가] that states the price, mentions rocket delivery if applicable, and encourages clicking the button/link to buy.
3. COUPON SYNERGY: Append "(추가 보유 쿠폰 확인)" at the end of coupon tips.
4. ULTRA-COMPACT UI FIT: Use strict noun-ending bullet points (명사형 종결).

[OUTPUT SCHEMA REQUIREMENT]
Return ONLY a valid JSON object matching this exact structure:
{
  "tips": ["Array of 1 to 4 string tips"],
  "caution": "Single string for warnings, or empty string.",
  "coupang_url": "String containing EXACTLY the Affiliate URL from [Coupang Partners Data], or empty string if none."
}`;

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
    
    if (!response.ok) {
      const currentKeyPrefix = SECRET_AI_KEY ? SECRET_AI_KEY.substring(0, 5) : '키없음';
      return res.status(response.status).json({ error: `[API 오류] (키: ${currentKeyPrefix}...) ${data.error?.message}` });
    }
    
    try { await kv.set(cacheKey, data, { ex: 3600 }); } catch (e) {}
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: `서버 오류 상세: ${error.message}` });
  }
}
