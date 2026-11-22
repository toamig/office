---
type: conventions
domain: meta
summary: Rules that apply whenever an agent reads or writes this Brain.
tags: [routing]
answers:
  - What must an agent remember every session?
  - Where are the full rules?
authority: derived
derived_from: [Rules/AGENTS, Rules/Authoring, Rules/Conventions]
---

# Brain rules

- Search by question, then follow routers to the relevant note. If notes disagree and there is no ruling, cite both and ask. [[Rules/AGENTS]]
- Give every fact one home. Link from other notes and use the placement table before writing. [[Rules/Authoring#Where a new fact goes]]
- Record settled choices as ADRs, split long notes by subject, and extract shared facts when the four tests apply. [[Rules/Authoring]]
- Validate before committing. Regenerate router tables when their source changes and stage only your own files. [[Rules/Authoring]]
- Use UTF-8 without a byte order mark and LF line endings. [[Rules/Conventions]]
