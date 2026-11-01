import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { catalogFeatures, catalogParts, isBmecat, mergePart, readBmecat } from './bmecat.js';
import { parseXml } from './xml.js';

// A manufacturer's catalog, BMEcat 2005 with ECLASS features (codes with a template name, plain names).
const manufacturer = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE BMECAT SYSTEM "bmecat_2005.dtd">
<BMECAT version="2005" xmlns="http://www.bmecat.org/bmecat/2005">
  <HEADER>
    <CATALOG><LANGUAGE>deu</LANGUAGE><CATALOG_ID>C1</CATALOG_ID><CATALOG_VERSION>1.0</CATALOG_VERSION><CURRENCY>EUR</CURRENCY></CATALOG>
    <SUPPLIER><SUPPLIER_NAME>Finder</SUPPLIER_NAME></SUPPLIER>
  </HEADER>
  <T_NEW_CATALOG>
    <CLASSIFICATION_SYSTEM>
      <CLASSIFICATION_SYSTEM_FEATURE_TEMPLATES>
        <FEATURE_TEMPLATE><FT_ID>0173-1#02-AAA001#001</FT_ID><FT_NAME>Breite</FT_NAME></FEATURE_TEMPLATE>
      </CLASSIFICATION_SYSTEM_FEATURE_TEMPLATES>
    </CLASSIFICATION_SYSTEM>
    <PRODUCT mode="new">
      <SUPPLIER_PID>405290240000</SUPPLIER_PID>
      <PRODUCT_DETAILS>
        <DESCRIPTION_SHORT lang="deu">Relais 2 W &amp; LED</DESCRIPTION_SHORT>
        <DESCRIPTION_SHORT lang="eng"><![CDATA[Relay 2 CO <LED>]]></DESCRIPTION_SHORT>
        <INTERNATIONAL_PID type="gtin">8012823000000</INTERNATIONAL_PID>
        <MANUFACTURER_PID>40.52.9.024.0000</MANUFACTURER_PID>
        <MANUFACTURER_NAME>Finder</MANUFACTURER_NAME>
      </PRODUCT_DETAILS>
      <PRODUCT_FEATURES>
        <REFERENCE_FEATURE_SYSTEM_NAME>ECLASS-13.0</REFERENCE_FEATURE_SYSTEM_NAME>
        <REFERENCE_FEATURE_GROUP_ID>27371601</REFERENCE_FEATURE_GROUP_ID>
        <FEATURE><FNAME>0173-1#02-AAA001#001</FNAME><FVALUE>15,5</FVALUE><FUNIT>MMT</FUNIT></FEATURE>
        <FEATURE><FNAME>Höhe</FNAME><FVALUE>7.8</FVALUE><FUNIT>CMT</FUNIT></FEATURE>
        <FEATURE><FNAME>0173-1#02-AAA999#002</FNAME><FVALUE>72</FVALUE><FUNIT>MMT</FUNIT></FEATURE>
        <FEATURE><FNAME>Bemessungssteuerspeisespannung Us bei DC</FNAME><FVALUE>24</FVALUE><FUNIT>VLT</FUNIT></FEATURE>
        <FEATURE><FNAME>Bemessungssteuerspeisespannung Us bei AC 50 Hz</FNAME><FVALUE>0</FVALUE><FUNIT>VLT</FUNIT></FEATURE>
        <FEATURE><FNAME>Anzahl Wechsler</FNAME><FVALUE>2</FVALUE></FEATURE>
      </PRODUCT_FEATURES>
      <PRODUCT_FEATURES>
        <REFERENCE_FEATURE_SYSTEM_NAME>ETIM-9.0</REFERENCE_FEATURE_SYSTEM_NAME>
        <REFERENCE_FEATURE_GROUP_ID>EC001437</REFERENCE_FEATURE_GROUP_ID>
      </PRODUCT_FEATURES>
      <PRODUCT_ORDER_DETAILS><ORDER_UNIT>C62</ORDER_UNIT><PRICE_QUANTITY>10</PRICE_QUANTITY></PRODUCT_ORDER_DETAILS>
      <PRODUCT_PRICE_DETAILS>
        <PRODUCT_PRICE price_type="gros_list"><PRICE_AMOUNT>130.00</PRICE_AMOUNT></PRODUCT_PRICE>
        <PRODUCT_PRICE price_type="net_list"><PRICE_AMOUNT>125.00</PRICE_AMOUNT><PRICE_CURRENCY>EUR</PRICE_CURRENCY><LOWER_BOUND>1</LOWER_BOUND></PRODUCT_PRICE>
        <PRODUCT_PRICE price_type="net_list"><PRICE_AMOUNT>110.00</PRICE_AMOUNT><PRICE_CURRENCY>EUR</PRICE_CURRENCY><LOWER_BOUND>100</LOWER_BOUND></PRODUCT_PRICE>
      </PRODUCT_PRICE_DETAILS>
      <MIME_INFO><MIME><MIME_TYPE>application/pdf</MIME_TYPE><MIME_SOURCE>https://example.com/40.pdf</MIME_SOURCE><MIME_PURPOSE>data_sheet</MIME_PURPOSE></MIME></MIME_INFO>
    </PRODUCT>
  </T_NEW_CATALOG>
