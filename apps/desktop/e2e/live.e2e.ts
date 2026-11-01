import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, test } from './fixtures.js';

const PORT = 39211;
const TOKEN = 'e2e-token';
test.use({ settings: { machine: { mcp: { enabled: true, port: PORT } }, mcpToken: TOKEN } });

test('an MCP client edits the open project; the change is one undo step', async ({ win }) => {
  const url = `http://127.0.0.1:${PORT}/mcp`;
  const refused = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  expect(refused.status).toBe(401);

  const client = new Client({ name: 'e2e', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } }));
  try {
    const result = await client.callTool({ name: 'place_symbol', arguments: { page: '3', symbol: 'iec60617.lamp', x: 360, y: 200, functionText: 'Live lamp' } });
    const placed = JSON.parse((result.content as { text: string }[])[0]!.text) as { id: string };
    const has = () => win.evaluate((id) => Boolean(window.wirewrightStore.state.doc.state.pages.p_control.items.find((i: { id: string }) => i.id === id)), placed.id);
    await expect.poll(has).toBe(true);
    expect(await win.evaluate(() => window.wirewrightStore.state.doc.undoLabel)).toBe('AI (MCP)');
    await win.evaluate(() => window.wirewrightStore.undo());
    expect(await has()).toBe(false);
  } finally {
    await client.close();
  }
});
