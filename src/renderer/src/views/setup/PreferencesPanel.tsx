import { useState } from "react";
import type { AppSettingsPatch } from "@shared/models";
import { Button, Chip, ErrorBanner, Panel } from "../../components/ui";
import { office } from "../../lib/ipc";
import { useQuery } from "../../lib/hooks";

const field = "rounded border px-2 py-1";
const fieldStyle = { borderColor: "var(--line)", background: "var(--bg)", color: "var(--text)" };

const KINDS = [
  "agent.needs-you",
  "agent.done",
  "agent.failed",
  "git.conflict",
  "git.push-failed",
  "git.behind",
  "ci.failed",
  "pr.review-requested",
  "vault.waiting-new",
  "vault.write-failed",
  "task.gate",
  "task.done",
  "automation.done",
  "brief.ready",
];

/** Theme, accent and density, plus the notification rules: quiet hours, muted projects, what is urgent, ntfy. */
export function PreferencesPanel() {
  const settings = useQuery("settings.get");
  const workspace = useQuery("workspace.get", undefined, ["workspace.changed"]);
  const projects = useQuery("projects.list");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const [artRoot, setArtRoot] = useState<string | null>(null);
  const s = settings.data;
  const rules = workspace.data?.workspace?.notifications;

  const run = async (work: () => Promise<unknown>): Promise<void> => {
    setError(null);
    setNote(null);
    try {
      await work();
      settings.reload();
      workspace.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const set = (patch: AppSettingsPatch): Promise<void> =>
    run(async () => {
      await office.invoke("settings.set", patch);
      // Re-render the shell so the new theme shows at once.
      window.dispatchEvent(new Event("office-settings"));
    });
  const toggle = (list: string[], item: string): string[] =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

  return (
    <div className="grid gap-4" data-testid="preferences">
      {error && <ErrorBanner message={error} />}
      {note && <Chip tone="good">{note}</Chip>}
      <Panel title="Appearance">
        {s && (
          <div className="grid gap-2.5">
            <div className="flex items-center gap-4">
              <span className="w-28">Theme</span>
              {(["system", "light", "dark"] as const).map((t) => (
                <label key={t} className="flex items-center gap-1">
                  <input
                    type="radio"
                    checked={s.theme === t}
                    onChange={() => void set({ theme: t })}
                    data-testid={`theme-${t}`}
                  />{" "}
                  {t}
                </label>
              ))}
            </div>
            <div className="flex items-center gap-4">
              <span className="w-28">Accent colour</span>
              <input
                type="color"
                value={s.accent}
                onChange={(e) => void set({ accent: e.target.value })}
                aria-label="Accent colour"
                data-testid="accent"
              />
            </div>
            <div className="flex items-center gap-4">
              <span className="w-28">Density</span>
              {(["comfortable", "compact"] as const).map((d) => (
                <label key={d} className="flex items-center gap-1">
                  <input
                    type="radio"
                    checked={s.density === d}
                    onChange={() => void set({ density: d })}
                    data-testid={`density-${d}`}
                  />{" "}
                  {d}
                </label>
              ))}
            </div>
          </div>
        )}
      </Panel>
      <Panel title="Art vault">
        {s && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-28">Folder</span>
            <input
              className={`${field} min-w-[280px] flex-1`}
              style={fieldStyle}
              placeholder="A folder outside your project repos"
              value={artRoot ?? s.artVaultRoot}
              onChange={(e) => setArtRoot(e.target.value)}
              aria-label="Art vault folder"
              data-testid="art-vault"
            />
            <Button
              onClick={() =>
                void set({ artVaultRoot: (artRoot ?? s.artVaultRoot).trim() }).then(() => {
                  setArtRoot(null);
                  setNote("Saved.");
                })
              }
              data-testid="art-vault-save"
            >
              Save
            </Button>
            <span className="w-full text-[12px]" style={{ color: "var(--muted)" }}>
              A finished Art request is copied to a folder named after its project in here.
            </span>
          </div>
        )}
      </Panel>
      <Panel title="Notification rules">
        {s && rules && (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-28">Quiet hours</span>
              <input
                type="time"
                className={field}
                style={fieldStyle}
                value={s.quietHours?.from ?? "22:00"}
                aria-label="Quiet from"
                data-testid="quiet-from"
                onChange={(e) =>
                  void set({
                    quietHours: { from: e.target.value, to: s.quietHours?.to ?? "07:00" },
                  })
                }
              />
              to
              <input
                type="time"
                className={field}
                style={fieldStyle}
                value={s.quietHours?.to ?? "07:00"}
                aria-label="Quiet to"
                data-testid="quiet-to"
                onChange={(e) =>
                  void set({
                    quietHours: { from: s.quietHours?.from ?? "22:00", to: e.target.value },
                  })
                }
              />
              {s.quietHours ? (
                <Button onClick={() => void set({ quietHours: null })}>Turn off</Button>
              ) : (
                <Chip>off</Chip>
              )}
              <span className="text-[12px]" style={{ color: "var(--muted)" }}>
                Urgent alerts are held back, but still land in the inbox.
              </span>
            </div>
            <div>
              <div className="mb-1">Muted projects</div>
              <div className="flex flex-wrap gap-3">
                {(projects.data ?? []).map((p) => (
                  <label key={p.id} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={rules.mutedProjects.includes(p.id)}
                      onChange={() =>
                        void run(() =>
                          office.invoke("notifications.setRules", {
                            mutedProjects: toggle(rules.mutedProjects, p.id),
                          }),
                        )
                      }
                      data-testid={`mute-${p.id}`}
                    />{" "}
                    {p.name}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1">What counts as urgent (desktop alert and phone ping)</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {KINDS.map((k) => (
                  <label key={k} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={rules.urgent.includes(k)}
                      onChange={() =>
                        void run(() =>
                          office.invoke("notifications.setRules", {
                            urgent: toggle(rules.urgent, k),
                          }),
                        )
                      }
                      data-testid={`urgent-${k}`}
                    />{" "}
                    {k}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-28">Phone pings</span>
              <input
                className={`${field} min-w-[280px] flex-1`}
                style={fieldStyle}
                placeholder="https://ntfy.sh/your-private-topic"
                value={topic ?? rules.ntfyTopicUrl ?? ""}
                onChange={(e) => setTopic(e.target.value)}
                aria-label="ntfy topic URL"
                data-testid="ntfy-url"
              />
              <Button
                onClick={() =>
                  void run(async () => {
                    await office.invoke("notifications.setRules", {
                      ntfyTopicUrl: topic ?? rules.ntfyTopicUrl ?? "",
                    });
                    setTopic(null);
                    setNote("Saved.");
                  })
                }
                data-testid="ntfy-save"
              >
                Save
              </Button>
              <Button
                onClick={() =>
                  void run(async () => {
                    await office.invoke("notifications.testPing");
                    setNote("Test ping sent.");
                  })
                }
                data-testid="ntfy-test"
              >
                Send a test ping
              </Button>
              <div className="basis-full text-[12px]" style={{ color: "var(--muted)" }}>
                Anyone who knows the topic can read the pings, so pick a hard-to-guess name. Only
                urgent notifications are sent.
              </div>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
