import axios from 'axios';
import * as cheerio from 'cheerio';

async function test() {
  try {
    const response = await axios.get('https://lite.duckduckgo.com/lite/', {
      params: { q: 'nvidia stock' },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });
    console.log(response.data.substring(0, 500));
    const $ = cheerio.load(response.data);
    const results = [];
    $('tr').each((i, elem) => {
      const titleElem = $(elem).find('.result-snippet');
      if (titleElem.length > 0) { console.log(titleElem.text()); }
    });
  } catch (e) {
    if (e.response) {
      console.log("Error", e.response.status, e.response.statusText);
      console.log(e.response.data.substring(0, 500));
    } else {
      console.log("Error", e.message);
    }
  }
}
test();
