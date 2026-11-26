/* global console */
// Generates src/devices/plc-siemens.json: Siemens ET 200SP, S7-1500 / ET 200MP and S7-1200
// modules with the terminal assignments of the Siemens equipment manuals.
//
//   node packages/library/scripts/siemens-devices.mjs
//
// Every module names the manual its terminals come from (document number, edition, download
// link on cache.industry.siemens.com). The wiring figures are the same in every language, so a
// German, Italian, French, Spanish or Chinese edition is used where Siemens no longer offers the
// English one. Rules:
// - `pin` is the terminal of the signal; `extraPins` are further terminals that belong to this
//   channel alone (sensor supply, minus of a differential input, sense lines, relay contacts).
// - Terminals shared by several channels (L+, M, 1M, 2L, MANA bridged over a group) are left out:
//   a card terminal belongs to one channel.
// - At most four terminals per channel (the I/O point symbols have up to four connections).
// - Modules whose manual could not be obtained keep "check against the manual" in their description.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CACHE = 'https://cache.industry.siemens.com/dl/files/';

/** Manuals: [title, document number + edition, path below CACHE]. */
const M = {
  'sp.di8': ['DI 8x24VDC ST', 'A5E03574157-AF, 02/2019', '552/59753552/att_82860/v1/et200sp_di_8x24vdc_st_manual_en-US_en-US.pdf'],
  'sp.di8.hf': ['DI 8x24VDC HF', 'A5E03576305-AE, 12/2017', '542/66912542/att_882645/v1/et200sp_di_8x24vdc_hf_manual_en-US_en-US.pdf'],
  'sp.di8.ba': ['DI 8x24VDC BA', 'A5E34941724-AB, 02/2019', '184/109475184/att_838677/v1/et200sp_di_8x24vdc_ba_manual_en-US_en-US.pdf'],
  'sp.di16.st': ['DI 16x24VDC ST', 'A5E03573442-AG, 02/2019', '540/59753540/att_882649/v1/et200sp_di_16x24vdc_st_manual_en-US_en-US.pdf'],
  'sp.di4.ac': ['DI 4x120..230VAC ST', 'A5E32043394-AC, 09/2017 (de)', '028/89093028/att_63084/v1/et200sp_di_4x120..230vac_st_manual_de-DE_de-DE.pdf'],
  'sp.di8.namur': ['DI 8xNAMUR HF', 'A5E03894479-AB, 03/2024 (fr)', '921/89116921/att_76340/v5/et200sp_di_8xnamur_hf_manual_fr-FR_fr-FR.pdf'],
  'sp.fdi8': ['F-DI 8x24VDC HF', 'A5E03858068-01, 07/2013', '499/78589499/att_878784/v1/et200sp_f-di_8x24vdc_hf_manual_en-US_en-US.pdf'],
  'sp.dq8': ['DQ 8x24VDC/0.5A ST', 'A5E03574575-AF, 02/2019', '588/59753588/att_90143/v1/et200sp_dq_8x24vdc_0_5a_st_manual_en-US_en-US.pdf'],
  'sp.dq8.hf': ['DQ 8x24VDC/0.5A HF', 'A5E03576680-AE, 12/2017', '554/66912554/att_882661/v1/et200sp_dq_8x24vdc_0_5a_hf_manual_en-US_en-US.pdf'],
  'sp.dq16.st': ['DQ 16x24VDC/0.5A ST', 'A5E03574420-AE, 01/2025', '564/59753564/att_863743/v2/et200sp_dq_16x24vdc_0_5a_st_manual_en-US_en-US.pdf'],
  'sp.dq4.2a': ['DQ 4x24VDC/2A ST', 'A5E03574516-AD, 12/2015', '576/59753576/att_882653/v1/et200sp_dq_4x24vdc_2a_st_manual_en-US_en-US.pdf'],
  'sp.dq4.ac': ['DQ 4x24..230VAC/2A ST', 'A5E32043575-AA, 02/2014', '725/89117725/att_79515/v1/et200sp_dq_4x24..230vac_2a_st_manuel_en-US_en-US.pdf'],
  'sp.rq4': ['RQ 4x24VUC/2A CO ST', 'A5E32855952-AD, 02/2019', '012/89117012/att_97692/v1/et200sp_rq_4x24vuc_2a_co_st_manual_en-US_en-US.pdf'],
  'sp.fdq4': ['F-DQ 4x24VDC/2A PM HF', 'A5E03858037-01, 07/2013', '789/78645789/att_878790/v4/et200sp_f-dq_4x24vdc_2a_pm_hf_manual_en-US_en-US.pdf'],
  'sp.ai4.ui': ['AI 4xU/I 2-wire ST', 'A5E03572837-AG, 09/2026 (it)', '624/59753624/att_75683/v2/et200sp_ai_4xu_i_2_wire_st_manual_it-IT_it-IT.pdf'],
  'sp.ai2.i.st': ['AI 2xI 2-/4-wire ST', 'A5E36104399-AB, 04/2026', '112/109481112/att_863696/v2/et200sp_ai_2xi_2_4_wire_st_manual_en-US_en-US.pdf'],
  'sp.ai8.u.ba': ['AI 8xU BA', 'A5E34941660-AA, 03/2015', '182/109475182/att_1341455/v1/et200sp_ai_8xu_ba_manual_en_US_en-US.pdf'],
  'sp.ai2.ui.hs': ['AI 2xU/I 2-/4-wire HS', 'A5E03576060-AD, 06/2015', '737/73108737/att_851185/v1/et200sp_ai_2xu_i_2_4_wire_hs_manual_en-US_en-US.pdf'],
  'sp.ai4.rtd': ['AI 4xRTD/TC 2-/3-/4-wire HF', 'A5E03573292-AH, 04/2026 (es)', '600/59753600/att_71720/v2/et200sp_ai_4xrtd_tc_2_3_4_wire_hf_manual_es-ES_es-ES.pdf'],
  'sp.ai8.rtd': ['AI 8xRTD/TC 2-wire HF', 'A5E32942598-AE, 04/2026 (it)', '957/89116957/att_108041/v2/et200sp_ai_8xrtd_tc_2_wire_hf_manual_it-IT_it-IT.pdf'],
  'sp.aq4.ui': ['AQ 4xU/I ST', 'A5E03573365-AD, 03/2016', '612/59753612/att_886744/v1/et200sp_aq_4xu_i_st_manual_en-US_en-US.pdf'],
  'sp.aq2.u.st': ['AQ 2xU ST', 'A5E36105235-AB, 01/2025 (de)', '115/109481115/att_863690/v2/et200sp_aq_2xu_st_manual_de-DE_de-DE.pdf'],
  'sp.aq2.i.st': ['AQ 2xI ST', 'A5E36104864-AB, 01/2025', '114/109481114/att_863694/v2/et200sp_aq_2xi_st_manual_en-US_en-US.pdf'],
  'sp.aq2.hf': ['AQ 2xU/I HF', 'A5E33062535-AB, 01/2025 (zh)', '933/89116933/att_103557/v2/et200sp_aq_2xu_i_hf_manual_zh-CHS_zh-CHS.pdf'],
  'sp.aq2.hs': ['AQ 2xU/I HS', 'A5E03576140-AD, 09/2016', '773/73108773/att_897302/v1/et200sp_aq_2xu_i_hs_manual_en-US_en-US.pdf'],
  'sp.im155-6pn.st': ['IM 155-6 PN ST', 'A5E03576904-AE, 04/2017', '173/59768173/att_917983/v1/et200sp_im_155_6_pn_st_manual_en-US_en-US.pdf'],
  'sp.system': ['ET 200SP system manual', 'A5E03576849-AF, 12/2015', '293/58649293/att_863460/v1/et200sp_system_manual_en-US_en-US.pdf'],
  'mp.di16.hf': ['DI 16x24VDC HF', 'A5E03485952-AE, 04/2015', '001/59193001/att_842420/v1/s71500_di_16x24vdc_hf_manual_en-US_en-US.pdf'],
  'mp.di16.ba': ['DI 16x24VDC BA', 'A5E32363114-AD, 12/2016', '190/83501190/att_905051/v1/s71500_di_16x24vdc_ba_manual_en-US_en-US.pdf'],
  'mp.di32.hf': ['DI 32x24VDC HF', 'A5E03485935-AH, 05/2022', '896/59192896/att_897449/v1/s71500_di_32x24vdc_hf_manual_en-US_en-US.pdf'],
  'mp.di32.ba': ['DI 32x24VDC BA', 'A5E32363711-AD, 12/2016', '481/83499481/att_905045/v1/s71500_di_32x24vdc_ba_manual_en-US_en-US.pdf'],
  'mp.di16.ac': ['DI 16x230VAC BA', 'A5E03485975-AD, 09/2016', '398/59193398/att_897452/v1/s71500_di_16x230vac_ba_manual_en-US_en-US.pdf'],
  'mp.fdi16': ['F-DI 16x24VDC', 'A5E03858068-AA, 01/2016', '426/109482426/att_867088/v1/et200mp_f_di_16x24vdc_manual_en-us_en-us.pdf'],
  'mp.dq16.st': ['DQ 16x24VDC/0.5A ST', 'A5E03485531-AD, 09/2016', '401/59193401/att_902699/v1/s71500_dq_16x24vdc_0_5a_st_manual_en-US_en-US.pdf'],
  'mp.dq16.hf': ['DQ 16x24VDC/0.5A HF', 'A5E35683409-AA, 11/2015', '717/109480717/att_861355/v1/s71500_dq_16x24vdc_0_5a_hf_manual_en-US_en-US.pdf'],
  'mp.dq16.ba': ['DQ 16x24VDC/0.5A BA', 'A5E32364017-AB, 09/2014', '415/83500415/att_42076/v1/s71500_dq_16x24vdc_0_5a_ba_manual_en-US_en-US.pdf'],
  'mp.dq32.st': ['DQ 32x24VDC/0.5A ST', 'A5E03485060-AD, 09/2016', '400/59193400/att_902644/v1/s71500_dq_32x24vdc_0_5a_st_manual_en-US_en-US.pdf'],
  'mp.dq32.hf': ['DQ 32x24VDC/0.5A HF', 'A5E35683508-AC, 06/2018', '716/109480716/att_902641/v1/s71500_dq_32x24vdc_0_5a_hf_manual_en-US_en-US.pdf'],
  'mp.dq32.ba': ['DQ 32x24VDC/0.5A BA', 'A5E32364205-AC, 09/2016', '404/83500404/att_902696/v1/s71500_dq_32x24vdc_0_5a_ba_manual_en-US_en-US.pdf'],
  'mp.dq8.2a.hf': ['DQ 8x24VDC/2A HF', 'A5E03485650-AF, 06/2018', '089/59193089/att_902698/v1/s71500_dq_8x24vdc_2a_hf_manual_en-US_en-US.pdf'],
  'mp.dq8.ac': ['DQ 8x230VAC/2A ST', 'A5E03485733-AE, 12/2021', '088/59193088/att_902697/v1/s71500_dq_8x230vac_2a_st_manual_en-US_en-US.pdf'],
  'mp.rq8': ['DQ 8x230VAC/5A ST', 'A5E03485590-AE, 04/2020', '181/109780181/att_1023186/v1/s71500_dq_8x230vac_5a_st_manual_en-US_en-US.pdf'],
  'mp.fdq8': ['F-DQ 8x24VDC/2A PPM', 'A5E03858037-AA, 01/2016', '427/109482427/att_888090/v1/et200mp_f_dq_8x24vdc_2a_ppm_manual_en-US_en-US.pdf'],
  'mp.dio16.ba': ['DI 16x24VDC/DQ 16x24VDC/0.5A BA', 'A5E32364588-AB, 09/2014', '523/83501523/att_42300/v1/s71500_di_16x24vdc_dq_16x24vdc_0.5a_ba_manual_en-US_en-US.pdf'],
  'mp.ai8.st': ['AI 8xU/I/RTD/TC ST', 'A5E03484864-AE, 08/2018', '205/59193205/att_902256/v1/s71500_ai_8xu_i_rtd_tc_st_manual_en-US_en-US.pdf'],
  'mp.ai4.st': ['AI 4xU/I/RTD/TC ST', 'A5E32366209-AC, 09/2016', '401/91688401/att_902251/v1/s71500_ai_4xu_i_rtd_tc_st_manual_en-US_en-US.pdf'],
  'mp.ai8.hs': ['AI 8xU/I HS', 'A5E03484886-AE, 12/2016', '206/59193206/att_905030/v1/s71500_ai_8xu_i_hs_manual_en-US_en-US.pdf'],
  'mp.aq4.st': ['AQ 4xU/I ST', 'A5E03484696-AE, 08/2018', '850/59191850/att_903132/v1/s71500_aq_4xu_i_st_manual_en-US_en-US.pdf'],
  'mp.aq2.st': ['AQ 2xU/I ST', 'A5E32366632-AB, 09/2014', '388/91688388/att_75101/v1/s71500_aq_2xu_i_st_manual_en-US_en-US.pdf'],
  'mp.cpu1511c': ['CPU 1511C-1 PN', 'A5E40898565-AC, 05/2024', '074/109963074/att_1275085/v1/s71500_cpu1511c_1_pn_dtc_manual_en-US_en-US.pdf'],
  'mp.cpu1512c': ['CPU 1512C-1 PN', 'A5E40898741-AC, 05/2024', '073/109963073/att_1275073/v1/s71500_cpu1512c_1_pn_dtc_manual_en-US_en-US.pdf'],
  'mp.system': ['S7-1500/ET 200MP system manual', 'A5E03461182-AC, 12/2014', '792/59191792/att_856649/v1/s71500_et200mp_system_manual_en-US_en-US.pdf'],
  'eco.oi': ['ET 200eco PN operating instructions', 'A5E01250250-AJ, 08/2016', '018/29999018/att_892032/v1/et200eco_pn_operating_instructions_en-US_en-US.pdf'],
  'eco.di8l': ['DI 8x24VDC M12-L 8xM12', 'A5E46570417-AE, 06/2024', '293/109778293/att_1027365/v3/et200ecopn_di_8x24vdc_m12l_8xm12_manual_en-US_en-US.pdf'],
  'eco.di16l': ['DI 16x24VDC M12-L 8xM12', 'A5E46570510-AE, 06/2024', '294/109778294/att_1027382/v4/et200ecopn_di_16x24vdc_m12l_8xm12_manual_en-US_en-US.pdf'],
  's12.easy': ['S7-1200 Easy Book', 'A5E02486774-AG, 01/2015', '145/39710145/att_5787/v1/s71200_easy_book_en-US_en-US.pdf'],
  's12.sys': ['S7-1200 system manual', 'A5E02669003-02, 11/2009 (ru)', '465/36932465/att_106131/v1/s71200_system_manual_ru-RU.pdf'],
};

