import axios from 'axios';

const instances = [
  'https://searx.work/search',
  'https://paulgo.io/search',
  'https://search.mdosch.de/search',
  'https://search.inetol.net/search',
  'https://priv.au/search',
  'https://search.bus-hit.me/search'
];

async function test() {
  const query = "Ashoka Buildcon revenue EBITDA net income balance sheet FY2024 FY2023 FY2022 FY2021 FY2020";
  for (const url of instances) {
    try {
      const response = await axios.get(url, {
        params: { q: query, format: 'json' },
        timeout: 5000
      });
      if (response.data && response.data.results && response.data.results.length > 0) {
        console.log(`Success on ${url}: found ${response.data.results.length} results`);
        console.log(response.data.results[0].title);
        return;
      }
    } catch(e) {
      console.log(`Failed on ${url}: ${e.message}`);
    }
  }
}
test();
