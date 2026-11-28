# Beckhoff terminals from the Beckhoff Information System

Python 3 scripts that read the connection tables of Beckhoff terminals from
infosys.beckhoff.com and turn them into device definitions for
`src/devices/plc-beckhoff.json`. Run them from this folder; downloaded pages are
cached in `cache/` (not committed).

1. `python3 tree.py` – the documentation families below EtherCAT Terminals,
   EtherCAT Box, Bus Terminals and EtherCAT plug-in modules (`families.json`).
2. `python3 crawl.py "EtherCAT Terminals"` (and the other groups) – walks each
   family's manual and collects the pages about connections (`pages-*.json`).
3. `python3 eval.py` – checks the mapper against the terminals already in the
   library (same terminal assignment for 176 of the 199 hand-checked ones).
4. `python3 generate.py` – device definitions for part numbers not in the
   library yet (`new-devices.json`): channels for the I/O series 1–4 (signal
   terminal, then terminals of the same channel – sensor supply, minus line,
   GND, shield, relay contacts – at most four, shared supply terminals left
   out), parts without channels for special terminals (5–9). These were merged
   into `plc-beckhoff.json` (sorted by part number).

EtherCAT Box (EP, EPP, EQ, ER) pages show the M8/M12 pin assignment as
drawings only and are not imported.
