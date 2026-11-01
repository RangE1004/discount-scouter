import crypto from 'crypto';

// 쿠팡 HMAC 인증키 생성 함수
function getCoupangAuth(method, uri, accessKey, secretKey) {
  const dateStr = new Date().toISOString(); 
  const datetime = dateStr.slice(2, 19).replace(/[-:]/g, '') + 'Z';
  const [path, query] = uri.split('?');
  const message = datetime + method + path + (query || '');
  const signature = crypto.createHmac('sha256', secretKey).update(message).digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });

  const { query } = req.body;
  const ACCESS_KEY = process.env.COUPANG_ACCESS_KEY;
  const SECRET_KEY = process.env.COUPANG_SECRET_KEY;

  if (!query || !ACCESS_KEY || !SECRET_KEY) return res.status(400).json({ error: '데이터 또는 쿠팡 키가 없습니다.' });

  try {
    const keyword = encodeURIComponent(query);
    // limit=15 로 최대 15개 상품 검색
    const uri = `/v2/providers/affiliate_open_api/apis/openapi/products/search?keyword=${keyword}&limit=15`;
    const authHeader = getCoupangAuth('GET', uri, ACCESS_KEY, SECRET_KEY);

    const response = await fetch(`https://api-gateway.coupang.com${uri}`, {
      method: 'GET',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' }
    });
    
    const data = await response.json();
    
    if (data.data && data.data.productData) {
      const results = data.data.productData.map(item => ({
        title: item.productName,
        price: item.productPrice,
        imageUrl: item.productImage,
        productUrl: item.productUrl, // 수익이 발생하는 파트너스 링크
        isRocket: item.isRocket
      }));
      return res.status(200).json({ results });
    }
    return res.status(200).json({ results: [] });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
