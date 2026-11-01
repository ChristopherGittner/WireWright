import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures.js';

test('opens the project, places a symbol, undoes it and saves', async ({ win, dirs }) => {
  await expect(win.locator('.page-row')).toHaveCount(9);
  await win.locator('.page-row', { hasText: 'Steuerung' }).click();
  await expect(win.locator('.canvas svg').first()).toBeVisible();

  const placed = await win.evaluate(() => {
    const s = window.wirewrightStore;
    return s.apply({ type: 'placeSymbol', pageId: 'p_control', symbol: 'iec60617.lamp', x: 360, y: 200 }, 'place').created[0] as string;
  });
  await expect(win.locator(`.canvas [data-hit="${placed}"]`)).toHaveCount(1);
  await win.keyboard.press('Control+z');
  await expect(win.locator(`.canvas [data-hit="${placed}"]`)).toHaveCount(0);

  await win.evaluate(() => window.wirewrightStore.apply({ type: 'setProjectProperties', name: 'Saved by e2e' }, 'rename'));
  await win.keyboard.press('Control+s');
  await expect.poll(() => JSON.parse(readFileSync(join(dirs.project, 'project.json'), 'utf8')).name).toBe('Saved by e2e');
});

test('asks before closing with unsaved changes and keeps the window on "cancel"', async ({ app, win }) => {
  await win.evaluate(() => window.wirewrightStore.apply({ type: 'setProjectProperties', name: 'Unsaved' }, 'rename'));
  await app.evaluate(({ dialog }) => {
    (globalThis as { asked?: string }).asked = '';
    dialog.showMessageBoxSync = (...args: unknown[]) => {
      const options = args.find((a) => typeof a === 'object' && a !== null && 'buttons' in a) as unknown as { message: string };
      (globalThis as { asked?: string }).asked = options.message;
      return 2; // cancel
    };
  });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
  await expect.poll(() => app.evaluate(() => (globalThis as { asked?: string }).asked)).not.toBe('');
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
});

test('reports problems in the Issues tab and jumps to them', async ({ win }) => {
  await win.evaluate(() => window.wirewrightStore.apply({ type: 'placeSymbol', pageId: 'p_control', symbol: 'iec60617.motor.3ph', x: 360, y: 220 }, 'place'));
  await win.locator('button.tab-name', { hasText: 'Issues' }).click();
  const issue = win.locator('.issues li', { hasText: 'the PE connection is not connected' });
  await expect(issue).toHaveCount(1);
  await win.evaluate(() => window.wirewrightStore.navigate('p_power'));
  await issue.click();
  await expect.poll(() => win.evaluate(() => window.wirewrightStore.state.sheet.pageId)).toBe('p_control');
});

test('command palette finds actions, pages and devices', async ({ win }) => {
  await win.keyboard.press('Control+k');
  const input = win.getByPlaceholder('Search actions, pages, devices, symbols …');
  await expect(input).toBeFocused();
  await input.fill('steuerung');
  await expect(win.locator('.palette li.active .palette-kind')).toHaveText('Page');
  await input.press('Enter');
  await expect(win.locator('.palette')).toHaveCount(0);
  await expect.poll(() => win.evaluate(() => window.wirewrightStore.state.sheet.pageId)).toBe('p_control');

  await win.keyboard.press('Control+k');
  await input.fill('wire list');
  await expect(win.locator('.palette li.active .palette-label')).toContainText('Wires');
  await input.press('Enter');
  await expect(win.locator('.modal')).toBeVisible();
  await win.keyboard.press('Escape');

  await win.keyboard.press('Control+k');
  await input.fill('3K7');
  await expect(win.locator('.palette li.active .palette-kind')).toHaveText('Device');
  await input.press('Enter');
  await expect.poll(() => win.evaluate(() => window.wirewrightStore.state.selection.items.length)).toBeGreaterThan(0);
});

