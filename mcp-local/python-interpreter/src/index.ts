import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { PythonShell } from "python-shell";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

const server = new Server(
  {
    name: "python-interpreter",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/*
 * List available tools.
 * We expose a single tool: "run_python"
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "run_python",
        description:
          "Execute a Python script and return the output (stdout and stderr).",
        inputSchema: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "The Python code to execute",
            },
          },
          required: ["code"],
        },
      },
      {
        name: "list_packages",
        description:
          "List all installed Python packages in the current environment.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "run_python_multithreaded",
        description:
          "Execute a Python script with increased timeout, suitable for complex computations. Supports threading and multiprocessing.",
        inputSchema: {
          type: "object",
          properties: {
             code: { type: "string", description: "The Python code to execute" },
             timeout_seconds: { type: "number", description: "Optional: Timeout in seconds (default: 3600)" }
          },
          required: ["code"]
        }
      }
    ],
  };
});

/*
 * Handle tool execution requests.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "list_packages") {
      let options: { pythonPath: string; cwd: string; } | undefined;
      try {
        // Determine python executable path
        let pythonPath = process.env.PYTHON_PATH || 'python3';
        
        // Check for local venv if PYTHON_PATH is not explicitly set
        if (!process.env.PYTHON_PATH) {
          const venvPath = "venv/bin/python";
          try {
              const fs = await import("fs"); 
              if (fs.existsSync(venvPath)) {
                  pythonPath = venvPath;
              }
          } catch (e) {
              // ignore fs errors
          }
        }

        let desiredCwd = '/app';
        try {
          const fs = await import("fs");
          if (!fs.existsSync(desiredCwd)) {
              desiredCwd = process.cwd();
          }
        } catch (e) {
          desiredCwd = process.cwd();
        }

        options = {
          pythonPath: pythonPath,
          cwd: desiredCwd
        };

        const code = `
import pkg_resources
installed_packages = pkg_resources.working_set
installed_packages_list = sorted(["%s==%s" % (i.key, i.version) for i in installed_packages])
print("\\n".join(installed_packages_list))
`;
        
        const messages = await PythonShell.runString(code, options);
        return {
          content: [
            {
              type: "text",
              text: messages ? messages.join("\n") : "No packages found or no output.",
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `Error listing packages: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
  }

  if (request.params.name === "run_python" || request.params.name === "run_python_multithreaded") {
    // Validate arguments using Zod
    const schema = z.object({
      code: z.string(),
      timeout_seconds: z.number().optional()
    });

    const validation = schema.safeParse(request.params.arguments);
    if (!validation.success) {
      throw new Error("Invalid arguments: 'code' is required and must be a string.");
    }

    let { code, timeout_seconds } = validation.data;
    // Remove fig.show() to prevent interactive backend errors
    code = code.replace(/fig\.show\(\)/g, "");
    
    // Add import sys if multithreaded and set recursion limit higher if needed
    if (request.params.name === "run_python_multithreaded") {
        code = `
import sys
sys.setrecursionlimit(2000)
import threading
import multiprocessing
# Ensure sufficient resources
` + code;
    }

    let options: any;
    try {
      // Determine python executable path
      let pythonPath = process.env.PYTHON_PATH || 'python3';
      
      // Check for local venv if PYTHON_PATH is not explicitly set
      if (!process.env.PYTHON_PATH) {
        const venvPath = "venv/bin/python";
        try {
            const fs = await import("fs"); 
            if (fs.existsSync(venvPath)) {
                pythonPath = venvPath;
            }
        } catch (e) {
            // ignore fs errors
        }
      }

      let desiredCwd = '/app';
      try {
        const fs = await import("fs");
        if (!fs.existsSync(desiredCwd)) {
            desiredCwd = process.cwd();
        }
      } catch (e) {
        desiredCwd = process.cwd();
      }

      // Default timeout
      let timeout = process.env.PYTHON_TIMEOUT_MS ? parseInt(process.env.PYTHON_TIMEOUT_MS, 10) : 600000;
      
      // Override timeout if provided in args or if using multithreaded tool
      if (timeout_seconds) {
          timeout = timeout_seconds * 1000;
      } else if (request.params.name === "run_python_multithreaded") {
          // Default to 1 hour (3600000ms) for multithreaded tasks
          timeout = 3600000;
      }

      options = {
        pythonPath: pythonPath,
        cwd: desiredCwd,
        // python-shell timeout is in ms
        // Note: PythonShell's timeout might kill the process abruptly.
        // We use child_process options indirectly via PythonShell
      };
      
      // PythonShell runString doesn't accept timeout in options directly?
      // It uses childProcess options.
      // But we can implement a custom promise wrapper with timeout if needed.
      // Let's rely on standard execution but monitor time.
      
      // Update runWithTimeout implementation
      const runWithTimeout = (script: string, opts: any, timeLimit: number) => {
          return new Promise<string[]>((resolve, reject) => {
              let timer: NodeJS.Timeout;

              // Use PythonShell constructor in a way that allows us to manage execution
              // PythonShell.runString uses a temporary file internally.
              // We can replicate that logic or use runString properly.
              // PythonShell.runString returns a Promise<string[]>, BUT it creates a child process.
              // The library does not expose the child process easily via runString.

              // So we use standard child_process.spawn for full control, or PythonShell instance.
              // Given existing code uses PythonShell, let's use PythonShell instance.

              // Create temporary file
              const randomName = crypto.randomBytes(8).toString('hex');
              const tempFileName = `mcp_python_${randomName}.py`;
              const tempDir = os.tmpdir();
              const tempFilePath = path.join(tempDir, tempFileName);
              
              fs.writeFileSync(tempFilePath, script);

              const pyshell = new PythonShell(tempFileName, {
                  ...opts,
                  mode: 'text',
                  scriptPath: tempDir
              });

              let stdout_messages: string[] = [];
              let stderr_messages: string[] = [];

              pyshell.on('message', (message: string) => {
                  stdout_messages.push(message);
              });

              pyshell.on('stderr', (stderr: string) => {
                  stderr_messages.push(stderr);
              });
              
              if (timeLimit > 0) {
                  timer = setTimeout(() => {
                      if (pyshell.childProcess) {
                          console.error(`[Python] Timeout reached (${timeLimit}ms). Killing process ${pyshell.childProcess.pid}`);
                          pyshell.childProcess.kill(); 
                      }
                      reject(new Error(`Execution timed out after ${timeLimit}ms`));
                  }, timeLimit);
              }

              pyshell.end((err: any, code: any, signal: any) => {
                  if (timer) clearTimeout(timer);
                  try { fs.unlinkSync(tempFilePath); } catch(e) {}

                  if (err) {
                      // Attach logs to error object for better debugging
                      err.logs = [...stdout_messages, ...stderr_messages];
                      return reject(err);
                  }
                  resolve(stdout_messages);
              });
          });
      };
      const messages = await runWithTimeout(code, options, timeout);

      // combine messages
      let output = messages ? messages.join("\n") : "";

      // Check if the code generated any files in /app/data, /app/plots or /tmp and create/copy a link
      // Supports /app/data/file.png, /app/plots/file.png and /tmp/file.png
      const filePattern = /((\/app\/data\/|\/app\/plots\/|\/tmp\/))([\w-]+\.(png|jpg|jpeg|gif|svg|html))/g;
      const matchIterator = output.matchAll(filePattern);
      const matches = [...matchIterator];
      
      if (matches.length > 0) {
          const fs = await import("fs");
          const path = await import("path");
          
          // Ensure /app/data exists
          if (!fs.existsSync('/app/data')) {
              try { fs.mkdirSync('/app/data', { recursive: true }); } catch (e) {}
          }

          const uniquePaths = [...new Set(matches.map(m => m[0]))]; // Dedup full paths like /tmp/file.png
          
          for (const fullPath of uniquePaths) {
              const fs = await import("fs");
              const path = await import("path");
              const filename = path.basename(fullPath);
              const ext = path.extname(filename).toLowerCase();
              let servePath = `/data/${filename}`;

              // If file is in /app/plots, no need to copy, serve directly if route exists
              // Or copy to /app/data?
              // The user wants /app/plots URL to work.
              if (fullPath.startsWith('/app/plots/')) {
                  servePath = `/app/plots/${filename}`;
              } else if (fullPath.startsWith('/tmp/')) {
                  // Copy from /tmp to /app/data
                  // Ensure /app/data exists
                  if (!fs.existsSync('/app/data')) {
                      try { fs.mkdirSync('/app/data', { recursive: true }); } catch (e) {}
                  }

                  const destPath = path.join('/app/data', filename);
                  try {
                      if (fs.existsSync(fullPath)) {
                          fs.copyFileSync(fullPath, destPath);
                      }
                  } catch (e) {
                      console.error(`Failed to copy ${fullPath} to ${destPath}:`, e);
                  }
                  servePath = `/data/${filename}`;
              }
              
              // Append markdown to display the image or link
              // Use a query param to avoid caching if the file updates
              // Use DOMAIN_SERVER to create absolute URL if available
              const domainServer = process.env.DOMAIN_SERVER || '';
              const fullServePath = domainServer ? `${domainServer}${servePath}` : servePath;

              if (ext === '.html') {
                  output += `\n\n[View Interactive Chart](${fullServePath}?t=${Date.now()})`;
              } else {
                  output += `\n\n![Generated Image](${fullServePath}?t=${Date.now()})`;
              }
          }
      }

      return {
        content: [
          {
            type: "text",
            text: output,
          },
        ],
      };
    } catch (error: any) {
      // If Python execution fails, return the error message
      let errorMessage = `Error executing Python code:\n${error.message || String(error)}`;
      errorMessage += `\n\nCWD: ${options?.cwd || (await import("process")).cwd()}`;
      
      // If we have traceback, use that instead of generic message if possible, or append it
      if (error.traceback) {
        errorMessage = `Python Traceback:\n${error.traceback}`;
      }

      // If we have partial logs (stdout before crash), include them
      if (error.logs && Array.isArray(error.logs) && error.logs.length > 0) {
        const partialOutput = error.logs.join("\n");
        errorMessage = `Output before error:\n${partialOutput}\n\n${errorMessage}`;
      }

      return {
        content: [
          {
            type: "text",
            text: errorMessage,
          },
        ],
        isError: true,
      };
    }
  }

  throw new Error(`Tool not found: ${request.params.name}`);
});

/*
 * Start the server using Stdio transport.
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Python Interpreter MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