const UNVERIFIED = {
  de: 'Klemmenbelegung und Bestellnummer nach Herstellerunterlagen prüfen.',
  en: "Check the pin assignment and order number against the manufacturer's documentation.",
};

function source(key) {
  const [title, doc, path] = M[key];
  return {
    de: `Klemmenbelegung aus dem Siemens-Gerätehandbuch ${title} (${doc}): ${CACHE}${path}`,
    en: `Pin assignment from the Siemens equipment manual ${title} (${doc}): ${CACHE}${path}`,
  };
}

function partOnly(key) {
  const [title, doc, path] = M[key];
  return {
    de: `Bestellnummer aus ${title} (${doc}): ${CACHE}${path}`,
    en: `Order number from ${title} (${doc}): ${CACHE}${path}`,
  };
}

// ---- channel helpers ------------------------------------------------------------------------

/** A channel: kind, number, terminal, further terminals [pin, label, before?]. */
function ch(kind, channel, pin, extra = [], pinLabel) {
  const c = { channel, kind, pin: String(pin) };
  if (pinLabel) c.pinLabel = pinLabel;
  if (extra.length) c.extraPins = extra.map(([p, label, before]) => (before ? { pin: String(p), label } : { pin: String(p), label, after: true }));
  return c;
}
const range = (n) => [...Array(n).keys()];

