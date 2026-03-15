const { spawn } = require('child_process');
const path = require('path');

const serverPath = path.join(__dirname, 'src/index.ts');
const tsxPath = path.join(__dirname, 'node_modules/tsx/dist/cli.mjs');

console.error(`Spawning server: node ${tsxPath} ${serverPath}`);

const server = spawn('node', [tsxPath, serverPath], {
  env: process.env,
  stdio: ['pipe', 'pipe', process.stderr]
});

let buffer = '';

server.stdout.on('data', (data) => {
  buffer += data.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop();

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      console.error('Received:', msg);
      
      if (msg.method === 'notifications/initialized') {
          console.error('Server initialized.');
      }
      
      if (msg.id === 1) { // Response to initialize
          // Send initialized notification
          server.stdin.write(JSON.stringify({
              jsonrpc: '2.0',
              method: 'notifications/initialized'
          }) + '\n');
          
          // Request tools
          console.error('Requesting tools...');
          server.stdin.write(JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              method: 'tools/list'
          }) + '\n');
      }
      
      if (msg.id === 2) {
          console.log('TOOLS LIST:');
          const tools = msg.result.tools;
          tools.forEach(t => console.log(`- ${t.name}: ${t.description}`));
          process.exit(0);
      }
      
    } catch (e) {
      console.error('Parse error or non-JSON line:', line);
    }
  }
});

// Send initialize request
const initReq = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: {
      name: 'test-client',
      version: '1.0.0'
    }
  }
};
console.error("Sending initialize request...");
server.stdin.write(JSON.stringify(initReq) + '\n');
