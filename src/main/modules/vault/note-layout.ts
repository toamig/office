import { stringify } from "yaml";

export const NOTE_LAYOUT = {
  overview: { file: "Overview.md", type: "overview", heading: "Overview", summary: "What this project does, who it serves, and how it fits together." },
  decision: { file: "Decisions.md", type: "decisions", heading: "Decided", summary: "What the project decided and the reasons for each choice." },
  todo: { file: "OpenItems.md", type: "openitems", heading: "Open items", summary: "What remains open and which items need the owner's attention." },
  waiting: { file: "OpenItems.md", type: "openitems", heading: "Waiting on you", summary: "What remains open and which items need the owner's attention." },
  architecture: { file: "Architecture.md", type: "architecture", heading: "Architecture", summary: "How this project is structured and how its parts interact." },
  contract: { file: "Contracts.md", type: "contract", heading: "Contracts", summary: "What the project exposes and what its callers can rely on." },
  design: { file: "Design.md", type: "design", heading: "Design and direction", summary: "How the project should feel, look, and work for its users." },
  audience: { file: "Audience.md", type: "brand", heading: "Audience and marketing", summary: "Who the audience is, what they need, and how to reach them." },
  reference: { file: "References.md", type: "reference", heading: "References", summary: "Where to find related source material, artwork, videos and links." },
  journal: { file: "Journal.md", type: "overview", heading: "Journal", summary: "What happened during project sessions and what they accomplished." },
  lesson: { file: "Lessons.md", type: "patterns", heading: "Lessons", summary: "What went wrong or was corrected, and what to do next time." },
  profile: { file: "OwnerProfile.md", type: "conventions", heading: "Working preferences", summary: "How the owner prefers to work, including recurring corrections and preferences." },
} as const;

export type NoteDestination = keyof typeof NOTE_LAYOUT;

export function starterNote(destination: NoteDestination, project?: string, domain = "meta"): string {
  const note = NOTE_LAYOUT[destination];
  const title = note.file === "OpenItems.md" ? "Open items" : note.heading;
  const frontmatter = stringify({
    type: note.type,
    domain,
    ...(project ? { project } : {}),
    summary: note.summary,
    tags: [],
    answers: [note.summary, `What should I look up under ${title}?`],
    authority: "own",
  });
  return `---\n${frontmatter}---\n\n# ${title}\n\n## ${note.heading}\n`;
}
