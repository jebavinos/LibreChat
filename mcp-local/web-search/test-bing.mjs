import axios from 'axios';
import * as cheerio from 'cheerio';
async function test() {
  const query = "Ashoka Buildcon revenue EBITDA net income balance sheet FY2024 FY2023 FY2022 FY2021 FY2020";
  try {
    const response = await axios.get('https://www.bing.com/search', {
      params: { q: query },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; rv:114.0) Gecko/20100101 Firefox/114.0',
        'Accept-Language': 'en-US,en;q=0.5',
      }
    });
    const $ = cheerio.load(response.data);
    const results = [];
    $('.b_algo').each((i, elem) => {
      const titleElem = $(elem).find('h2 a');
      const snippetElem = $(elem).find('.b_caption p, .b_algoSlug, .b_lineclamp2, .b_lineclamp3, .b_lineclamp4');
      const link = titleElem.attr('href');
      const title = titleElem.text().trim();
      const snippet = snippetElem.text().trim();

      if (title && link) {
        results.push({ title, link, snippet });
      }
    });
    if(results.length === 0) {
      console.log(response.data.substring(0, 1000));
    } else {
      console.log("Bing found:", results.length);
      console.log(JSON.stringify(results.slice(0, 2), null, 2));
    }
  } catch(e) { console.log(e.message); }
}
test();
