const fs = require('fs');
let text = fs.readFileSync('/opt/LibreChat/LibreChat/mcp-local/python-interpreter/src/index.ts', 'utf8');

// Note: when I echoed earlier with bash EOF, it evaluated the backticks and ${} variables breaking the file.
// Let's do it cleaner by writing from pure JS where no variable substitution happens.