test('shows alignment guides while moving a symbol', async ({ win }) => {
  await win.evaluate(() => window.wirewrightStore.navigate('p_control'));
  // A lamp below the relay coil's column (x 272), but 16 mm to the right of it.
  const lamp = await win.evaluate(() => window.wirewrightStore.apply({ type: 'placeSymbol', pageId: 'p_control', symbol: 'iec60617.lamp', x: 288, y: 220 }, 'place').created[0] as string);
  await expect(win.locator(`.canvas [data-hit="${lamp}"]`)).toHaveCount(1);
  const mmToPx = await win.evaluate(() => (document.querySelector('.canvas svg') as SVGSVGElement).getScreenCTM()!.a);
  const box = (await win.locator(`.canvas [data-hit="${lamp}"]`).boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await win.mouse.move(start.x, start.y);
  await win.mouse.down();
  await win.mouse.move(start.x - 16 * mmToPx, start.y, { steps: 8 });
  await expect(win.locator('.canvas .guides line')).not.toHaveCount(0);
  await win.mouse.up();
  await expect(win.locator('.canvas .guides line')).toHaveCount(0);
});

test('style brush copies the text layout to clicked symbols', async ({ win }) => {
  await win.evaluate(() => window.wirewrightStore.navigate('p_control'));
  const ids = await win.evaluate(() => {
    const s = window.wirewrightStore;
    const a = s.apply({ type: 'placeSymbol', pageId: 'p_control', symbol: 'iec60617.lamp', x: 340, y: 220 }, 'place').created[0] as string;
    const b = s.apply({ type: 'placeSymbol', pageId: 'p_control', symbol: 'iec60617.lamp', x: 380, y: 220 }, 'place').created[0] as string;
    s.apply({ type: 'setTextArrangement', pageId: 'p_control', itemId: a, arrangement: { side: 'right', angle: 90 } }, 'arrange');
    s.select({ items: [a] });
    return { a, b };
  });
  await win.click('.toolbar button[aria-label^="Style brush"]');
  await expect(win.locator('.statusbar')).toContainText('Style brush');
  await win.locator(`.canvas [data-hit="${ids.b}"]`).click();
  const arrangement = await win.evaluate((b) => window.wirewrightStore.state.doc.state.pages.p_control.items.find((i: { id: string }) => i.id === b).textArrangement, ids.b);
  expect(arrangement).toEqual({ side: 'right', angle: 90 });
  await win.keyboard.press('Escape');
  await expect(win.locator('.statusbar')).not.toContainText('Style brush');
});

test('acknowledged issues are greyed out and no longer counted', async ({ win }) => {
  await win.evaluate(() => window.wirewrightStore.apply({ type: 'placeSymbol', pageId: 'p_control', symbol: 'iec60617.motor.3ph', x: 360, y: 220 }, 'place'));
  await win.locator('button.tab-name', { hasText: 'Issues' }).click();
  const count = win.locator('button.tab-name .count.warning');
  await expect(count).toHaveText('1');
  const issue = win.locator('.issues li', { hasText: 'the PE connection is not connected' });
  await issue.hover();
  await issue.locator('.issue-ack').click();
  await win.fill('.modal input', 'PE via the housing');
  await win.click('.modal button:has-text("Acknowledge")');
  await expect(win.locator('.issues li.acknowledged')).toContainText('PE via the housing');
  await expect(count).toHaveCount(0);
  await win.locator('.issues li.acknowledged .issue-ack').click();
  await expect(count).toHaveText('1');
});

test('drags pages into another function and onto another page', async ({ win }) => {
  const structure = (id: string) => win.evaluate((pageId) => window.wirewrightStore.state.doc.state.pages[pageId].structure, id);
  await win.locator('.page-row', { hasText: 'Steuerung' }).dragTo(win.locator('.tree-node', { hasText: '=DOC' }));
  await expect.poll(() => structure('p_control')).toEqual({ function: 'DOC', location: 'CAB1' });
  await win.locator('.page-row', { hasText: 'SPS-Übersicht' }).dragTo(win.locator('.page-row', { hasText: 'Inhaltsverzeichnis' }));
  await expect.poll(() => structure('p_plc')).toEqual({ function: 'DOC' });
  const order = await win.evaluate(() => window.wirewrightStore.state.doc.state.project.pages.slice(0, 2));
  expect(order).toEqual(['p_plc', 'p_toc']);
  await win.keyboard.press('Control+z');
  await expect.poll(() => structure('p_plc')).toEqual({ function: 'FB', location: 'CAB1' });
});

test('appends PLC cards from the PLC tab', async ({ win }) => {
  await win.locator('button.tab-name', { hasText: 'PLC' }).click();
  await win.locator('.plc-station', { hasText: 'PLC1' }).locator('button[aria-label^="Add I/O cards"]').click();
  const search = win.getByPlaceholder(/Search: part number/);
  await search.fill('750-1405');
  await search.press('Enter');
  await search.fill('750-1504');
  await win.locator('.add-card-list li').first().dblclick();
  await expect(win.locator('.add-card-station li')).toHaveCount(4); // the demo's two cards + two new
  await win.click('.modal button:has-text("Done")');
  const slots = await win.evaluate(() => window.wirewrightStore.state.doc.plc().cards.filter((c: { station?: { name: string } }) => c.station?.name === 'PLC1').map((c: { slot?: number; channels: unknown[]; stored: boolean }) => [c.slot, c.channels.length, c.stored]));
  // added, not drawn yet
  expect(slots.slice(-2)).toEqual([[3, 16, true], [4, 16, true]]);
  await expect(win.locator('.plc-card.not-drawn')).toHaveCount(2);
});

test('PLC cards: added in the PLC tab, marked until drawn, then drawn on a page', async ({ win }) => {
  await win.locator('button.tab-name', { hasText: 'PLC' }).click();
  await win.locator('.plc-station', { hasText: 'PLC1' }).locator('button[aria-label^="Add I/O cards"]').click();
  await win.getByPlaceholder(/Search: part number/).fill('750-1420');
  const row = win.locator('.add-card-list li', { hasText: '750-1420' }).first();
  // the full name as tooltip, the card's channels in the preview
  await expect(row).toHaveAttribute('title', /4-Kanal-Digitaleingang; DC 24 V; 3 ms; 3-Leiter-Anschluss/);
  await row.hover();
  await expect(win.locator('.add-card-preview')).toContainText('4 channels, 12 terminals');
  await row.dblclick();
  await win.click('.modal button:has-text("Done")');
  // named like the PLC's other cards: the next free -A<n>
  const card = win.locator('.plc-card.not-drawn', { hasText: '=FB+CAB1-A1' });
  await expect(card).toContainText('not drawn');

  await win.evaluate(() => window.wirewrightStore.navigate('p_sensors'));
  const svg = win.locator('.canvas svg').first();
  // click the card, then click on the page (the same placement as dropping it there)
  await card.locator('.plc-card-head .name').click();
  await svg.click({ position: { x: 900, y: 150 } });
  await expect(win.locator('.plc-card', { hasText: '=FB+CAB1-A1' })).not.toHaveClass(/not-drawn/);
  await expect(win.locator('.plc-card', { hasText: '=FB+CAB1-A1' }).locator('.card-ref')).toHaveText([/^\/5\.\d+$/]);
});

test('F5 / F6 / F7 place corners, T-junctions and interruption points', async ({ win }) => {
  await win.evaluate(() => window.wirewrightStore.navigate('p_control'));
  await win.locator('.canvas svg').first().click({ position: { x: 5, y: 5 } });
  const tool = () => win.evaluate(() => window.wirewrightStore.state.tool);
  await win.keyboard.press('F5');
  expect(await tool()).toMatchObject({ kind: 'place', symbol: 'wirewright.connection.corner.right-down' });
  await win.keyboard.press('F5');
  expect(await tool()).toMatchObject({ symbol: 'wirewright.connection.corner.down-left' });
  await win.keyboard.press('F6');
  expect(await tool()).toMatchObject({ symbol: 'wirewright.connection.tee.right-down-left' });
  await win.keyboard.press('F7');
  expect(await tool()).toMatchObject({ symbol: 'wirewright.connection.interruption' });
  await win.keyboard.press('Escape');
});
