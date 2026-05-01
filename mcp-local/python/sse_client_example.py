import requests

def stream_ticks(url):
    with requests.get(url, stream=True) as r:
        r.raise_for_status()
        for line in r.iter_lines(decode_unicode=True):
            if not line:
                continue
            if line.startswith('data: '):
                payload = line[len('data: '):]
                print('Tick:', payload)

if __name__ == '__main__':
    url = 'http://localhost:6789/ticks'
    print(f'Connecting to {url}...')
    stream_ticks(url)
