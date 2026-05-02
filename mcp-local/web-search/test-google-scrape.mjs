import axios from 'axios';
import * as cheerio from 'cheerio';

async function test() {
  try {
    const response = await axios.get('https://www.google.com/search', {
      params: { q: 'nvidia stock' },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
      }
    });
    const $ = cheerio.load(response.data);
    const results = [];
    $('#main .g').each((i, elem) => {
      const titleElem = $(elem).find('h3');
      const snippetElem = $(elem).find('.VwiC3b, .s3v9rd');
      const linkElem = $(elem).find('a');
      const link = linkElem.attr('href');
      const title = titleElem.text().trim();
      const snippet = snippetElem.text().trim();

      if (title && link) {
        results.push({ title, link, snippet });
      }
    });

    // fallback for normal google layout
    if(results.length === 0) {
      $('.tF2Cxc').each((i, elem) => {
         const parent = $(elem).closest('.g, .jfp3ef');
         const title = parent.find('h3').text().trim();
         const link = parent.find('a').first().attr('href');
         const snippet = $(elem).text().trim();
         if(title && link) results.push({title, link, snippet});
      });
    }
    
    // yet another selector
    if(results.length === 0) {
       $('.egMi0').each((i, elem) => {
         const parent = $(elem).closest('.g');
         const title = parent.find('h3').text().trim();
         const link = parent.find('a').first().attr('href');
         const snippet = parent.text().trim();
         if(title && link) results.push({title, link, snippet});
       });
    }

    console.log("Found:", results.length);
    console.log(JSON.stringify(results.slice(0, 2), null, 2));
  } catch (e) {
    if (e.response) {
      console.log("Error", e.response.status, e.response.statusText);
    } else {
      console.log("Error", e.message);
    }
  }
}
test();