</BMECAT>`;

// A wholesaler's catalog, BMEcat 1.2, ISO-8859-1, ETIM codes.
const wholesaler = `<?xml version="1.0" encoding="ISO-8859-1"?>
<BMECAT version="1.2">
  <HEADER><CATALOG><LANGUAGE>deu</LANGUAGE><CURRENCY>EUR</CURRENCY></CATALOG><SUPPLIER><SUPPLIER_NAME>Elektro Großhandel AG</SUPPLIER_NAME></SUPPLIER></HEADER>
  <T_NEW_CATALOG>
    <ARTICLE mode="new">
      <SUPPLIER_AID>EG-123</SUPPLIER_AID>
      <ARTICLE_DETAILS><DESCRIPTION_SHORT>Leitungsschutzschalter C16 3-polig, Gerätebreite</DESCRIPTION_SHORT><EAN>4000000000000</EAN><MANUFACTURER_AID>MCB-C16-3P</MANUFACTURER_AID><MANUFACTURER_NAME>ACME</MANUFACTURER_NAME></ARTICLE_DETAILS>
      <ARTICLE_FEATURES>
        <REFERENCE_FEATURE_SYSTEM_NAME>ETIM-8.0</REFERENCE_FEATURE_SYSTEM_NAME>
        <REFERENCE_FEATURE_GROUP_ID>EC000042</REFERENCE_FEATURE_GROUP_ID>
        <FEATURE><FNAME>EF000008</FNAME><FVALUE>54</FVALUE><FUNIT>MMT</FUNIT></FEATURE>
        <FEATURE><FNAME>EF000040</FNAME><FVALUE>90</FVALUE><FUNIT>MMT</FUNIT></FEATURE>
        <FEATURE><FNAME>EF000049</FNAME><FVALUE>70</FVALUE><FUNIT>MMT</FUNIT></FEATURE>
        <FEATURE><FNAME>Bemessungsstrom</FNAME><FVALUE>16</FVALUE><FUNIT>AMP</FUNIT></FEATURE>
        <FEATURE><FNAME>EF000123</FNAME><FVALUE>C</FVALUE></FEATURE>
      </ARTICLE_FEATURES>
      <ARTICLE_ORDER_DETAILS><ORDER_UNIT>C62</ORDER_UNIT></ARTICLE_ORDER_DETAILS>
      <ARTICLE_PRICE_DETAILS><ARTICLE_PRICE price_type="net_customer"><PRICE_AMOUNT>21,50</PRICE_AMOUNT></ARTICLE_PRICE></ARTICLE_PRICE_DETAILS>
    </ARTICLE>
  </T_NEW_CATALOG>
</BMECAT>`;
const latin1 = (text: string) => Uint8Array.from([...text].map((c) => c.charCodeAt(0)));

describe('XML reader', () => {
  it('reads elements, attributes, entities, CDATA and skips comments', () => {
    const doc = parseXml(`<?xml version="1.0"?><!-- c --><a:root x='1 &gt; 0'><b>T&#252;r &amp; Tor</b><c/><![CDATA[<raw>]]></a:root>`);
    const root = doc.children[0]!;
    expect(root).toMatchObject({ name: 'root', attributes: { x: '1 > 0' }, text: '<raw>' });
    expect(root.children.map((c) => [c.name, c.text])).toEqual([['b', 'Tür & Tor'], ['c', '']]);
  });
});

