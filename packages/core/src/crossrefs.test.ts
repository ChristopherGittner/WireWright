import { describe, expect, it } from 'vitest';
import { column, documentWithPage } from './test/fixtures.js';

function relayProject() {
  const { doc, pageId } = documentWithPage();
  doc.apply([
    { type: 'placeSymbol', pageId, id: 'i_k', symbol: 'coil', x: column(3), y: 100, template: 'relay.2co' },
    { type: 'createPage', id: 'p_seven', name: '7', structure: { function: 'SG', location: '10' } },
    { type: 'createPage', id: 'p_eight', name: '8', structure: { function: 'AA' } },
  ]);
  return { doc, pageId };
}

describe('cross-references', () => {
  it('contacts show where their coil is; the coil shows the contact image', () => {
    const { doc, pageId } = relayProject();
    doc.apply([
      { type: 'placeSymbol', pageId: 'p_seven', id: 'i_no', symbol: 'no', x: column(2), y: 100, tag: { product: '5K3' }, pins: { '1': '11', '2': '14' } },
      { type: 'placeSymbol', pageId: 'p_seven', id: 'i_nc', symbol: 'nc', x: column(6), y: 100, tag: { product: '5K3' } },
    ]);
    const xrefs = doc.crossReferences();
    expect(xrefs.byItem.get('i_no')?.references.map((r) => r.text)).toEqual(['/5.3']);
    expect(xrefs.byItem.get('i_no')?.references[0]?.target).toEqual({ pageId, itemId: 'i_k' });
    expect(xrefs.byItem.get('i_k')?.contactImage).toEqual([
      { function: 'contact.co', pins: ['11', '12', '14'], reference: { text: '/7.2', target: { pageId: 'p_seven', itemId: 'i_no' } }, symbol: 'no' },
      { function: 'contact.co', pins: ['21', '22', '24'], reference: { text: '/7.6', target: { pageId: 'p_seven', itemId: 'i_nc' } }, symbol: 'nc' },
    ]);
    expect(xrefs.issues).toEqual([]);
  });

  it('shows the page structure when the target page has another structure', () => {
    const { doc } = relayProject();
    doc.apply({ type: 'placeSymbol', pageId: 'p_eight', id: 'i_no', symbol: 'no', x: column(4), y: 100, tag: { location: '10', function: 'SG', product: '5K3' }, pins: { '1': '11', '2': '14' } });
    expect(doc.crossReferences().byItem.get('i_no')?.references[0]?.text).toBe('=SG+10/5.3');
    expect(doc.crossReferences().byItem.get('i_k')?.contactImage?.[0]?.reference?.text).toBe('=AA/8.4');
  });

  it('warns about contacts the device does not have, or uses twice', () => {
    const { doc } = relayProject();
    doc.apply([
      { type: 'placeSymbol', pageId: 'p_seven', id: 'i_a', symbol: 'no', x: column(2), y: 100, tag: { product: '5K3' } },
      { type: 'placeSymbol', pageId: 'p_seven', id: 'i_b', symbol: 'no', x: column(3), y: 100, tag: { product: '5K3' }, pins: { '1': '21', '2': '24' } },
      { type: 'placeSymbol', pageId: 'p_seven', id: 'i_c', symbol: 'nc', x: column(4), y: 100, tag: { product: '5K3' }, pins: { '1': '21', '2': '22' } },
    ]);
    const issues = doc.check().filter((i) => i.code.startsWith('contact.'));
    expect(issues.map((i) => [i.code, i.itemId])).toEqual([
      ['contact.notInTemplate', 'i_a'],
      ['contact.usedTwice', 'i_c'],
    ]);
    expect(issues[0]?.message).toContain('NO contact 13/14 is not one of the device');
  });

  it('the contact image grows with the contacts drawn: without a template all of them, sorted by pins', () => {
    const { doc, pageId } = documentWithPage();
    doc.apply([
      { type: 'placeSymbol', pageId, id: 'i_q', symbol: 'contactorCoil', x: column(3), y: 100 },
      { type: 'placeSymbol', pageId, id: 'i_b', symbol: 'nc', x: column(6), y: 100, tag: { product: '5Q3' } },
      { type: 'placeSymbol', pageId, id: 'i_a', symbol: 'no', x: column(5), y: 100, tag: { product: '5Q3' } },
    ]);
    const info = doc.crossReferences().byItem.get('i_q')!;
    expect(info.contactImage?.map((r) => [r.function, r.pins.join('/'), r.reference?.text, r.symbol])).toEqual([
      ['contact.no', '13/14', '/5.5', 'no'],
      ['contact.nc', '21/22', '/5.6', 'nc'],
    ]);
    expect(info.references).toEqual([]);
    doc.apply({ type: 'placeSymbol', pageId, id: 'i_c', symbol: 'no', x: column(8), y: 100, tag: { product: '5Q3' }, pins: { '1': '33', '2': '34' } });
    expect(doc.crossReferences().byItem.get('i_q')?.contactImage).toHaveLength(3);
  });

  it('with a template, contacts beyond it are added as extra rows (and still reported)', () => {
    const { doc } = relayProject();
    doc.apply({ type: 'placeSymbol', pageId: 'p_seven', id: 'i_x', symbol: 'no', x: column(2), y: 100, tag: { product: '5K3' }, pins: { '1': '43', '2': '44' } });
    const rows = doc.crossReferences().byItem.get('i_k')?.contactImage;
    expect(rows?.map((r) => [r.pins.join('/'), r.reference?.text ?? '', r.extra ?? false])).toEqual([
      ['11/12/14', '', false],
      ['21/22/24', '', false],
      ['43/44', '/7.2', true],
    ]);
    expect(doc.check().filter((i) => i.code === 'contact.notInTemplate').map((i) => i.itemId)).toEqual(['i_x']);
  });

  it('a main function without a template lists its auxiliary functions', () => {
    const { doc, pageId } = documentWithPage();
    doc.apply([
      { type: 'placeSymbol', pageId, id: 'i_k', symbol: 'coil', x: column(3), y: 100 },
      { type: 'placeSymbol', pageId, id: 'i_a', symbol: 'no', x: column(5), y: 100, tag: { product: '5K3' } },
      { type: 'placeSymbol', pageId, id: 'i_b', symbol: 'nc', x: column(6), y: 100, tag: { product: '5K3' } },
    ]);
    expect(doc.crossReferences().byItem.get('i_k')?.references.map((r) => r.text)).toEqual(['/5.5', '/5.6']);
    expect(doc.crossReferences().byItem.get('i_k')?.contactImage).toBeUndefined();
  });

  it('interruption points show their partners', () => {
    const { doc, pageId } = relayProject();
    doc.apply([
      { type: 'placeSymbol', pageId, id: 'i_u1', symbol: 'interruption', x: column(9), y: 100, props: { name: 'L+' } },
      { type: 'placeSymbol', pageId: 'p_seven', id: 'i_u2', symbol: 'interruption', x: column(1), y: 40, rotation: 180, props: { name: 'L+' } },
    ]);
    expect(doc.crossReferences().byItem.get('i_u1')?.references.map((r) => r.text)).toEqual(['/7.1']);
    expect(doc.crossReferences().byItem.get('i_u2')?.references.map((r) => r.text)).toEqual(['/5.9']);
  });
});
