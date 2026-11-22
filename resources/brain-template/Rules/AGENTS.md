---
type: conventions
domain: meta
summary: Find the note that answers a question and resolve conflicting notes.
tags: [routing]
answers:
  - Where should I look first?
  - What do I do when two notes disagree?
authority: own
---

# Reading the Brain

## Find the right note

1. Look for the question in note frontmatter. Search for the subject before searching for the project name.
2. If the match is unclear, open the root router and follow it to the project or shared router.
3. Open the one or two notes that answer the question. Read only what you need. Keep another project's private notes out of context.

Use the summary to tell similar notes apart. Check code or other primary evidence when current behavior matters. Cite a note by its heading or a short quote. Start with [[Rules/Authoring]] before writing.

## Document types

| Type | Use |
| --- | --- |
| index | Navigation and one-line purposes |
| overview | What a project or area does |
| architecture | How the parts fit together |
| contract | What callers can rely on |
| reference | Exact fields, behavior or source material |
| patterns | Procedures and lessons that can be reused |
| openitems | Work still outstanding |
| decisions | Accepted choices, their reasons and consequences |
| conventions | Rules for working in the Brain |
| shared | Knowledge applicable to several projects |
| spec, roadmap, design, brand | Plans, design intent and positioning |

## When notes disagree

Check the relevant decisions or content audit before treating a conflict as unresolved. When there is no ruling, pause the part of the work that depends on it. Cite both notes and the conflicting wording, explain which reading you would follow and why, and ask the owner to decide. When they settle it, update the affected notes together. A note marked `derived` follows its declared source. If no one can decide, record the disagreement in the closest `_ContentAudit.md`.
