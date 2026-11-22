---
type: conventions
domain: meta
summary: Choose a home for facts, keep frontmatter consistent, and record durable decisions.
tags: [routing, decisions]
answers:
  - Where should a new fact go?
  - When should I split a note or extract shared knowledge?
  - How should I record a decision?
authority: own
---

# Authoring

## Frontmatter

Use YAML frontmatter on content notes. Set `type`, `domain`, `summary`, `tags`, `answers` and `authority`. The summary is a sentence of up to 160 characters explaining what the note uniquely answers. Provide two to five questions when useful. Set `project` for project notes. Use `authority: own` for the source of a fact and `authority: derived` with a `derived_from` list for a needed synthesis. Quote YAML text with a colon followed by a space.

## Tags and domains

`Rules/rules.json` owns the allowed tags and domains. Pick up to six tags that describe the note. Extend the vocabulary by editing the pack. Prefer a tag used across several notes over one that just repeats a project name.

## Rules

1. Give each fact one home. Link from other notes.
2. When a decision changes, update its known consumers and archive the superseded entry with a link to its replacement.
3. Keep cross-project rules in the most specific shared area that applies.
4. Leave generated router blocks to reindex. Routers describe where to find things.
5. Let Git own the history of changes.
6. Update frontmatter when the note's purpose changes.
7. Write links from the Brain root, without the extension.
8. Cite headings or short quotes so a citation survives line changes.
9. Record unresolved contradictions in a content audit and ask before relying on either claim.
10. Follow [[Rules/Conventions]] for file encoding.
11. Run `node Rules/tools/brain.mjs validate`. Run reindex after adding, moving or renaming notes, or changing a routed summary.

### Rule 12. Split long notes by the question they answer

When a note starts answering several unrelated questions, split it by subject. Keep the entry point as a router. A long reference can stay whole when its readers need it together. Treat size warnings as a prompt to review the scope.

### Rule 13. Record settled choices as ADRs

Keep an index of current decisions in `Decisions.md` or its topic router. Use a numbered decision record with context, decision, alternatives, consequences and affected notes. Mark proposals as proposed and move superseded records to an archive with a link to the replacement. Use [[Rules/Templates#Decision record]].

## Where a new fact goes

| Fact | Home |
| --- | --- |
| A settled choice and its reasons | Decisions, as an ADR |
| Remaining work or an owner's decision | OpenItems, under Open items or Waiting on you |
| Public contract or interface | Contracts |
| Internal design or dependencies | Architecture |
| User experience direction | Design |
| Positioning or audience | Audience |
| Links to supporting material | References |
| What happened during an attempt | Journal |
| A durable correction or procedure | Lessons |
| A recurring explicit working preference | Shared/OwnerProfile |
| Unsettled claims that disagree | The closest content audit |

## When to extract shared knowledge

Move a fact into `Shared/<Stack>/` when at least two current projects need it, its meaning is identical in both, it is stable, and a divergence would be a bug. The shared note owns the fact. Replace the original copies with links.

## Commit settled changes

Commit as soon as the change is settled. Stage only the files you changed. Validate, regenerate the affected routers, and include the generated changes when they belong to the same edit. Leave work under discussion open for review.