// ---- device builder -------------------------------------------------------------------------

const devices = [];
function device({ id, name, category, partNumber, description, channels = [], cpu = false }) {
  const functions = [
    { symbol: 'wirewright.plc.card', main: true, label: cpu ? { de: 'Übersicht', en: 'Overview' } : { de: 'Kartenübersicht', en: 'Card overview' } },
  ];
  for (const c of channels) {
    const pins = [...(c.extraPins ?? []).filter((p) => !p.after).map((p) => p.pin), c.pin, ...(c.extraPins ?? []).filter((p) => p.after).map((p) => p.pin)];
    if (pins.length > 4) throw new Error(`${id}: channel ${c.kind} ${c.channel} has more than 4 terminals`);
    const n = pins.length;
    functions.push({
      symbol: `wirewright.plc.${c.kind.toLowerCase()}${n > 1 ? `.${n}` : ''}`,
      channel: c.channel,
      pins: Object.fromEntries(pins.map((p, k) => [String(k + 1), p])),
      label: `${c.kind} ${c.channel} (pin ${pins.join(', ')})`,
    });
  }
  const d = { id, name: { de: name, en: name }, category, manufacturer: 'Siemens', partNumber, description, functions };
  if (channels.length) d.plc = { channels };
  const all = channels.flatMap((c) => [c.pin, ...(c.extraPins ?? []).map((p) => p.pin)]);
  if (new Set(all).size !== all.length) throw new Error(`${id}: a terminal is used twice`);
  if (devices.some((x) => x.id === id)) throw new Error(`${id}: duplicate id`);
  devices.push(d);
}

// =============================================================================================
// ET 200SP (BaseUnit terminals 1..16)
// =============================================================================================
const SP = 'plc.siemens.et200sp';
const sp = (id, name, partNumber, key, channels) =>
  device({ id: `siemens.et200sp.${id}`, name: `ET 200SP ${name}`, category: SP, partNumber, description: key ? source(key) : UNVERIFIED, channels });

