const fs = require('fs');

const html = fs.readFileSync('amazon-test.html', 'utf8');

// The Amazon colorImages structure looks like:
// 'colorImages': { 'initial': [{"hiRes":"...","large":"..."}, ...] }
// Let's try to extract it
const match = /'colorImages':\s*({.*?}),\n/s.exec(html);
if (match) {
  console.log("Found colorImages object length:", match[1].length);
  try {
    const data = eval('(' + match[1] + ')');
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.log("Failed to parse:", e.message);
  }
} else {
  console.log("colorImages not found");
}
