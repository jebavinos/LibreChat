
const { spawn } = require("child_process");
const path = require("path");

const serverPath = path.resolve(__dirname, "dist/index.js");
const proc = spawn("node", [serverPath], {
  env: process.env,
  stdio: ["pipe", "pipe", "inherit"]
});

const buffer = [];

proc.stdout.on("data", (data) => {
  const str = data.toString();
  console.log("Received:", str);
  try {
    const json = JSON.parse(str);
    if (json.result && json.result.tools) {
        console.log("Tools found:", json.result.tools.map(t => t.name));
        process.exit(0);
    }
  } catch (e) {
      // not full json yet or multiple messages
  }
});

const initMsg = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "debug", version: "1.0" }
  }
};

const listToolsMsg = {
  jsonrpc: "2.0",
  id: 2,
  method: "tools/list",
  params: {}
};

// Send initialize
const msg1 = JSON.stringify(initMsg) + "\n";
proc.stdin.write(msg1);

// Wait a bit then list tools (MCP needs initialized first)
setTimeout(() => {
    // Send initialized notification
    proc.stdin.write(JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized"
    }) + "\n");
    
    // Request tools
    proc.stdin.write(JSON.stringify(listToolsMsg) + "\n");
}, 1000);

setTimeout(() => {
    console.log("Timeout.");
    process.exit(1);
}, 5000);