// digital inputs: DIn on n+1, per-channel sensor supply on n+9
sp('di8', 'DI 8x24VDC ST', '6ES7131-6BF01-0BA0', 'sp.di8', range(8).map((n) => ch('DI', n, n + 1, [[n + 9, '24 V DC']])));
sp('di8.hf', 'DI 8x24VDC HF', '6ES7131-6BF00-0CA0', 'sp.di8.hf', range(8).map((n) => ch('DI', n, n + 1, [[n + 9, `L+${n}`]])));
sp('di8.ba', 'DI 8x24VDC BA', '6ES7131-6BF01-0AA0', 'sp.di8.ba', range(8).map((n) => ch('DI', n, n + 1, [[n + 9, '24 V DC']])));
sp('di16.st', 'DI 16x24VDC ST', '6ES7131-6BH01-0BA0', 'sp.di16.st', range(16).map((n) => ch('DI', n, n + 1)));
sp('di4.ac', 'DI 4x120..230VAC ST', '6ES7131-6FD01-0BB1', 'sp.di4.ac', range(4).map((n) => ch('DI', n, n + 1, [[n + 5, 'L1'], [n + 9, 'N']])));
sp('di8.namur', 'DI 8xNAMUR HF', '6ES7131-6TF00-0CA0', 'sp.di8.namur', range(8).map((n) => ch('DI', n, n + 1, [[n + 9, `US${n}`]])));
// fail-safe input: internal sensor supply VSn on n+9 feeds the contact, drawn before the input
sp('fdi8', 'F-DI 8x24VDC HF (with sensor supplies)', '6ES7136-6BA01-0CA0', 'sp.fdi8', range(8).map((n) => ch('DI', n, n + 1, [[n + 9, `VS${n}`, true]])));

// digital outputs
sp('dq8', 'DQ 8x24VDC/0.5A ST', '6ES7132-6BF01-0BA0', 'sp.dq8', range(8).map((n) => ch('DO', n, n + 1, [[n + 9, 'M']])));
sp('dq8.hf', 'DQ 8x24VDC/0.5A HF', '6ES7132-6BF00-0CA0', 'sp.dq8.hf', range(8).map((n) => ch('DO', n, n + 1, [[n + 9, 'M']])));
sp('dq16.st', 'DQ 16x24VDC/0.5A ST', '6ES7132-6BH01-0BA0', 'sp.dq16.st', range(16).map((n) => ch('DO', n, n + 1)));
sp('dq4.2a', 'DQ 4x24VDC/2A ST', '6ES7132-6BD20-0BA0', 'sp.dq4.2a', range(4).map((n) => ch('DO', n, n + 1, [[n + 5, `DQ${n}`], [n + 9, 'M'], [n + 13, 'M']])));
sp('dq4.ac', 'DQ 4x24..230VAC/2A ST', '6ES7132-6FD00-0BB1', 'sp.dq4.ac', range(4).map((n) => ch('DO', n, n + 1, [[n + 9, 'N']])));
// relay changeover contact: NO 14.n is the output, common 11.n and NC 12.n follow
sp('rq4', 'RQ 4x24VUC/2A CO ST', '6ES7132-6GD51-0BA0', 'sp.rq4', range(4).map((n) => ch('DO', n, n + 5, [[n + 9, `11.${n}`], [n + 1, `12.${n}`]], `14.${n}`)));
sp('fdq4', 'F-DQ 4x24VDC/2A PM HF', '6ES7136-6DB00-0CA0', 'sp.fdq4', range(4).map((n) => ch('DO', n, n + 1, [[n + 5, `DQ-P${n}`], [n + 9, `DQ-M${n}`], [n + 13, `DQ-M${n}`]], `DQ-P${n}`)));

// analog inputs
sp('ai4.ui', 'AI 4xU/I 2-wire ST', '6ES7134-6HD01-0BA1', 'sp.ai4.ui', range(4).map((n) => ch('AI', n, n + 1, [[n + 5, `U${n}-`], [n + 9, `UV${n}`], [n + 13, `I${n}+`]], `U${n}+`)));
sp('ai4.i', 'AI 4xI 2-/4-wire ST', '6ES7134-6GD01-0BA1', null, range(4).map((n) => ch('AI', n, n + 1)));
sp('ai2.i.st', 'AI 2xI 2-/4-wire ST', '6ES7134-6GB00-0BA1', 'sp.ai2.i.st', range(2).map((n) => ch('AI', n, n + 5, [[n + 7, `I${n}-`], [n + 9, `1UV${n}`], [n + 13, `2UV${n}`]], `I${n}+`)));
sp('ai8.i.ba', 'AI 8xI 2-/4-wire BA', '6ES7134-6GF00-0AA1', null, range(8).map((n) => ch('AI', n, n + 1)));
sp('ai8.u.ba', 'AI 8xU BA', '6ES7134-6FF00-0AA1', 'sp.ai8.u.ba', range(8).map((n) => ch('AI', n, n + 1, [[n + 9, 'MANA']], `U${n}+`)));
sp('ai2.ui.hs', 'AI 2xU/I 2-/4-wire HS', '6ES7134-6HB00-0DA1', 'sp.ai2.ui.hs', range(2).map((n) => ch('AI', n, n + 1, [[n + 3, `U${n}-`], [n + 5, `I${n}+`], [n + 7, `I${n}-`]], `U${n}+`)));
sp('ai4.rtd', 'AI 4xRTD/TC 2-/3-/4-wire HF', '6ES7134-6JD00-0CA1', 'sp.ai4.rtd', range(4).map((n) => ch('AI', n, n + 1, [[n + 5, `M${n}-`], [n + 9, `IC${n}+`], [n + 13, `IC${n}-`]], `M${n}+`)));
sp('ai8.rtd', 'AI 8xRTD/TC 2-wire HF', '6ES7134-6JF00-0CA1', 'sp.ai8.rtd', range(8).map((n) => ch('AI', n, n + 1, [[n + 9, `M${n}-`]], `M${n}+`)));

