const scraperService = require('./services/scraperService');

(async () => {
  const result = await scraperService.validateAndScrape("https://www.amazon.in/Anti-Tarnish-Necklace-Delicate-Anniversary-Valentines/dp/B0GN9529M4?s=bazaar");
  console.log(JSON.stringify(result, null, 2));
})();
