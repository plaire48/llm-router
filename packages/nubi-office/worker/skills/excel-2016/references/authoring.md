# Excel 2016 authoring

Turn the user's requirements into named sheets, concrete input cells, formulas, units, headings and print settings. Ask about unavailable facts rather than inventing them.
Use Excel 2016 formulas such as SUM, IF and INDEX/MATCH when supported by the supplied capability catalog. Do not use XLOOKUP, FILTER or dynamic arrays.
Keep values separate from displayed text. Preserve leading zero identifiers, date system and number formats. Existing formula cells and merged followers are not scalar input anchors.
Read a relevant existing range before editing. After an uncertain write, inspect its receipt; do not issue the write again.
For new documents, `draft/sheet.json` uses name, address, cells, formats, merges, columnWidths, rowHeights, borders and page. A cells entry contains an address and either value or formula. Read exact current text before editing; ambiguous replacements are rejected. A schema rejection leaves the previous draft intact.
Complete draft validation, native Excel calculation/readback and requirements review before proposing final saving. An SDK edit diff proves only the draft text change.