// analog outputs: Qn+ / Qn- and the sense lines Sn+ / Sn-
const aqSense = (n) => ch('AO', n, n + 1, [[n + 5, `Q${n}-`], [n + 9, `S${n}+`], [n + 13, `S${n}-`]], `Q${n}+`);
sp('aq4.ui', 'AQ 4xU/I ST', '6ES7135-6HD00-0BA1', 'sp.aq4.ui', range(4).map(aqSense));
sp('aq2.ui.hf', 'AQ 2xU/I HF', '6ES7135-6HB00-0CA1', 'sp.aq2.hf', range(2).map(aqSense));
sp('aq2.ui.hs', 'AQ 2xU/I HS', '6ES7135-6HB00-0DA1', 'sp.aq2.hs', range(2).map(aqSense));
sp('aq2.u.st', 'AQ 2xU ST', '6ES7135-6FB00-0BA1', 'sp.aq2.u.st', range(2).map((n) => ch('AO', n, n + 1, [[n + 5, `Q${n}-`]], `Q${n}+`)));
sp('aq2.i.st', 'AQ 2xI ST', '6ES7135-6GB00-0BA1', 'sp.aq2.i.st', range(2).map((n) => ch('AO', n, n + 1, [[n + 5, `Q${n}-`]], `Q${n}+`)));

// interface modules, BaseUnits, server module (no I/O channels)
for (const [id, name, pn, key] of [
  ['im155-6pn.st', 'IM 155-6 PN ST', '6ES7155-6AU01-0BN0', 'sp.im155-6pn.st'],
  ['im155-6pn.hf', 'IM 155-6 PN HF', '6ES7155-6AU30-0CN0', null],
  ['im155-6pn.ba', 'IM 155-6 PN BA', '6ES7155-6AR00-0AN0', null],
]) {
  device({ id: `siemens.et200sp.${id}`, name: `ET 200SP ${name}`, category: 'plc.cpu', partNumber: pn, description: key ? partOnly(key) : UNVERIFIED, cpu: true });
}
for (const [id, name, pn] of [
  ['bu15-p16-a0-2d', 'BaseUnit BU15-P16+A0+2D (light, new potential group)', '6ES7193-6BP00-0DA0'],
  ['bu15-p16-a0-2b', 'BaseUnit BU15-P16+A0+2B (dark, continues the potential group)', '6ES7193-6BP00-0BA0'],
  ['server', 'Server module', '6ES7193-6PA00-0AA0'],
]) {
  device({ id: `siemens.et200sp.${id}`, name: `ET 200SP ${name}`, category: SP, partNumber: pn, description: partOnly('sp.system') });
}

// =============================================================================================
// S7-1500 / ET 200MP (40-pin front connector)
// =============================================================================================
const MP = 'plc.siemens.s71500';
const mp = (id, name, partNumber, key, channels) =>
  device({ id: `siemens.s71500.${id}`, name: `S7-1500 / ET 200MP ${name}`, category: MP, partNumber, description: key ? source(key) : UNVERIFIED, channels });

/** Digital channel n on the front connector: groups of 8 on 1-8, 11-18, 21-28, 31-38. */
const fc = (n) => 10 * Math.floor(n / 8) + 1 + (n % 8);
/** Channel n of the modules with two terminals per channel: 1/2, 5/6, 11/12, 15/16, 21/22 … */
const pair = (n) => [1, 5, 11, 15][n % 4] + 20 * Math.floor(n / 4);

mp('di16.hf', 'DI 16x24VDC HF', '6ES7521-1BH00-0AB0', 'mp.di16.hf', range(16).map((n) => ch('DI', n, fc(n))));
mp('di16.ba', 'DI 16x24VDC BA', '6ES7521-1BH10-0AA0', 'mp.di16.ba', range(16).map((n) => ch('DI', n, fc(n))));
mp('di32.hf', 'DI 32x24VDC HF', '6ES7521-1BL00-0AB0', 'mp.di32.hf', range(32).map((n) => ch('DI', n, fc(n))));
mp('di32.ba', 'DI 32x24VDC BA', '6ES7521-1BL10-0AA0', 'mp.di32.ba', range(32).map((n) => ch('DI', n, fc(n))));
// 4 groups of 4 inputs on every second terminal, N of the group on 8/18/28/38 (shared)
mp('di16.ac', 'DI 16x230VAC BA', '6ES7521-1FH00-0AA0', 'mp.di16.ac', range(16).map((n) => ch('DI', n, 10 * Math.floor(n / 4) + 1 + 2 * (n % 4))));
// 4 groups of 4 inputs on 2/4/6/8, sensor supply of the group on 1/11/21/31 (shared)
mp('fdi16', 'F-DI 16x24VDC', '6ES7526-1BH00-0AB0', 'mp.fdi16', range(16).map((n) => ch('DI', n, 10 * Math.floor(n / 4) + 2 + 2 * (n % 4))));
mp('dq16.st', 'DQ 16x24VDC/0.5A ST', '6ES7522-1BH00-0AB0', 'mp.dq16.st', range(16).map((n) => ch('DO', n, fc(n))));
mp('dq16.hf', 'DQ 16x24VDC/0.5A HF', '6ES7522-1BH01-0AB0', 'mp.dq16.hf', range(16).map((n) => ch('DO', n, fc(n))));
mp('dq16.ba', 'DQ 16x24VDC/0.5A BA', '6ES7522-1BH10-0AA0', 'mp.dq16.ba', range(16).map((n) => ch('DO', n, fc(n))));
mp('dq32.st', 'DQ 32x24VDC/0.5A ST', '6ES7522-1BL00-0AB0', 'mp.dq32.st', range(32).map((n) => ch('DO', n, fc(n))));
mp('dq32.hf', 'DQ 32x24VDC/0.5A HF', '6ES7522-1BL01-0AB0', 'mp.dq32.hf', range(32).map((n) => ch('DO', n, fc(n))));
mp('dq32.ba', 'DQ 32x24VDC/0.5A BA', '6ES7522-1BL10-0AA0', 'mp.dq32.ba', range(32).map((n) => ch('DO', n, fc(n))));
mp('dq8.2a.hf', 'DQ 8x24VDC/2A HF', '6ES7522-1BF00-0AB0', 'mp.dq8.2a.hf', range(8).map((n) => ch('DO', n, n + 1)));
// isolated outputs: supply side on the first terminal, load side on the second
mp('dq8.ac', 'DQ 8x230VAC/2A ST', '6ES7522-5FF00-0AB0', 'mp.dq8.ac', range(8).map((n) => ch('DO', n, pair(n) + 1, [[pair(n), 'L', true]])));
mp('rq8', 'DQ 8x230VAC/5A ST (relay)', '6ES7522-5HF00-0AB0', 'mp.rq8', range(8).map((n) => ch('DO', n, pair(n) + 1, [[pair(n), 'L', true]])));
mp('fdq8', 'F-DQ 8x24VDC/2A PPM', '6ES7526-2BF00-0AB0', 'mp.fdq8', range(8).map((n) => ch('DO', n, pair(n), [[pair(n) + 1, `DQ-M${n}`]], `DQ-P${n}`)));
mp('dio16.ba', 'DI 16x24VDC/DQ 16x24VDC/0.5A BA', '6ES7523-1BL00-0AA0', 'mp.dio16.ba', [
  ...range(16).map((n) => ch('DI', n, fc(n))),
  ...range(16).map((n) => ch('DO', n, fc(n + 16))),
]);

