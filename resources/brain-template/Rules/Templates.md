---
type: conventions
domain: meta
summary: Starting shapes for a new note, router and decision record.
tags: [routing, decisions]
answers:
  - What frontmatter does a new note start with?
  - What goes in an ADR?
authority: own
---

# Templates

Use [[Rules/Authoring]] to choose a note type and location.

## Note

```markdown
---
type: overview
domain: meta
summary: "What this area does and where a reader should start."
tags: [routing]
answers:
  - What does this area do?
  - Where is the next note?
authority: own
---

# Title
```

## Router

Use the Note template with `type: index`. Add the generated area below the heading.

```markdown
<!-- BEGIN GENERATED -->
<!-- END GENERATED -->
```

## Decision record

```markdown
## ADR-1 A short title

**Status:** Accepted
**Date:** YYYY-MM-DD
**Context:** What made a choice necessary.
**Decision:** What was chosen.
**Alternatives:** What else was considered.
**Consequences:** What changes and what must now hold.
**Affects:** Links to relevant notes and code.
```
