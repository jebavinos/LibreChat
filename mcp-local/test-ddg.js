import axios from 'axios';
import * as cheerio from 'cheerio';

async function test() {
  try {
    const response = await axios.post('https://html.duckduckgo.com/html/', 'q=' + encodeURIComponent('nvidia stock'), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
      }
    });
    console.log(response.data.substring(0, 500));
    const $ = cheerio.load(response.data);
    const results = [];
    $('.result__body').each((i, elem) => {
      const titleElem = $(elem).find('.result__title .result__a');
      const snippetElem = $(elem).find('.result__snippet');
      results.push({
        title: titleElem.text().trim(),
        snippet: snippetElem.text().trim()
      });
    });
    console.log("Found:", results.length);
  } catch (e) {
    console.log("Error", e.message);
  }
}
test();
