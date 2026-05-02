const fs = require('fs');

const content = `import { Server } from "@modelcontextprotocol/sdk/server/index.js";
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
      },
      {
        name: "generate_interactive_dashboard",
        description: "Takes compiled system/stock/financial data and generates a rich, interactive HTML dashboard using Plotly. Returns a markdown link to display the dashboard in chat.",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "The title of the dashboard" },
            data_source: { type: "string", description: "Either a literal JSON string containing the data, OR an absolute file path to a CSV or JSON file (e.g., /app/data/my_data.csv). To save tokens, prefer saving data to a file first via Python/Postgres and passing the file path here." },
            layout: { 
              type: "string", 
              enum: ["line_chart", "bar_chart", "financial_candlestick", "multi_panel", "html_grid", "custom_dashboard"],
              description: "The type of visualization to generate. Use 'custom_dashboard' for full control over UI components using dashboard_config."
            },
            filename: { type: "string", description: "The output html filename, e.g., 'summary_dashboard.html'" },
            dashboard_config: { type: "string", description: "Optional JSON string defining the UI layout when layout='custom_dashboard'. Use this to build 12-column CSS grid layouts where you control placement, sizing, and content. The root must have a 'sections' array. **CRITICAL: Every section object MUST have a 'section_heading' string property properly labeling the module.** Each section can have: 'type' ('text', 'kpi_grid', 'chart_grid', 'table', 'summary', 'raw_html'). You MUST use 'wrapper_class' to explicitly set size and position (e.g. 'col-span-12 md:col-span-8' for a wide section, or 'col-span-12 md:col-span-4' for a smaller side section). Use 'grid_class' in 'kpi_grid' to specify box sizing (e.g. 'grid grid-cols-1 gap-4' or 'grid grid-cols-2 lg:grid-cols-4'). For 'table': 'headers' (array), 'rows' (array of arrays). For 'raw_html': 'html' (string). The LLM MUST intelligently color-code items (e.g. kpi_grid) using 'style': 'green' (positive), 'red' (negative), 'amber' (warning), 'purple' (highlight). Also, for text and summary blocks, use HTML tags (<ul>, <li>, <b>, <i>, <br>) directly in the text content to provide indentation, highlights, bullet points, and high readability." }
          },
          required: ["title", "data_source", "layout", "filename"]
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

        const code = \`
import pkg_resources
installed_packages = pkg_resources.working_set
installed_packages_list = sorted(["%s==%s" % (i.key, i.version) for i in installed_packages])
print("\\n".join(installed_packages_list))
\`;
        
        const messages = await PythonShell.runString(code, options);
        return {
          content: [
            {
              type: "text",
              text: messages ? messages.join("\\n") : "No packages found or no output.",
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: \`Error listing packages: \${error.message}\`,
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
    code = code.replace(/fig\\.show\\(\\)/g, "");
    
    // Add import sys if multithreaded and set recursion limit higher if needed
    if (request.params.name === "run_python_multithreaded") {
        code = \`
import sys
sys.setrecursionlimit(2000)
import threading
import multiprocessing
# Ensure sufficient resources
\` + code;
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
              const tempFileName = \`mcp_python_\${randomName}.py\`;
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
                          console.error(\`[Python] Timeout reached (\${timeLimit}ms). Killing process \${pyshell.childProcess.pid}\`);
                          pyshell.childProcess.kill(); 
                      }
                      reject(new Error(\`Execution timed out after \${timeLimit}ms\`));
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
      let output = messages ? messages.join("\\n") : "";

      // Check if the code generated any files in /app/data, /app/plots or /tmp and create/copy a link
      // Supports /app/data/file.png, /app/plots/file.png and /tmp/file.png
      const filePattern = /((\\/app\\/data\\/|\\/app\\/plots\\/|\\/tmp\\/))([\\w-]+\\.(png|jpg|jpeg|gif|svg|html))/g;
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
              let servePath = \`/data/\${filename}\`;

              // If file is in /app/plots, no need to copy, serve directly if route exists
              // Or copy to /app/data?
              // The user wants /app/plots URL to work.
              if (fullPath.startsWith('/app/plots/')) {
                  servePath = \`/app/plots/\${filename}\`;
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
                      console.error(\`Failed to copy \${fullPath} to \${destPath}:\`, e);
                  }
                  servePath = \`/data/\${filename}\`;
              }
              
              // Append markdown to display the image or link
              // Use a query param to avoid caching if the file updates
              // Use DOMAIN_SERVER to create absolute URL if available
              const domainServer = process.env.DOMAIN_SERVER || '';
              const fullServePath = domainServer ? \`\${domainServer}\${servePath}\` : servePath;

              if (ext === '.html') {
                  output += \`\\n\\n[View Interactive Chart](\${fullServePath}?t=\${Date.now()})\`;
              } else {
                  output += \`\\n\\n![Generated Image](\${fullServePath}?t=\${Date.now()})\`;
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
      let errorMessage = \`Error executing Python code:\\n\${error.message || String(error)}\`;
      errorMessage += \`\\n\\nCWD: \${options?.cwd || (await import("process")).cwd()}\`;
      
      // If we have traceback, use that instead of generic message if possible, or append it
      if (error.traceback) {
        errorMessage = \`Python Traceback:\\n\${error.traceback}\`;
      }

      // If we have partial logs (stdout before crash), include them
      if (error.logs && Array.isArray(error.logs) && error.logs.length > 0) {
        const partialOutput = error.logs.join("\\n");
        errorMessage = \`Output before error:\\n\${partialOutput}\\n\\n\${errorMessage}\`;
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

  if (request.params.name === "generate_interactive_dashboard") {
    const schema = z.object({
      title: z.string(),
      data_source: z.string(),
      layout: z.enum(["line_chart", "bar_chart", "financial_candlestick", "multi_panel", "html_grid", "custom_dashboard"]),
      filename: z.string(),
      dashboard_config: z.string().optional()
    });

    const validation = schema.safeParse(request.params.arguments);
    if (!validation.success) {
      throw new Error(\`Invalid arguments: \${validation.error.message}\`);
    }

    const { title, data_source, layout, filename, dashboard_config } = validation.data;

    let pythonPath = process.env.PYTHON_PATH || 'python3';
    let desiredCwd = '/app';

    const code = \`
import json
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import os
import csv

def generate_interactive_dashboard(title, data_source, layout, filename, dashboard_config_json=None):
    output_dir = "/app/data"
    os.makedirs(output_dir, exist_ok=True)
    filepath = os.path.join(output_dir, filename)

    def get_any(d, keys_list, default_val=None):
        if not isinstance(d, dict): return default_val
        for k in keys_list:
            if k in d: return d[k]
        return default_val

    config_data = {}
    if dashboard_config_json:
        try:
            config_data = json.loads(dashboard_config_json)
        except Exception as e:
            print("Error parsing dashboard_config:", e)

    if layout == "custom_dashboard" or layout == "html_grid":
        # Start HTML skeleton
        html = f"""
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>{title}</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
            <style>
                body {{ font-family: 'Inter', sans-serif; background: #0a0e17; color: #e2e8f0; }}
                .card {{ background: linear-gradient(145deg, #1e293b 0%, #0f172a 100%); border: 1px solid #334155; border-radius: 16px; padding: 24px; backdrop-filter: blur(10px); }}
                .card:hover {{ border-color: #38bdf8; box-shadow: 0 0 30px rgba(56, 189, 248, 0.15); transition: all 0.3s ease; }}
                .header-gradient {{ background: linear-gradient(to right, #1e3a8a, #1e40af, #1e3a8a); border-bottom: 1px solid #1d4ed8; }}
                .kpi-box {{ background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); border-radius: 12px; padding: 20px; text-align: center; }}
                .kpi-box.green {{ background: linear-gradient(135deg, #065f46 0%, #10b981 100%); }}
                .kpi-box.amber {{ background: linear-gradient(135deg, #92400e 0%, #f59e0b 100%); }}
                .kpi-box.red {{ background: linear-gradient(135deg, #991b1b 0%, #ef4444 100%); }}
                .kpi-box.purple {{ background: linear-gradient(135deg, #5b21b6 0%, #a855f7 100%); }}
                ul {{ list-style-type: disc; padding-left: 1.5rem; margin-top: 0.5rem; margin-bottom: 0.5rem; }}
                ol {{ list-style-type: decimal; padding-left: 1.5rem; margin-top: 0.5rem; margin-bottom: 0.5rem; }}
                li {{ margin-bottom: 0.25rem; }}
                b, strong {{ color: #60a5fa; }}
                i, em {{ color: #94a3b8; }}
                iframe {{ width: 100%; height: 500px; border: none; border-radius: 8px; background: transparent; }}
                ::-webkit-scrollbar {{ width: 8px; }}
                ::-webkit-scrollbar-track {{ background: #0f172a; }}
                ::-webkit-scrollbar-thumb {{ background: #3b82f6; border-radius: 4px; }}
            </style>
        </head>
        <body class="min-h-screen">
            <!-- Header -->
            <header class="header-gradient sticky top-0 z-50">
                <div class="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div class="flex items-center gap-4">
                        <div class="text-2xl font-black text-white tracking-tight">DASHBOARD</div>
                        <div class="h-8 w-px" style="background:#60a5fa;"></div>
                        <div>
                            <div class="text-sm font-bold" style="color:#bfdbfe;">{title.upper()}</div>
                            <div class="text-xs" style="color:#93c5fd;">Interactive Analysis</div>
                        </div>
                    </div>
                </div>
            </header>

            <!-- Main Content -->
            <main class="max-w-7xl mx-auto px-6 py-8">
                <!-- Apply a 12-column grid if root sections layout demands it, else blocks -->
                <div class="grid grid-cols-12 gap-6">
        """

        # Fallback to simple grid if layout is html_grid but no sections provided
        sections = config_data.get("sections", [])
        
        # Legacy support: if html_grid and no config_data sections, try parsing data_source as a list of charts
        if not sections and layout == "html_grid":
            try:
                paths = json.loads(data_source)
                if isinstance(paths, list):
                    charts = [{{"name": os.path.basename(p), "path": p}} for p in paths]
                    sections.append({{"type": "chart_grid", "wrapper_class": "col-span-12", "charts": charts}})
            except:
                pass

        for sec in sections:
            sec_type = str(get_any(sec, ['type', 'module', 'kind', 'component'], ''))
            # Force recognize common section typos
            if 'kpi' in sec_type: sec_type = 'kpi_grid'
            elif 'text' in sec_type or 'paragraph' in sec_type: sec_type = 'text'
            elif 'sum' in sec_type or 'takeaway' in sec_type: sec_type = 'summary'
            elif 'tab' in sec_type: sec_type = 'table'
            elif 'chart' in sec_type or 'graph' in sec_type or 'plot' in sec_type: sec_type = 'chart_grid'

            wrapper = get_any(sec, ['wrapper_class', 'className', 'wrapper'], 'col-span-12')
            
            html += f'<div class="{wrapper}">\\n'
            
            heading = get_any(sec, ['section_heading', 'heading', 'title', 'header'])
            if heading:
                html += f'<h2 class="text-xl font-bold text-blue-300 mb-4 flex items-center gap-2 uppercase tracking-wide border-b border-blue-900 pb-2">{heading}</h2>\\n'

            if sec_type == 'heading':
                text = get_any(sec, ['text', 'content', 'value', 'title', 'heading'], '')
                style = get_any(sec, ['style', 'className'], 'text-xl font-bold text-blue-300 mb-4 flex items-center gap-2 uppercase tracking-wide')
                icon = get_any(sec, ['icon', 'emoji'], '')
                html += f'<h2 class="{style}">{icon} {text}</h2>\\n'
                
            elif sec_type == 'text':
                text = str(get_any(sec, ['text', 'content', 'value', 'body', 'description'], '')).replace('\\n', '<br>')
                style = get_any(sec, ['style'], 'text-slate-300 mb-4 bg-slate-800/50 p-4 rounded-lg border border-slate-700 backdrop-blur-sm whitespace-pre-wrap')
                html += f'<div class="{style}">{text}</div>\\n'
                
            elif sec_type == 'summary':
                text = str(get_any(sec, ['text', 'content', 'value', 'summary', 'description', 'body'], '')).replace('\\n', '<br>')
                title = get_any(sec, ['title', 'heading', 'name', 'label'], 'Summary')
                html += f'''
                <div class="card mb-4">
                    <h3 class="text-sm font-bold text-blue-400 mb-2 uppercase">{title}</h3>
                    <p class="text-slate-200 text-sm leading-relaxed whitespace-pre-wrap">{text}</p>
                </div>
                '''
                
            elif sec_type == 'kpi_grid':
                kpis = get_any(sec, ['kpis', 'items', 'data', 'metrics', 'values', 'cards'], [])
                
                grid_class = get_any(sec, ['grid_class', 'grid_classes', 'className', 'wrapper_class'], "grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-4")
                
                html += f'<div class="{grid_class}">\\n'
                for kpi in kpis:
                    if isinstance(kpi, dict):
                        label = get_any(kpi, ['label', 'name', 'title', 'key', 'metric'], '')
                        val = str(get_any(kpi, ['value', 'val', 'amount', 'number'], ''))
                        
                        # Intelligent fallback: If label or value wasn't caught, pick the first two non-style keys
                        if not label and not val:
                            keys = [k for k in kpi.keys() if k not in ('style', 'color', 'class')]
                            if len(keys) >= 1:
                                label = keys[0].replace('_', ' ').title()
                                val = str(kpi[keys[0]])
                            if len(keys) >= 2:
                                label = str(kpi[keys[0]])
                                val = str(kpi[keys[1]])
                        
                        kpi_style = get_any(kpi, ['style', 'color', 'class'], '')
                        html += f'<div class="kpi-box {kpi_style}"><div class="text-xs font-medium text-white/80">{label}</div><div class="text-xl font-black text-white mt-1">{val}</div></div>\\n'
                    else:
                         html += f'<div class="kpi-box"><div class="text-xl font-black text-white mt-1">{str(kpi)}</div></div>\\n'
                html += '</div>\\n'
                
            elif sec_type == 'table':
                headers = get_any(sec, ['headers', 'columns', 'cols', 'fields'], [])
                rows = get_any(sec, ['rows', 'data', 'items', 'values', 'records'], [])
                title = get_any(sec, ['title', 'name', 'heading'], '')
                
                # Intelligent fallback if rows are dictionaries
                if rows and isinstance(rows[0], dict):
                    if not headers:
                        headers = list(rows[0].keys())
                    new_rows = []
                    for r in rows:
                        new_rows.append([str(r.get(h, '')) for h in headers])
                    rows = new_rows

                title_html = f'<h3 class="text-lg font-bold text-blue-300 mb-4">📊 {title}</h3>' if title else ''
                
                html += f'''
                <div class="card mb-4 overflow-x-auto">
                    {title_html}
                    <table class="w-full text-sm text-left">
                        <thead class="text-xs text-blue-300 border-b border-slate-600 bg-slate-800/50">
                            <tr>
                '''
                for h in headers:
                    html += f'                                <th class="py-3 px-4">{h}</th>\\n'
                html += '''
                            </tr>
                        </thead>
                        <tbody class="text-slate-300 divide-y divide-slate-700/50">
                '''
                for r in rows:
                    if isinstance(r, list):
                        html += '                            <tr class="hover:bg-blue-500/10 transition-colors">\\n'
                        for c in r:
                            html += f'                                <td class="py-2 px-4">{c}</td>\\n'
                        html += '                            </tr>\\n'
                html += '''
                        </tbody>
                    </table>
                </div>
                '''
                
            elif sec_type == 'chart_grid':
                charts = get_any(sec, ['charts', 'items', 'plots', 'graphs', 'data'], [])
                grid_classes = get_any(sec, ['style', 'className', 'grid_class'], 'grid grid-cols-1 lg:grid-cols-2 gap-6')
                html += f'<div class="{grid_classes}">\\n'
                for chart in charts:
                    if isinstance(chart, dict):
                        name = get_any(chart, ['name', 'title', 'label', 'heading'], 'Widget')
                        path = get_any(chart, ['path', 'url', 'src', 'file', 'link'], '')
                    elif isinstance(chart, str):
                        name = os.path.basename(chart)
                        path = chart
                    else: continue

                    url = path.replace("/app/data", "/data").replace("/app/plots", "/app/plots")
                    html += f'''
                    <section class="card flex flex-col">
                        <h3 class="text-lg font-bold text-blue-300 mb-4 flex items-center gap-2">📊 {name}</h3>
                        <div class="chart-container flex-grow relative" style="min-height: 400px;"><iframe src="{url}" class="absolute inset-0 w-full h-full"></iframe></div>
                    </section>
                    '''
                html += '</div>\\n'
                
            elif sec_type == 'raw_html':
                raw = sec.get('html', '')
                html += f'<div class="w-full">{raw}</div>\\n'
                
            html += '</div>\\n' # end wrapper div

        html += """
                </div>
            </main>
        </body>
        </html>
        """
        
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(html)
            
        import time
        timestamp = int(time.time() * 1000)
        print(f"Successfully generated dynamic dashboard! Here is the link:\\n\\n[View Interactive Chart](https://jvteststock.com/data/{filename}?t={timestamp})")
        return

    # Normal plotting logic
    if os.path.exists(data_source):
        if data_source.endswith('.csv'):
            with open(data_source, 'r', encoding='utf-8') as f:
                reader = csv.reader(f)
                headers = next(reader)
                rows = list(reader)
            
            if layout == "financial_candlestick":
                h_low = [h.lower() for h in headers]
                date_idx = next((i for i, h in enumerate(h_low) if 'date' in h or 'time' in h), 0)
                open_idx = next((i for i, h in enumerate(h_low) if 'open' in h), 1)
                high_idx = next((i for i, h in enumerate(h_low) if 'high' in h), 2)
                low_idx = next((i for i, h in enumerate(h_low) if 'low' in h), 3)
                close_idx = next((i for i, h in enumerate(h_low) if 'close' in h), 4)
                data = {
                    'dates': [r[date_idx] for r in rows],
                    'open': [float(r[open_idx]) if r[open_idx] else 0 for r in rows],
                    'high': [float(r[high_idx]) if r[high_idx] else 0 for r in rows],
                    'low': [float(r[low_idx]) if r[low_idx] else 0 for r in rows],
                    'close': [float(r[close_idx]) if r[close_idx] else 0 for r in rows],
                }
            else:
                data = {}
                x_col = headers[0]
                for i, col in enumerate(headers[1:], start=1):
                    y_vals = []
                    for r in rows:
                        try:
                            y_vals.append(float(r[i]))
                        except:
                            y_vals.append(r[i])
                    data[col] = {'x': [r[0] for r in rows], 'y': y_vals}
        else:
            with open(data_source, 'r', encoding='utf-8') as f:
                data = json.load(f)
    else:
        # Not a file path, assume literal JSON string
        data = json.loads(data_source)

    template = "plotly_dark"
    
    if layout == "line_chart":
        fig = go.Figure()
        for series_name, series_data in data.items():
            fig.add_trace(go.Scatter(x=series_data['x'], y=series_data['y'], mode='lines+markers', name=series_name))
            
    elif layout == "bar_chart":
        fig = go.Figure()
        for series_name, series_data in data.items():
            fig.add_trace(go.Bar(x=series_data['x'], y=series_data['y'], name=series_name))
            
    elif layout == "financial_candlestick":
        fig = go.Figure(data=[go.Candlestick(
            x=data['dates'],
            open=data['open'],
            high=data['high'],
            low=data['low'],
            close=data['close']
        )])
        
    elif layout == "multi_panel":
        fig = make_subplots(rows=2, cols=2, subplot_titles=("Panel 1", "Panel 2", "Panel 3", "Panel 4"))
        fig.add_trace(go.Scatter(x=data.get('x1', []), y=data.get('y1', []), mode='lines'), row=1, col=1)
        fig.add_trace(go.Bar(x=data.get('x2', []), y=data.get('y2', [])), row=1, col=2)
        fig.add_trace(go.Scatter(x=data.get('x3', []), y=data.get('y3', []), mode='lines+markers'), row=2, col=1)
        fig.add_trace(go.Scatter(x=data.get('x4', []), y=data.get('y4', []), mode='markers'), row=2, col=2)
        
    fig.update_layout(
        title=f"<b>{title}</b>",
        title_x=0.5,
        template=template,
        margin=dict(l=20, r=20, t=50, b=20),
        hovermode="x unified"
    )
    
    # Save as a standalone HTML file in the public data directory
    output_dir = "/app/data"
    os.makedirs(output_dir, exist_ok=True)
    filepath = os.path.join(output_dir, filename)
    
    fig.write_html(filepath, include_plotlyjs='cdn')
    print(f"Successfully generated! Here is the dashboard:\\n\\n[{title}](/data/{filename})")

generate_interactive_dashboard(\${JSON.stringify(title)}, \${JSON.stringify(data_source)}, \${JSON.stringify(layout)}, \${JSON.stringify(filename)}, \${JSON.stringify(dashboard_config ?? "")})
\`;

    try {
      const messages = await PythonShell.runString(code, {
        pythonPath: pythonPath,
        cwd: desiredCwd
      });
      return {
        content: [{ type: "text", text: messages ? messages.join("\\n") : "Dashboard generated."}]
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: \`Error generating dashboard: \${error.message}\` }],
        isError: true,
      };
    }
  }

  throw new Error(\`Tool not found: \${request.params.name}\`);
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
`;

fs.writeFileSync('/opt/LibreChat/LibreChat/mcp-local/python-interpreter/src/index.ts', content, 'utf8');
