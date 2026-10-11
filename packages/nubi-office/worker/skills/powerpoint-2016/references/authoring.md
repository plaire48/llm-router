# PowerPoint 2016 authoring

Build a coherent sequence appropriate to the requested audience and purpose. Each slide needs a specific message, concise supported content and useful notes when requested.
For existing templates, make the approved native copy first and retain its restricted target binding. Use the observed layout and geometry rather than guessing a new master.
Only advertised native operations are writable. Mixed text runs, charts and unsupported shapes must not be flattened into plain text to pretend preservation. Bounded unmerged tables expose individual native cells. Read their headers and row labels, then use replace_table_cell only on an observed editable cell. Preserve all other cells, row/column sizes, fill, borders, layout and notes. Merged, mixed-run or multiline cells remain read-only; this tool never creates or restyles a table.
After creating a slide, repair that same slide using set_slide_content; never duplicate successful creation to fix a wording error. Check observed overflow, requirement coverage, native receipts and final save approval.

For a small edit in a selected multiline text box, use replace_text_fragment only when the observed shape reports fragmentEditable:true. Provide one unique literal findText and its inline replacement. Whole-shape replace_text remains restricted. Keep paragraph breaks, bullets, fonts, notes and geometry, then inspect all receipt checks. Native Windows validation remains required.
