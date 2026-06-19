const fs = require('fs');

async function testFetch() {
  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1'
  };
  const response = await fetch("https://www.amazon.in/Anti-Tarnish-Necklace-Delicate-Anniversary-Valentines/dp/B0GN9529M4?s=bazaar", {
    headers: HEADERS,
    signal: AbortSignal.timeout(10000)
  });
  const html = await response.text();
  fs.writeFileSync('amazon-test.html', html);
  console.log("Written to amazon-test.html. Length:", html.length);
}

testFetch();
