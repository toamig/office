import { FolderOpen } from "lucide-react";
import { useState } from "react";
import type { AppSettingsPatch } from "@shared/models";
import { Button, Card, SegmentedControl as Segmented, notifyDone, notifyError } from "../../ui";
import { office } from "../../lib/ipc";
import { useQuery } from "../../lib/hooks";
import { PALETTES } from "@shared/theme";
import { AutonomyPicker } from "../../components/AutonomyPicker";

/** What a notification kind is called on screen, by the value the code uses. */
const KINDS: Array<[string, string]> = [
  ["agent.needs-you", "An agent needs you"],
  ["agent.done", "An agent finished"],
  ["agent.failed", "An agent failed"],
  ["git.conflict", "A sync conflict"],
  ["git.push-failed", "A push failed"],
  ["git.behind", "A repo is behind"],
  ["ci.failed", "Checks failed"],
  ["pr.review-requested", "A review was requested"],
  ["vault.waiting-new", "A new item waits on you"],
  ["vault.write-failed", "A note could not be written"],
  ["task.gate", "A task waits for approval"],
  ["task.done", "A task finished"],
  ["automation.done", "A workflow ran"],
  ["brief.ready", "The morning brief is ready"],
  ["permission.request", "An agent asks permission"],
];

/** The look and the sessions and background settings (General), the Art vault (Folders), and the notification rules (Notifications). */
export function PreferencesPanel({ part }: { part: "general" | "folders" | "notifications" }) {
  const settings = useQuery("settings.get");
  const workspace = useQuery("workspace.get", undefined, ["workspace.changed"]);
  const projects = useQuery("projects.list");
  const [topic, setTopic] = useState<string | null>(null);
  const [artRoot, setArtRoot] = useState<string | null>(null);
  // What was just chosen shows at once; it is dropped when the saved settings catch up, or when saving fails.
  const [draft, setDraft] = useState<Pick<AppSettingsPatch, "theme" | "accent" | "density">>({});
  const saved = settings.data;
  const s = saved && { ...saved, ...draft };
  const [seen, setSeen] = useState(saved);
  if (saved !== seen) {
    // The saved settings changed: drop the choices they have caught up with.
    setSeen(saved);
    if (saved) {
      const next = { ...draft };
      for (const key of ["theme", "accent", "density"] as const) {
        if (next[key] !== undefined && next[key] === saved[key]) delete next[key];
      }
      setDraft(next);
    }
  }
  const theme = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  const rules = workspace.data?.workspace?.notifications;

  const run = async (work: () => Promise<unknown>): Promise<void> => {
    try {
      await work();
      settings.reload();
      workspace.reload();
    } catch (err) {
      notifyError(err, "That setting was not saved", "preferences");
    }
  };
  const set = (patch: AppSettingsPatch): Promise<void> => {
    const look: Pick<AppSettingsPatch, "theme" | "accent" | "density"> = {};
    if (patch.theme !== undefined) look.theme = patch.theme;
    if (patch.accent !== undefined) look.accent = patch.accent;
    if (patch.density !== undefined) look.density = patch.density;
    setDraft((d) => ({ ...d, ...look }));
    return run(async () => {
      try {
        await office.invoke("settings.set", patch);
      } catch (err) {
        setDraft((d) => {
          const next = { ...d };
          for (const key of Object.keys(look) as Array<keyof typeof look>) delete next[key];
          return next;
        });
        throw err;
      }
      // Re-render the shell so the new theme shows at once.
      window.dispatchEvent(new Event("office-settings"));
    });
  };
  const toggle = (list: string[], item: string): string[] =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

  return (
    <div className="contents" data-testid="preferences">
      {part === "general" && (
        <Card title="Appearance" testId="panel-appearance">
          {s && (
            <div className="grid gap-2.5">
              <div className="flex items-center gap-4">
                <span className="w-28">Theme</span>
                <Segmented
                  label="Theme"
                  value={s.theme}
                  onChange={(t) => void set({ theme: t })}
                  options={[
                    { value: "system", label: "System", testId: "theme-system" },
                    { value: "light", label: "Light", testId: "theme-light" },
                    { value: "dark", label: "Dark", testId: "theme-dark" },
                  ]}
                />
              </div>
              <div className="flex items-center gap-4">
                <span className="w-28">Accent colour</span>
                <input
                  type="color"
                  value={s.accent || PALETTES[theme].accent}
                  onChange={(e) => void set({ accent: e.target.value })}
                  aria-label="Accent colour"
                  data-testid="accent"
                />
              </div>
              <div className="flex items-center gap-4">
                <span className="w-28">Density</span>
                <Segmented
                  label="Density"
                  value={s.density}
                  onChange={(v) => void set({ density: v })}
                  options={[
                    { value: "comfortable", label: "Comfortable", testId: "density-comfortable" },
                    { value: "compact", label: "Compact", testId: "density-compact" },
                  ]}
                />
              </div>
            </div>
          )}
        </Card>
      )}
      {part === "general" && (
        <Card title="Sessions" testId="panel-sessions">
          {s && (
            <div className="mb-3 grid gap-1">
              <span className="ui-label">Default autonomy</span>
              <AutonomyPicker value={s.autonomy} label="Default autonomy" onChange={(autonomy) => set({ autonomy })} />
            </div>
          )}
          {s && (
            <div className="flex flex-wrap items-center gap-2">
              <span>Ask whether a session is still needed after</span>
              <input
                type="number"
                min={1}
                max={60}
                className="w-20"
                value={s.sessionIdleDays}
                aria-label="Days before a session is asked about"
                data-testid="session-idle-days"
                onChange={(e) => {
                  const days = Number(e.target.value);
                  if (Number.isInteger(days) && days >= 1 && days <= 60)
                    void set({ sessionIdleDays: days });
                }}
              />
              <span>days of doing nothing.</span>
              <span className="ui-helper w-full">
                It asks once, with Wrap up and Keep. Keep starts the time again.
              </span>
            </div>
          )}
        </Card>
      )}
      {part === "general" && (
        <Card title="Background" testId="panel-background">
          {s && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.startWithWindows} data-testid="start-with-windows"
                onChange={(event) => void set({ startWithWindows: event.target.checked })} />
              Start Office with Windows
            </label>
          )}
          <p className="ui-helper">
            Office then starts minimised to the tray. While a scheduled workflow is on, closing the window keeps Office
            running in the tray, so the workflow still runs. Quit is in the tray menu.
          </p>
        </Card>
      )}
      {part === "folders" && (
        <Card title="Art vault" testId="panel-art-vault">
          {s && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-28">Folder</span>
              <input
                className="min-w-[280px] flex-1"
                placeholder="A folder outside your project repos"
                value={artRoot ?? s.artVaultRoot}
                onChange={(e) => setArtRoot(e.target.value)}
                aria-label="Art vault folder"
                data-testid="art-vault"
              />
              <Button
                onClick={() =>
                  void office.invoke("setup.pickFolder", { title: "Choose the Art vault folder" }).then((folder) => {
                    if (!folder) return;
                    // A folder picked with Browse is saved at once, like every other path field.
                    void set({ artVaultRoot: folder }).then(() => {
                      setArtRoot(null);
                      notifyDone("Saved", undefined, "preferences");
                    });
                  })
                }
                data-testid="art-vault-browse"
              >
                <FolderOpen size={14} /> Browse
              </Button>
              <Button
                onClick={() =>
                  void set({ artVaultRoot: (artRoot ?? s.artVaultRoot).trim() }).then(() => {
                    setArtRoot(null);
                    notifyDone("Saved", undefined, "preferences");
                  })
                }
                data-testid="art-vault-save"
              >
                Save
              </Button>
              <span className="ui-helper w-full">
                A finished Art request is copied to a folder named after its project in here.
              </span>
            </div>
          )}
        </Card>
      )}
      {part === "notifications" && (
        <Card title="Notification rules" testId="panel-notification-rules">
          {s && rules && (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-28">Quiet hours</span>
                <input
                  type="time"
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
                  <span className="ui-muted">Off</span>
                )}
                <span className="text-[length:var(--text-xs)] ui-muted">
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
                  {KINDS.map(([k, name]) => (
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
                      {name}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-28">Phone pings</span>
                <input
                  className="min-w-[280px] flex-1"
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
                      notifyDone("Saved", undefined, "preferences");
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
                      notifyDone("Test ping sent", "Check your phone.", "preferences");
                    })
                  }
                  data-testid="ntfy-test"
                >
                  Send a test ping
                </Button>
                <div className="basis-full text-[length:var(--text-xs)] ui-muted">
                  Anyone who knows the topic can read the pings, so pick a hard-to-guess name. Only
                  urgent notifications are sent.
                </div>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
