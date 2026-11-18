/** Text for the files the "make this a project" wizard creates. Pure, so it is easy to test. */

/** "My Cool Game!" becomes "my-cool-game". */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** "my cool game" becomes "MyCoolGame": the folder name used in the vault. */
export function folderName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

export const gitattributesText = (): string => "* text=auto eol=lf\n";

export const gitignoreText = (): string =>
  [
    "node_modules/",
    "out/",
    "dist/",
    "build/",
    "release/",
    "*.log",
    ".env",
    ".env.*",
    "!.env.example",
    ".DS_Store",
    "Thumbs.db",
    "",
  ].join("\n");

export function readmeText(name: string, stack: string): string {
  return `# ${name}\n\n${stack ? `${stack}.` : "A new project."}\n`;
}

export function mitLicense(year: number, holder: string): string {
  return `MIT License

Copyright (c) ${year} ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
}

/** Points agents at the project's notes without naming any machine path (the repo may be public). */
export function agentsText(name: string, stack: string, brainRepo: string | null): string {
  const notes = brainRepo
    ? `Its notes live in the brain vault, in the \`${brainRepo}\` repo. Read its \`_index.md\` first.`
    : "Its notes live next to this project in the owner's notes folder.";
  return `# ${name}: instructions for the agent

${name}${stack ? ` is ${stack}` : " is a new project"}. ${notes}

- Follow the notes before you change behaviour; record decisions there.
- Files are UTF-8 without BOM, with LF endings.
- Commit messages never carry a \`Co-Authored-By\` trailer.
`;
}

export const claudeText = (): string => "@AGENTS.md\n";

// ---------- brain repo ----------

const q = (text: string): string => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export function brainJson(slug: string, folder: string, description: string): string {
  return `${JSON.stringify(
    {
      repo: `brain-${slug}`,
      folder,
      description,
      depends: [{ folder: "Common", repo: "brain-common" }],
    },
    null,
    2,
  )}\n`;
}

export function brainIndex(name: string, domain: string, description: string): string {
  return `---
type: index
domain: ${domain}
project: ${name}
summary: ${q(`Router for the ${name} notes: where the overview and open items are.`)}
tags: [routing]
answers:
  - ${q(`Where are the notes for ${name}?`)}
authority: own
---

# ${name}: Knowledge Vault

${description}

<!-- BEGIN GENERATED -->
<!-- END GENERATED -->
`;
}

export function brainOverview(
  name: string,
  folder: string,
  domain: string,
  stack: string,
  visibility: string,
): string {
  return `---
type: overview
domain: ${domain}
project: ${name}
summary: ${q(`What ${name} is, what it is built on, and where its code lives.`)}
tags: [roadmap]
answers:
  - ${q(`What is ${name} and what is it built on?`)}
authority: own
---

# ${name}: Overview

**Stack:** ${stack || "to be decided"}
**Code repo:** ${visibility}, on GitHub

## See Also
- [[${folder}/OpenItems]]
`;
}

export function brainOpenItems(name: string, domain: string): string {
  return `---
type: openitems
domain: ${domain}
project: ${name}
summary: ${q(`What is left to do for ${name}, and what waits on the owner.`)}
tags: [open-items]
answers:
  - ${q(`What is left to do for ${name}?`)}
authority: own
---

# ${name}: open items

## Waiting on you
`;
}

// ---------- hub registration ----------

/** Adds a folder to the hub's .gitignore if it is not listed. */
export function addIgnoreLine(gitignore: string, folder: string): string {
  const line = `${folder}/`;
  if (gitignore.split(/\r?\n/).includes(line)) return gitignore;
  return `${gitignore}${gitignore === "" || gitignore.endsWith("\n") ? "" : "\n"}${line}\n`;
}

/** Adds the repo to brain.repos.json, keeping the file's own indent. */
export function addRepoEntry(manifest: string, folder: string, repo: string): string {
  const json = JSON.parse(manifest) as { repos: Array<{ folder: string; repo: string }> };
  if (!json.repos.some((r) => r.folder === folder)) json.repos.push({ folder, repo });
  const indent = /^([ \t]+)"/m.exec(manifest)?.[1] ?? "  ";
  return `${JSON.stringify(json, null, indent.startsWith("\t") ? "\t" : indent.length)}\n`;
}

/** Inserts a row after the last row of the hub router's hand-written repo table. */
export function addHubRow(
  indexMd: string,
  folder: string,
  description: string,
  domain: string,
): string {
  const row = `| \`${folder}/\` | [[${folder}/_index]] | ${description} | \`${domain}\` | Common |`;
  if (indexMd.includes(`| \`${folder}/\` |`)) return indexMd;
  const lines = indexMd.split("\n");
  const archive = lines.findIndex((l) => l.startsWith("`Archive/`"));
  let last = -1;
  lines.forEach((l, i) => {
    if (l.startsWith("| `") && (archive < 0 || i < archive)) last = i;
  });
  if (last < 0) throw new Error("the hub router has no repo table to add a row to");
  lines.splice(last + 1, 0, row);
  return lines.join("\n");
}
