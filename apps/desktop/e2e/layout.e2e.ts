import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

/** Screen position of a point on the plate (real mm). */
async function plateToScreen(win: Page, x: number, y: number) {
  return win.evaluate(
    ([x, y]: [number, number]) => {
      const svg = document.querySelector('.layout-canvas svg') as SVGSVGElement;
      const m = svg.getScreenCTM()!;
      const plate = document.querySelector('.layout-canvas rect[data-role="layout"]')!;
      const s = window.wirewrightStore;
      const scale = s.state.doc.state.pages[s.state.sheet.pageId].scale as number;
      return { x: m.e + (Number(plate.getAttribute('x')) + x / scale) * m.a, y: m.f + (Number(plate.getAttribute('y')) + y / scale) * m.a };
    },
    [x, y] as [number, number],
  );
}

async function drag(win: Page, from: [number, number], to: [number, number]) {
  const a = await plateToScreen(win, ...from);
  const b = await plateToScreen(win, ...to);
  await win.mouse.move(a.x, a.y);
  await win.mouse.down();
  await win.mouse.move(b.x, b.y, { steps: 5 });
  await win.mouse.up();
}

const items = (win: Page) => win.evaluate(() => {
  const s = window.wirewrightStore;
  return s.state.doc.state.pages[s.state.sheet.pageId].items as { id: string; kind: string; x: number; y: number; length?: number; itemId?: string; turned?: boolean }[];
});

test('lays out a mounting plate: duct, rail and devices snapped onto the rail', async ({ win }) => {
  await win.evaluate(() => window.wirewrightStore.apply({ type: 'addToProjectLibrary', content: { parts: [{ id: 'ACME:PSU-24-5A', manufacturer: 'ACME', partNumber: 'PSU-24-5A', width: 65, height: 120 }] } }, 'parts'));
  await win.click('.panel-tools button[aria-label^="New cabinet layout"]');
  await win.fill('.modal .field:has(> span:text-is("+ Location")) input', 'CAB1');
  await win.fill('.modal .field:has(> span:text-is("= Function")) input', 'FB');
  await win.click('.modal button:has-text("Create")');
  await expect(win.locator('.layout-canvas')).toBeVisible();
  await expect(win.locator('.page-row.active .badge')).toHaveText('L');

  await win.click('.layout-tools button:has-text("Duct")');
  await drag(win, [20, 20], [580, 20]);
  await win.click('.layout-tools button:has-text("Rail")');
  await drag(win, [20, 140], [580, 140]);
  for (const [label, x] of [['-2F2', 60], ['-2T7', 130]] as const) {
    await win.locator('.layout-devices li', { hasText: label }).first().click();
    const p = await plateToScreen(win, x, 160);
    await win.mouse.move(p.x, p.y, { steps: 3 });
    await win.mouse.click(p.x, p.y);
  }
  const placed = await items(win);
  expect(placed.map((i) => [i.kind, i.y])).toEqual([['duct', 20], ['rail', 140], ['device', 112.5], ['device', 97.5]]);
  await expect(win.locator('.layout-devices li.placed')).toHaveCount(2);

  // select the power supply, turn it, undo
  await win.locator(`.layout-canvas rect[data-hit="${placed[3]!.id}"]`).click();
  await win.keyboard.press('r');
  expect((await items(win))[3]!.turned).toBe(true);
  await win.keyboard.press('Control+z');
  expect((await items(win))[3]!.turned).toBeUndefined();

  const issues = await win.evaluate(() => window.wirewrightStore.state.doc.check().filter((i: { code: string }) => i.code === 'layout.notPlaced').length);
  expect(issues).toBeGreaterThan(0);
});

test('lays out a door with round command devices and a cutout', async ({ win }) => {
  await win.click('.panel-tools button[aria-label^="New cabinet layout"]');
  await win.selectOption('.modal .field:has(> span:text-is("Layout of")) select', 'door');
  await win.fill('.modal .field:has(> span:text-is("+ Location")) input', 'CAB1');
  await win.fill('.modal .field:has(> span:text-is("= Function")) input', 'FB');
  await win.click('.modal button:has-text("Create")');
  await expect(win.locator('.layout-tools button')).toHaveText(['', 'Cutout']);
  await win.click('.layout-tools button:has-text("Cutout")');
  await drag(win, [200, 80], [400, 220]);
  await win.locator('.layout-devices li:not(.placed)').first().click();
  const p = await plateToScreen(win, 120, 330);
  await win.mouse.move(p.x, p.y, { steps: 2 });
  await win.mouse.click(p.x, p.y);
  await expect(win.locator('.layout-canvas circle[data-role="layout"]')).toHaveCount(1);
  expect((await items(win)).map((i) => i.kind)).toEqual(['cutout', 'device']);
});
