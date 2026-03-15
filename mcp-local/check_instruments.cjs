
const { spawn } = require("child_process");
const path = require("path");

const serverPath = path.resolve(__dirname, "dist/index.js");
const proc = spawn("node", [serverPath], {
  env: process.env,
  stdio: ["pipe", "pipe", "inherit"]
});

proc.stdout.on("data", (data) => {
  const str = data.toString();
  try {
    const json = JSON.parse(str);
    if (json.result && json.result.tools) {
        console.log("Tools received.");
        // Send a tool call request
        const request = {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: {
                name: "query",
                arguments: {
                    sql: "SELECT instrument_token, tradingsymbol, exchange FROM instruments WHERE tradingsymbol = 'TCS'"
                }
            }
        };
        proc.stdin.write(JSON.stringify(request) + "\n");
    } else if (json.id === 2 && json.result) {
        console.log("Query Result:", JSON.stringify(json.result, null, 2));
        process.exit(0);
    }
  } catch (e) {
      // console.log("Raw:", str);
  }
});

const initMsg = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
      protocolVersion: "2024-11-05", // Check latest version or use what works
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" }
  }
};

proc.stdin.write(JSON.stringify(initMsg) + "\n");

const listToolsMsg = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {}
};
setTimeout(() => {
    proc.stdin.write(JSON.stringify(listToolsMsg) + "\n");
}, 500);
