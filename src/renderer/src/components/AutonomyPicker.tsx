import { useState } from "react";
import { AUTONOMY_LEVELS, AutonomyLevel } from "@shared/autonomy";
import { useQuery } from "../lib/hooks";
import { office } from "../lib/ipc";
import { Button, Dialog, Dropdown, StatusBadge, notifyError } from "../ui";

export function AutonomyPicker({
  value,
  onChange,
  disabled = false,
  label = "Autonomy",
}: {
  value: AutonomyLevel;
  onChange: (level: AutonomyLevel) => void | Promise<unknown>;
  disabled?: boolean;
  label?: string;
}) {
  const settings = useQuery("settings.get", undefined, ["settings.changed"]);
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const choose = async (level: AutonomyLevel, confirmed = false): Promise<void> => {
    if (level === "full-auto" && !confirmed && settings.data?.confirmedFullAuto !== true) {
      setConfirm(true);
      return;
    }
    setSaving(true);
    try {
      if (confirmed) await office.invoke("settings.set", { confirmedFullAuto: true });
      await onChange(level);
      setConfirm(false);
    } catch (err) {
      notifyError(err, "Autonomy could not be changed", "autonomy");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Dropdown
        aria-label={label}
        title={AUTONOMY_LEVELS[value].description}
        value={value}
        disabled={disabled || saving}
        onChange={(e) => void choose(AutonomyLevel.parse(e.target.value))}
      >
        {AutonomyLevel.options.map((level) => (
          <option key={level} value={level}>{AUTONOMY_LEVELS[level].label}</option>
        ))}
      </Dropdown>
      {value === "full-auto" && <StatusBadge status="info" tone="attention" label="Full auto on" />}
      {confirm && (
        <Dialog
          title="Enable full auto?"
          onClose={() => setConfirm(false)}
          footer={
            <>
              <Button onClick={() => setConfirm(false)} disabled={saving}>Cancel</Button>
              <Button variant="danger" onClick={() => void choose("full-auto", true)} disabled={saving}>
                Enable full auto
              </Button>
            </>
          }
        >
          <p className="m-0">The agent can change or delete files anywhere your account has access and run commands without approval.</p>
        </Dialog>
      )}
    </div>
  );
}
