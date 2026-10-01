import { useId, useState } from "react";
import { Icon } from "./Icon";

export function MenuItem({ label, help, danger, onClick }: { label: string; help: string; danger?: boolean; onClick: () => void }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={`menu-row${open ? " open" : ""}`}>
      <button className={danger ? "danger" : undefined} onClick={onClick} aria-describedby={id}>
        {label}
      </button>
      <button
        className="menu-info"
        aria-label={`What does “${label}” do?`}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
      >
        <Icon name="info" size={16} />
      </button>
      <p className="menu-help" id={id} role="note">
        {help}
      </p>
    </div>
  );
}
