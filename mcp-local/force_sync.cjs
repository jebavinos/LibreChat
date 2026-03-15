const { spawn } = require("child_process");
const path = require("path");

const serverPath = path.resolve(__dirname, "dist/index.js");
const proc = spawn("node", [serverPath], {
  env: process.env,
  stdio: ["pipe", "pipe", "inherit"]
});

let buffer = "";

proc.stdout.on("data", (data) => {
  buffer += data.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop(); // keep last partial line

  lines.forEach(line => {
    if (!line.trim()) return;
    try {
      const json = JSON.parse(line);
      // Wait for initialize response
      if (json.id === 1 && json.result) {
        console.log("Initialized. Sending tool list request...");
        const listTools = {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/list",
            params: {}
        };
        proc.stdin.write(JSON.stringify(listTools) + "\n");
      }
      // Wait for tools list response
      else if (json.id === 2 && json.result) {
        console.log("Tools listed. Sending sync_instruments call...");
        const syncRequest = {
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: {
                name: "sync_instruments",
                arguments: {}
            }
        };
        proc.stdin.write(JSON.stringify(syncRequest) + "\n");
      }
      // Wait for sync result
      else if (json.id === 3) {
        if (json.error) {
            console.error("Sync Failed:", JSON.stringify(json.error, null, 2));
        } else {
            console.log("Sync Result:", JSON.stringify(json.result, null, 2));
        }
        process.exit(0);
      }
    } catch (e) {
      // ignore parse errors for partial json
    }
  });
});

const initMsg = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "force-sync-client", version: "1.0.0" }
  }
};

proc.stdin.write(JSON.stringify(initMsg) + "\n");
