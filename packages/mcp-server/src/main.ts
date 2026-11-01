#!/usr/bin/env node
// wirewright-mcp --project <folder>
// Starts the Wirewright MCP server on stdio for one project folder.
import { NodeProjectStorage } from '@wirewright/core/node';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { parseArgs } from 'node:util';
import { createWirewrightServer } from './server.js';

const { values } = parseArgs({
  options: { project: { type: 'string', short: 'p' }, help: { type: 'boolean', short: 'h' } },
});

if (values.help || !values.project) {
  process.stderr.write('Usage: wirewright-mcp --project <folder>\n\nThe folder holds the project (project.json, pages/). It is created by the create_project tool.\n');
  process.exit(values.help ? 0 : 1);
}

const storage = new NodeProjectStorage(values.project);
const server = createWirewrightServer({ storage });
await server.connect(new StdioServerTransport());
process.stderr.write(`Wirewright MCP server running for ${storage.root}\n`);
