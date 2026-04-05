#!/usr/bin/env node

/**
 * Example LSP Server demonstrating environment variable resolution
 * 
 * This server receives environment variables from the plugin system
 * and demonstrates how they are resolved at runtime.
 */

const readline = require('readline');

// Log environment variables received from the plugin system
console.error('=== Example LSP Server Started ===');
console.error('Environment Variables from Plugin System:');
console.error('  API_KEY:', process.env.API_KEY ? '***provided***' : '(not set)');
console.error('  PLUGIN_ROOT:', process.env.PLUGIN_ROOT);
console.error('  DATA_DIR:', process.env.DATA_DIR);
console.error('  CACHE_PATH:', process.env.CACHE_PATH);
console.error('  LOG_FILE:', process.env.LOG_FILE);
console.error('  NODE_ENV:', process.env.NODE_ENV);
console.error('  CUSTOM_PATH:', process.env.CUSTOM_PATH);
console.error('');
console.error('Command-line Arguments:');
console.error('  Port:', process.argv[3]);
console.error('  Log Level:', process.argv[5]);
console.error('  Debug Mode:', process.argv[7]);
console.error('===================================');

// Simple LSP server that responds to initialize request
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

let requestId = 0;

rl.on('line', (line) => {
  try {
    // Parse LSP message
    const contentLengthMatch = line.match(/^Content-Length: (\d+)$/);
    if (contentLengthMatch) {
      const length = parseInt(contentLengthMatch[1], 10);
      // Read the actual message
      rl.once('line', (emptyLine) => {
        if (emptyLine === '') {
          let message = '';
          let bytesToRead = length;
          
          const readContent = () => {
            const chunk = process.stdin.read(bytesToRead);
            if (chunk) {
              message += chunk;
              bytesToRead -= chunk.length;
              if (bytesToRead > 0) {
                readContent();
              } else {
                handleMessage(message);
              }
            }
          };
          readContent();
        }
      });
    }
  } catch (error) {
    console.error('Error processing message:', error);
  }
});

function handleMessage(message) {
  try {
    const request = JSON.parse(message);
    
    if (request.method === 'initialize') {
      const response = {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          capabilities: {
            textDocumentSync: 1,
            completionProvider: {
              resolveProvider: false,
              triggerCharacters: ['.']
            },
            hoverProvider: true
          },
          serverInfo: {
            name: 'example-language-server',
            version: '1.0.0'
          }
        }
      };
      
      sendMessage(response);
    } else if (request.method === 'initialized') {
      // Notification, no response needed
    } else if (request.method === 'shutdown') {
      const response = {
        jsonrpc: '2.0',
        id: request.id,
        result: null
      };
      sendMessage(response);
    } else if (request.method === 'exit') {
      process.exit(0);
    }
  } catch (error) {
    console.error('Error handling message:', error);
  }
}

function sendMessage(message) {
  const content = JSON.stringify(message);
  const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;
  process.stdout.write(header + content);
}

// Handle process signals
process.on('SIGTERM', () => {
  console.error('Received SIGTERM, shutting down');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.error('Received SIGINT, shutting down');
  process.exit(0);
});