describe('BMEcat import', () => {
  it('reads a manufacturer catalog with ECLASS features', () => {
    const bytes = new TextEncoder().encode(manufacturer);
    expect(isBmecat(bytes)).toBe(true);
    const catalog = readBmecat(bytes);
    expect(catalog).toMatchObject({ version: '2005', language: 'de', supplier: 'Finder', currency: 'EUR' });
    const [part] = catalogParts(catalog);
    expect(part).toEqual({
      id: 'Finder:40.52.9.024.0000',
      manufacturer: 'Finder',
      partNumber: '40.52.9.024.0000',
      orderNumber: '405290240000',
      description: { de: 'Relais 2 W & LED', en: 'Relay 2 CO <LED>' },
      ean: '8012823000000',
      unit: 'pcs',
      url: 'https://example.com/40.pdf',
      classification: [{ system: 'ECLASS-13.0', id: '27371601' }, { system: 'ETIM-9.0', id: 'EC001437' }],
      price: 125,
      currency: 'EUR',
      priceUnit: 10,
      width: 15.5,
      height: 78,
      ratedVoltage: '24 V DC',
      properties: { '0173-1#02-AAA999#002': '72 MMT', 'Anzahl Wechsler': '2' },
    });
    // an unknown ECLASS code mapped in the dialog
    const features = catalogFeatures(catalog, { '0173-1#02-AAA999#002': 'depth' });
    expect(features.find((f) => f.key === '0173-1#02-AAA999#002')).toMatchObject({ target: 'depth', mapped: true, example: '72', unit: 'MMT' });
    expect(features.find((f) => f.key === '0173-1#02-AAA001#001')).toMatchObject({ name: 'Breite', target: 'width', mapped: false });
    expect(catalogParts(catalog, { '0173-1#02-AAA999#002': 'depth', 'Anzahl Wechsler': 'ignore' })[0]).toMatchObject({ depth: 72 });
    expect(catalogParts(catalog, { 'Anzahl Wechsler': 'ignore' })[0]!.properties).toEqual({ '0173-1#02-AAA999#002': '72 MMT' });
  });

  it('reads a zipped wholesaler catalog (1.2, ISO-8859-1, ETIM): price goes to the supplier', () => {
    const zip = zipSync({ 'catalog.xml': latin1(wholesaler) });
    expect(isBmecat(zip)).toBe(true);
    const catalog = readBmecat(zip);
    expect(catalog.supplier).toBe('Elektro Großhandel AG');
    const [part] = catalogParts(catalog);
    expect(part).toMatchObject({
      id: 'ACME:MCB-C16-3P',
      description: { de: 'Leitungsschutzschalter C16 3-polig, Gerätebreite' },
      ean: '4000000000000',
      width: 54,
      height: 90,
      depth: 70,
      ratedCurrent: 16,
      suppliers: [{ name: 'Elektro Großhandel AG', orderNumber: 'EG-123', price: 21.5, currency: 'EUR' }],
      properties: { EF000123: 'C' },
    });
    expect(part!.price).toBeUndefined();
  });

  it('merges an import into an existing part', () => {
    const merged = mergePart(
      { id: 'A:1', manufacturer: 'A', partNumber: '1', erpNumber: '100', description: { de: 'Alt', en: 'Old' }, suppliers: [{ name: 'X', price: 1 }, { name: 'Y' }], properties: { Lager: 'R3' } },
      { id: 'A:1', manufacturer: 'A', partNumber: '1', description: { de: 'Neu' }, width: 10, suppliers: [{ name: 'X', price: 2 }], properties: { Farbe: 'grau' } },
    );
    expect(merged).toEqual({ id: 'A:1', manufacturer: 'A', partNumber: '1', erpNumber: '100', description: { de: 'Neu', en: 'Old' }, width: 10, suppliers: [{ name: 'Y' }, { name: 'X', price: 2 }], properties: { Lager: 'R3', Farbe: 'grau' } });
  });

  it('combines AC and DC values to UC; voltage ranges stay ranges', () => {
    const catalog = readBmecat(manufacturer.replace('<FVALUE>0</FVALUE>', '<FVALUE>24</FVALUE>'));
    expect(catalogParts(catalog)[0]!.ratedVoltage).toBe('24 V UC');
    const range = readBmecat(manufacturer.replace('<FVALUE>24</FVALUE><FUNIT>VLT</FUNIT>', '<FVALUE>24</FVALUE><FVALUE>240</FVALUE><FUNIT>VLT</FUNIT>'));
    expect(catalogParts(range)[0]!.ratedVoltage).toBe('24 V – 240 V DC');
  });
});