/** AI ST/HS: per channel 4 terminals from b = 1, 5, 9, 13 (+20 for channels 4-7). */
const aiBase = (n) => 4 * (n % 4) + 1 + 20 * Math.floor(n / 4);
const aiSt = (n) => { const b = aiBase(n); return ch('AI', n, b + 2, [[b + 3, `M${n}-`], [b + 1, `I${n}+`], [b, `UV${n}`]], `U${n}+`); };
mp('ai8.st', 'AI 8xU/I/RTD/TC ST', '6ES7531-7KF00-0AB0', 'mp.ai8.st', range(8).map(aiSt));
mp('ai4.st', 'AI 4xU/I/RTD/TC ST', '6ES7531-7QD00-0AB0', 'mp.ai4.st', range(4).map(aiSt));
mp('ai8.hs', 'AI 8xU/I HS', '6ES7531-7NF10-0AB0', 'mp.ai8.hs', range(8).map((n) => { const b = aiBase(n); return ch('AI', n, b + 2, [[b + 3, `U${n}-`], [b + 1, `I${n}+`]], `U${n}+`); }));
/** AQ ST: QVn/QIn, Sn+, Sn-, MANA on 4 terminals from 1, 5, 9, 13. */
const aqSt = (n) => { const b = 4 * n + 1; return ch('AO', n, b, [[b + 1, `S${n}+`], [b + 2, `S${n}-`], [b + 3, 'MANA']], `QV${n}`); };
mp('aq4.st', 'AQ 4xU/I ST', '6ES7532-5HD00-0AB0', 'mp.aq4.st', range(4).map(aqSt));
mp('aq2.st', 'AQ 2xU/I ST', '6ES7532-5NB00-0AB0', 'mp.aq2.st', range(2).map(aqSt));
mp('aq8.hs', 'AQ 8xU/I HS', '6ES7532-5HF00-0AB0', null, range(8).map((n) => ch('AO', n, `CH${n}`)));

device({ id: 'siemens.et200mp.im155-5pn.st', name: 'ET 200MP IM 155-5 PN ST', category: 'plc.cpu', partNumber: '6ES7155-5AA01-0AB0', description: UNVERIFIED, cpu: true });

// power supplies (load current supply PM, system power supply PS)
for (const [id, name, pn] of [
  ['pm1507-3a', 'PM 1507 24 V/3 A (load current supply, 120/230 V AC)', '6EP1332-4BA00'],
  ['pm1507-8a', 'PM 1507 24 V/8 A (load current supply, 120/230 V AC)', '6EP1333-4BA00'],
  ['ps25w-24vdc', 'PS 25W 24V DC (system power supply)', '6ES7505-0KA00-0AB0'],
  ['ps60w-24-48-60vdc', 'PS 60W 24/48/60V DC (system power supply)', '6ES7505-0RA00-0AB0'],
]) {
  device({ id: `siemens.s71500.${id}`, name: `S7-1500 ${name}`, category: MP, partNumber: pn, description: UNVERIFIED });
}

// CPUs
const cpus = [
  ['cpu1511-1pn', 'CPU 1511-1 PN', '6ES7511-1AL03-0AB0'],
  ['cpu1511f-1pn', 'CPU 1511F-1 PN', '6ES7511-1FL03-0AB0'],
  ['cpu1513-1pn', 'CPU 1513-1 PN', '6ES7513-1AM03-0AB0'],
  ['cpu1513f-1pn', 'CPU 1513F-1 PN', '6ES7513-1FM03-0AB0'],
  ['cpu1515-2pn', 'CPU 1515-2 PN', '6ES7515-2AN03-0AB0'],
  ['cpu1515f-2pn', 'CPU 1515F-2 PN', '6ES7515-2FN03-0AB0'],
  ['cpu1516-3pndp', 'CPU 1516-3 PN/DP', '6ES7516-3AP03-0AB0'],
  ['cpu1516f-3pndp', 'CPU 1516F-3 PN/DP', '6ES7516-3FP03-0AB0'],
  ['cpu1517-3pndp', 'CPU 1517-3 PN/DP', '6ES7517-3AP00-0AB0'],
  ['cpu1517f-3pndp', 'CPU 1517F-3 PN/DP', '6ES7517-3FP00-0AB0'],
  ['cpu1518-4pndp', 'CPU 1518-4 PN/DP', '6ES7518-4AX00-1AB0'],
  ['cpu1518f-4pndp', 'CPU 1518F-4 PN/DP', '6ES7518-4FX00-1AB0'],
  ['cpu1510sp-1pn', 'CPU 1510SP-1 PN (ET 200SP)', '6ES7510-1DK03-0AB0'],
  ['cpu1510spf-1pn', 'CPU 1510SP F-1 PN (ET 200SP)', '6ES7510-1SK03-0AB0'],
  ['cpu1512sp-1pn', 'CPU 1512SP-1 PN (ET 200SP)', '6ES7512-1DM03-0AB0'],
  ['cpu1512spf-1pn', 'CPU 1512SP F-1 PN (ET 200SP)', '6ES7512-1SM03-0AB0'],
];
for (const [id, name, pn] of cpus) {
  device({ id: `siemens.s71500.${id}`, name: `S7-1500 ${name}`, category: 'plc.cpu', partNumber: pn, description: UNVERIFIED, cpu: true });
}

