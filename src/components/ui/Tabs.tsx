import { useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { t } from "../../lib/i18n";
import styles from "./ui.module.css";

export interface TabItem {
  id: string;
  label: ReactNode;
  count?: number;
}

export function Tabs({
  items,
  value,
  onChange,
  label,
  variant = "pill",
}: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  variant?: "pill" | "underline";
}) {
  const underline = variant === "underline";
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = (index + 1) % items.length;
        break;
      case "ArrowLeft":
        next = (index + items.length - 1) % items.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = items.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const item = items[next];
    if (!item) return;
    onChange(item.id);
    buttons.current.get(item.id)?.focus();
  }
  return (
    <div
      className={underline ? styles.underlineTabs : styles.tabs}
      role="tablist"
      aria-label={label}
    >
      {items.map((item, index) => {
        const active = item.id === value;
        const className = underline
          ? [styles.underlineTab, active ? styles.underlineTabActive : ""].filter(Boolean).join(" ")
          : [styles.tab, active ? styles.tabActive : ""].filter(Boolean).join(" ");
        return (
          <button
            key={item.id}
            ref={(node) => {
              if (node) buttons.current.set(item.id, node);
              else buttons.current.delete(item.id);
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active || (!items.some((entry) => entry.id === value) && index === 0) ? 0 : -1}
            className={className}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => move(event, index)}
          >
            {typeof item.label === "string" ? t(item.label) : item.label}
            {typeof item.count === "number" ? (
              <span className={styles.tabCount}>{item.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
