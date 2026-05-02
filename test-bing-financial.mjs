import axios from 'axios';
import * as cheerio from 'cheerio';
async function test() {
  const baseQuery = "Ashoka Buildcon revenue EBITDA net income balance sheet FY2024 FY2023 FY2022 FY2021 FY2020";
  const searchQuery2 = `${baseQuery} finance yahoo bloomberg reuters cnbc wsj investing moneycontrol screener economictimes`;
  try {
    const response2 = await axios.get('https://www.bing.com/search', {
      params: { q: searchQuery2 },
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; rv:114.0) Gecko/20100101 Firefox/114.0' }
    });
    const $2 = cheerio.load(response2.data);
    $2('.b_algo').each((i, elem) => {
      const titleElem = $2(elem).find('h2 a');
      console.log(titleElem.attr('href'));
    });
  } catch(e) { }
}
test();