/**
 * Compact CPUs: on-board I/O on front connectors X10 (analog) and X11 (digital; 1512C also X12).
 * Terminals are named "X11.21". X10: AI 0-3 with U+ 3n+1, I+ 3n+2, U-/I- 3n+3; AI 4 (RTD) on
 * M+ 13, M- 14, IC+ 15, IC- 16; AQ 0/1 on 17/18 with MANA on 19/20.
 */
function compactIo(connectors) {
  const x10 = [
    ...range(4).map((n) => ch('AI', n, `X10.${3 * n + 1}`, [[`X10.${3 * n + 3}`, `U${n}-/I${n}-`], [`X10.${3 * n + 2}`, `I${n}+`]], `U${n}+`)),
    ch('AI', 4, 'X10.13', [['X10.14', 'M4-'], ['X10.15', 'IC4+'], ['X10.16', 'IC4-']], 'M4+'),
    ...range(2).map((n) => ch('AO', n, `X10.${17 + n}`, [[`X10.${19 + n}`, 'MANA']], `QV${n}`)),
  ];
  const digital = connectors.flatMap((x, k) => [
    ...range(16).map((n) => ch('DI', 16 * k + n, `${x}.${fc(n)}`, [], `DI${n}`)),
    ...range(16).map((n) => ch('DO', 16 * k + n, `${x}.${fc(n + 16)}`, [], `DQ${n}`)),
  ]);
  return [...x10, ...digital];
}
device({ id: 'siemens.s71500.cpu1511c-1pn', name: 'S7-1500 CPU 1511C-1 PN (compact, onboard I/O)', category: 'plc.cpu', partNumber: '6ES7511-1CL03-0AB0', description: source('mp.cpu1511c'), channels: compactIo(['X11']), cpu: true });
device({ id: 'siemens.s71500.cpu1512c-1pn', name: 'S7-1500 CPU 1512C-1 PN (compact, onboard I/O)', category: 'plc.cpu', partNumber: '6ES7512-1CM03-0AB0', description: source('mp.cpu1512c'), channels: compactIo(['X11', 'X12']), cpu: true });

// =============================================================================================
// ET 200eco PN (IP67, M12 sockets; terminals named "X1.4" = socket X1, pin 4)
// =============================================================================================
const ECO = 'plc.siemens.et200eco';
const eco = (id, name, partNumber, key, channels) =>
  device({ id: `siemens.et200eco.${id}`, name: `ET 200eco PN ${name}`, category: ECO, partNumber, description: source(key), channels });
/** One channel per socket on pin 4, with the socket's 24 V (pin 1) and ground (pin 3). */
const ecoSingle = (kind, count, supply, first = 1) => range(count).map((n) => ch(kind, n, `X${first + n}.4`, [[`X${first + n}.1`, supply], [`X${first + n}.3`, 'M']]));
/** Two channels per socket: pin 4 and pin 2 (24 V and ground of the socket are shared, so left out). */
const ecoDouble = (kind, sockets, first = 1) => [
  ...range(sockets).map((n) => ch(kind, n, `X${first + n}.4`)),
  ...range(sockets).map((n) => ch(kind, n + sockets, `X${first + n}.2`)),
];
// 4xM12: DI0-DI3 on pin 4, DI4-DI7 on pin 2 of X1-X4 (table 3-4)
eco('di8.4m12', 'DI 8x24VDC 4xM12', '6ES7141-6BF00-0AB0', 'eco.oi', ecoDouble('DI', 4));
eco('di8.8m12', 'DI 8x24VDC 8xM12', '6ES7141-6BG00-0AB0', 'eco.oi', ecoSingle('DI', 8, '1US'));
eco('di16.8m12', 'DI 16x24VDC 8xM12', '6ES7141-6BH00-0BA0', 'eco.oi', ecoDouble('DI', 8));
eco('dq8.1a3.4m12', 'DQ 8x24VDC/1.3A 4xM12', '6ES7142-6BF00-0AB0', 'eco.oi', ecoDouble('DO', 4));
eco('dq8.0a5.4m12', 'DQ 8x24VDC/0.5A 4xM12', '6ES7142-6BF50-0AB0', 'eco.oi', ecoDouble('DO', 4));
eco('dq8.1a3.8m12', 'DQ 8x24VDC/1.3A 8xM12', '6ES7142-6BG00-0AB0', 'eco.oi', range(8).map((n) => ch('DO', n, `X${n + 1}.4`, [[`X${n + 1}.3`, n < 4 ? '1M' : '2M']])));
eco('dq8.2a.8m12', 'DQ 8x24VDC/2.0A 8xM12', '6ES7142-6BR00-0AB0', 'eco.oi', range(8).map((n) => ch('DO', n, `X${n + 1}.4`, [[`X${n + 1}.3`, n < 4 ? '1M' : '2M']])));
eco('dq16.8m12', 'DQ 16x24VDC/1.3A 8xM12', '6ES7142-6BH00-0AB0', 'eco.oi', ecoDouble('DO', 8));
// AO: Q+ on pin 2, Q- on pin 4, actuator supply 1UA pin 1, ground pin 3 (table 3-22)
eco('aq4.4m12', 'AQ 4xU/I 4xM12', '6ES7145-6HD00-0AB0', 'eco.oi', range(4).map((n) => ch('AO', n, `X${n + 1}.2`, [[`X${n + 1}.4`, `Q${n}-`], [`X${n + 1}.1`, '1UA'], [`X${n + 1}.3`, '1M']], `Q${n}+`)));
// M12-L devices: I/O sockets X10-X17 (default assignment: one input per socket)
eco('di8.m12l', 'DI 8x24VDC M12-L 8xM12', '6ES7141-6BG00-0BB0', 'eco.di8l', ecoSingle('DI', 8, '1US', 10));
eco('di16.m12l', 'DI 16x24VDC M12-L 8xM12', '6ES7141-6BH00-0BB0', 'eco.di16l', ecoDouble('DI', 8, 10));

