import crypto from 'crypto';

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

  if (!query || !ACCESS_KEY || !SECRET_KEY) {
    // API 키가 Vercel에 없을 경우 화면에 띄움
    return res.status(200).json({ results: [{
        title: "🚨 에러: Vercel 환경변수에 쿠팡 API 키가 없습니다.",
        price: 0, imageUrl: "", productUrl: "", isRocket: false
    }]});
  }

  try {
    const keyword = encodeURIComponent(query);
    const uri = `/v2/providers/affiliate_open_api/apis/openapi/products/search?keyword=${keyword}&limit=15`;
    const authHeader = getCoupangAuth('GET', uri, ACCESS_KEY, SECRET_KEY);

    const response = await fetch(`https://api-gateway.coupang.com${uri}`, {
      method: 'GET',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' }
    });
    
    const data = await response.json();
    
    // 정상적으로 상품을 가져온 경우
    if (data.data && data.data.productData) {
      const results = data.data.productData.map(item => ({
        title: item.productName,
        price: item.productPrice,
        imageUrl: item.productImage,
        productUrl: item.productUrl,
        isRocket: item.isRocket
      }));
      return res.status(200).json({ results });
    }
    
    // 💡 [핵심] 쿠팡이 거절했을 경우, 그 거절 사유를 상품 제목에 넣어서 안드로이드로 보냅니다!
    return res.status(200).json({ results: [{
        title: `🚨 쿠팡 차단 로그: ${JSON.stringify(data)}`,
        price: 0, imageUrl: "", productUrl: "", isRocket: false
    }]});
    
  } catch (error) {
    return res.status(200).json({ results: [{
        title: `🚨 통신 에러: ${error.message}`,
        price: 0, imageUrl: "", productUrl: "", isRocket: false
    }]});
  }
}
