import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures.js';

test('releases a revision and shows the changes since', async ({ win, dirs }) => {
  await win.click('.toolbar button[aria-label^="Revisions"]');
  await win.fill('.modal .field:has(> span:text-is("Description")) input', 'First issue');
  await win.click('.modal button:has-text("Release revision")');
  await expect.poll(() => existsSync(join(dirs.project, 'revisions', 'A.json'))).toBe(true);
  await win.keyboard.press('Escape');
  await win.evaluate(() => window.wirewrightStore.apply({ type: 'placeSymbol', pageId: 'p_control', symbol: 'iec60617.lamp', x: 360, y: 200 }, 'test'));
  await win.click('.toolbar button[aria-label^="Revisions"]');
  await win.click('.modal button:has-text("Show changes since")');
  await win.keyboard.press('Escape');
  await expect(win.locator('.page-row:has(.changed-mark) .name')).toHaveText(['3']);
});

test('saves the project as an archive and opens it again', async ({ app, win, dirs }) => {
  const zip = join(dirs.temp, 'test.wirewright.zip');
  const target = join(dirs.temp, 'unpacked');
  mkdirSync(target);
  await app.evaluate(({ dialog }, [zip, target]) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: zip! });
    let n = 0;
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [n++ === 0 ? zip! : target!] });
  }, [zip, target]);
  await win.click('.toolbar button[aria-label^="Save as archive"]');
  await expect.poll(() => existsSync(zip)).toBe(true);
  await win.click('.toolbar button[aria-label^="Open a project archive"]');
  await expect.poll(() => (existsSync(join(target, 'pages')) ? readdirSync(join(target, 'pages')).length : 0)).toBe(9);
  await expect(win.locator('.page-row')).toHaveCount(9);
});

test('imports a BMEcat catalog and assigns an unknown ECLASS feature', async ({ win, dirs }) => {
  const file = join(dirs.temp, 'catalog.xml');
  writeFileSync(
    file,
    `<?xml version="1.0" encoding="UTF-8"?><BMECAT version="2005"><HEADER><CATALOG><LANGUAGE>deu</LANGUAGE><CURRENCY>EUR</CURRENCY></CATALOG><SUPPLIER><SUPPLIER_NAME>ACME</SUPPLIER_NAME></SUPPLIER></HEADER><T_NEW_CATALOG>
    <PRODUCT><SUPPLIER_PID>PSU-24-5A</SUPPLIER_PID><PRODUCT_DETAILS><DESCRIPTION_SHORT>Netzteil 24 V</DESCRIPTION_SHORT><MANUFACTURER_PID>PSU-24-5A</MANUFACTURER_PID><MANUFACTURER_NAME>ACME</MANUFACTURER_NAME></PRODUCT_DETAILS>
    <PRODUCT_FEATURES><REFERENCE_FEATURE_SYSTEM_NAME>ECLASS-13.0</REFERENCE_FEATURE_SYSTEM_NAME><REFERENCE_FEATURE_GROUP_ID>27040701</REFERENCE_FEATURE_GROUP_ID>
    <FEATURE><FNAME>Breite</FNAME><FVALUE>65</FVALUE><FUNIT>MMT</FUNIT></FEATURE><FEATURE><FNAME>0173-1#02-XYZ#001</FNAME><FVALUE>120</FVALUE><FUNIT>MMT</FUNIT></FEATURE></PRODUCT_FEATURES></PRODUCT></T_NEW_CATALOG></BMECAT>`,
  );
  await win.evaluate(() => window.wirewrightStore.set({ dialog: { kind: 'parts' } }));
  await win.locator('.modal input[type="file"]').setInputFiles(file);
  await expect(win.locator('.modal .catalog-features')).toBeVisible();
  await win.locator('.catalog-features tr', { hasText: '0173-1#02-XYZ#001' }).locator('select').selectOption('height');
  await win.locator('.modal button', { hasText: 'Import 1 part(s)' }).click();
  await expect.poll(() => win.evaluate(() => window.wirewrightStore.state.doc.library.part('ACME:PSU-24-5A'))).toMatchObject({ width: 65, height: 120, classification: [{ system: 'ECLASS-13.0', id: '27040701' }] });
  expect(await win.evaluate(() => window.wirewrightStore.state.machine.catalogFeatures)).toEqual({ '0173-1#02-XYZ#001': 'height' });
});
