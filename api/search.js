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
    console.log("환경변수(API 키) 누락");
    return res.status(200).json({ results: [] });
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
    
    // 💡 [핵심] 쿠팡이 뱉어낸 진짜 에러 메시지를 Vercel 로그에 기록합니다.
    console.log("=== 쿠팡 응답 로그 ===");
    console.log(JSON.stringify(data));
    
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
    
    return res.status(200).json({ results: [] });
  } catch (error) {
    console.error("=== Vercel 에러 ===", error);
    return res.status(200).json({ results: [] });
  }
}