// =============================================================================================
// S7-1200 (terminals named as printed on the device: DIa.0, DQb.1, AI0, 0+ …)
// =============================================================================================
const S12 = 'plc.siemens.s71200';
const dig = (kind, prefix, count, start = 0) => range(count).map((n) => ch(kind, start + n, `${prefix}${n < 8 ? 'a' : 'b'}.${n % 8}`));
const s12Cpus = [
  // [id, name, part numbers DC/DC/DC, AC/DC/RLY, DC/DC/RLY, DI, DQ, manual]
  ['cpu1211c', 'CPU 1211C', ['6ES7211-1AE40-0XB0', '6ES7211-1BE40-0XB0', '6ES7211-1HE40-0XB0'], 6, 4, 's12.sys'],
  ['cpu1212c', 'CPU 1212C', ['6ES7212-1AE40-0XB0', '6ES7212-1BE40-0XB0', '6ES7212-1HE40-0XB0'], 8, 6, 's12.sys'],
  ['cpu1214c', 'CPU 1214C', ['6ES7214-1AG40-0XB0', '6ES7214-1BG40-0XB0', '6ES7214-1HG40-0XB0'], 14, 10, 's12.easy'],
];
for (const [id, name, pns, di, dq, key] of s12Cpus) {
  ['DC/DC/DC', 'AC/DC/RLY', 'DC/DC/RLY'].forEach((variant, k) => {
    device({
      id: `siemens.s71200.${id}.${variant.toLowerCase().replaceAll('/', '-')}`,
      name: `S7-1200 ${name} ${variant}`,
      category: 'plc.cpu',
      partNumber: pns[k],
      description: source(key),
      channels: [...dig('DI', 'DI', di), ...range(2).map((n) => ch('AI', n, `AI${n}`)), ...dig('DO', 'DQ', dq)],
      cpu: true,
    });
  });
}
const s12 = (id, name, partNumber, channels) =>
  device({ id: `siemens.s71200.${id}`, name: `S7-1200 ${name}`, category: S12, partNumber, description: source('s12.easy'), channels });
s12('sm1221.di8', 'SM 1221 DI 8x24VDC', '6ES7221-1BF32-0XB0', dig('DI', 'DI', 8));
s12('sm1221.di16', 'SM 1221 DI 16x24VDC', '6ES7221-1BH32-0XB0', dig('DI', 'DI', 16));
s12('sm1222.dq8', 'SM 1222 DQ 8x24VDC', '6ES7222-1BF32-0XB0', dig('DO', 'DQ', 8));
s12('sm1222.dq8.rly', 'SM 1222 DQ 8xRelay', '6ES7222-1HF32-0XB0', dig('DO', 'DQ', 8));
s12('sm1222.dq16', 'SM 1222 DQ 16x24VDC', '6ES7222-1BH32-0XB0', dig('DO', 'DQ', 16));
s12('sm1222.dq16.rly', 'SM 1222 DQ 16xRelay', '6ES7222-1HH32-0XB0', dig('DO', 'DQ', 16));
s12('sm1223.di8dq8', 'SM 1223 DI 8x24VDC / DQ 8x24VDC', '6ES7223-1BH32-0XB0', [...dig('DI', 'DI', 8), ...dig('DO', 'DQ', 8)]);
s12('sm1223.di8dq8.rly', 'SM 1223 DI 8x24VDC / DQ 8xRelay', '6ES7223-1PH32-0XB0', [...dig('DI', 'DI', 8), ...dig('DO', 'DQ', 8)]);
s12('sm1223.di16dq16', 'SM 1223 DI 16x24VDC / DQ 16x24VDC', '6ES7223-1BL32-0XB0', [...dig('DI', 'DI', 16), ...dig('DO', 'DQ', 16)]);
s12('sm1223.di16dq16.rly', 'SM 1223 DI 16x24VDC / DQ 16xRelay', '6ES7223-1PL32-0XB0', [...dig('DI', 'DI', 16), ...dig('DO', 'DQ', 16)]);
s12('sm1223.di8ac.dq8rly', 'SM 1223 DI 8x120/230VAC / DQ 8xRelay', '6ES7223-1QH32-0XB0', [...dig('DI', 'DI', 8), ...dig('DO', 'DQ', 8)]);
const s12ai = (n) => ch('AI', n, `${n}+`, [[`${n}-`, `${n}-`]]);
const s12aq = (n) => ch('AO', n, `${n}`, [[`${n}M`, `${n}M`]]);
s12('sm1231.ai4', 'SM 1231 AI 4x13 bit', '6ES7231-4HD32-0XB0', range(4).map(s12ai));
s12('sm1231.ai8', 'SM 1231 AI 8x13 bit', '6ES7231-4HF32-0XB0', range(8).map(s12ai));
s12('sm1232.aq2', 'SM 1232 AQ 2x14 bit', '6ES7232-4HB32-0XB0', range(2).map(s12aq));
s12('sm1232.aq4', 'SM 1232 AQ 4x14 bit', '6ES7232-4HD32-0XB0', range(4).map(s12aq));
s12('sm1234.ai4aq2', 'SM 1234 AI 4x13 bit / AQ 2x14 bit', '6ES7234-4HE32-0XB0', [...range(4).map(s12ai), ...range(2).map(s12aq)]);

const out = join(dirname(fileURLToPath(import.meta.url)), '../src/devices/plc-siemens.json');
writeFileSync(out, `${JSON.stringify(devices, null, 2)}\n`);
console.log(`${devices.length} devices written to ${out}`);
