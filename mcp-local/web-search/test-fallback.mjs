import axios from 'axios';
async function performDuckDuckGoFallback(query) {
  try {
    const url = 'https://api.duckduckgo.com/';
    const response = await axios.get(url, {
      params: {
        q: query,
        format: 'json',
        no_html: 1,
        skip_disambig: 1
      },
      headers: {
        'User-Agent': 'LibreChat-MCP-Fallback/1.0'
      }
    });

    const data = response.data;
    const results = [];

    if (data.AbstractText) {
      results.push({
        title: data.Heading || query,
        link: data.AbstractURL || '',
        snippet: data.AbstractText
      });
    }

    if (data.RelatedTopics && data.RelatedTopics.length > 0) {
      for (const topic of data.RelatedTopics) {
        if (topic.Text && topic.FirstURL) {
          results.push({
            title: topic.Text.split(' - ')[0] || topic.Text,
            link: topic.FirstURL,
            snippet: topic.Text
          });
        }
      }
    }

    if (results.length === 0) {
      // Let's also try Wikipedia if DDG abstract is empty
      const wikiUrl = 'https://en.wikipedia.org/w/api.php';
      const wikiResponse = await axios.get(wikiUrl, {
        params: {
          action: 'query',
          list: 'search',
          srsearch: query,
          utf8: '',
          format: 'json'
        },
        headers: {
          'User-Agent': 'LibreChat-MCP-Fallback/1.0'
        }
      });

      const wikiResults = wikiResponse.data?.query?.search || [];
      for (const item of wikiResults) {
        results.push({
          title: item.title,
          link: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title)}`,
          snippet: item.snippet.replace(/<[^>]*>?/gm, '') // strip HTML from wiki snippet
        });
      }
    }

    if (results.length === 0) {
      return 'No results found (Fallback DDG/Wiki). Search queries might be too specific or blocked.';
    }

    return JSON.stringify(results.slice(0, 5), null, 2);
  } catch (fallbackError) {
     return `Error performing search (Fallback DDG/Wiki): ${fallbackError.message}`;
  }
}
performDuckDuckGoFallback('nvidia stock').then(console.log);
