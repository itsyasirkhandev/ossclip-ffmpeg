import React, { useEffect, useRef } from "react";

export interface ModalShellProps {
  onClose: () => void;
  title: React.ReactNode;
  /** Screen-reader name when `title` is not a plain string. */
  ariaLabel?: string;
  subtitle?: React.ReactNode;
  /** Stable for e2e (`data-testid` on the panel). */
  testId?: string;
  /** Buttons / controls pinned under the body. */
  footer?: React.ReactNode;
  children: React.ReactNode;
  /** Width override; 560 is the shell default. */
  width?: number;
  /** Panel is a `<form>` — Enter submits (delete dialogs' contract). */
  asForm?: boolean;
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
  /** Header affordance: ✕ icon (default), esc chip, or none (required picker). */
  close?: "icon" | "chip" | "none";
  closeLabel?: string;
  closeTestId?: string;
  /** Escape + backdrop dismiss. `false` = required picker (nothing to go back to). */
  dismissable?: boolean;
  /** Mono type for keybinds / delete / picker panels. */
  mono?: boolean;
  panelStyle?: React.CSSProperties;
  panelRef?: React.Ref<HTMLFormElement | HTMLDivElement>;
}

/**
 * One modal chrome for the editor. The nine panels each carried a
 * copy-pasted backdrop/panel/header/close block that had already drifted
 * (two radii, three backdrop alphas, green-confirm glow on five of them).
 * Escape and click-away both close when `dismissable` (default), matching
 * the delete dialogs' contract.
 *
 * Focus: Escape is capture-phase so app-level shortcuts under the modal
 * never see the press (same rule as App's YouTube menu).
 */
export const ModalShell: React.FC<ModalShellProps> = ({
  onClose,
  title,
  ariaLabel,
  subtitle,
  testId,
  footer,
  children,
  width,
  asForm = false,
  onSubmit,
  close = "icon",
  closeLabel = "esc close",
  closeTestId,
  dismissable = true,
  mono = false,
  panelStyle,
  panelRef,
}) => {
  const innerRef = useRef<HTMLFormElement | HTMLDivElement | null>(null);

  useEffect(() => {
    if (!dismissable) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose, dismissable]);

  const setRefs = (node: HTMLFormElement | HTMLDivElement | null) => {
    innerRef.current = node;
    if (typeof panelRef === "function") panelRef(node);
    else if (panelRef) (panelRef as React.MutableRefObject<typeof node>).current = node;
  };

  const resolvedAria = ariaLabel ?? (typeof title === "string" ? title : undefined);

  const panelProps = {
    ref: setRefs,
    className: "ossclip-modal-panel",
    "data-testid": testId,
    role: "dialog" as const,
    "aria-modal": true,
    "aria-label": resolvedAria,
    style: {
      ...(width !== undefined ? { width } : undefined),
      ...(mono ? { fontFamily: "var(--font-mono)" } : undefined),
      ...panelStyle,
    },
    onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
  };

  const headerClose =
    close === "none" ? null : close === "chip" ? (
      <button
        type="button"
        tabIndex={-1}
        className="ossclip-modal-chip"
        data-testid={closeTestId}
        onClick={onClose}
      >
        {closeLabel}
      </button>
    ) : (
      <button type="button" className="ossclip-modal-close" onClick={onClose} aria-label="Close">
        ✕
      </button>
    );

  const inner = (
    <>
      <div className="ossclip-modal-header">
        <div className="ossclip-modal-title">{title}</div>
        {headerClose}
      </div>
      {subtitle != null ? <div className="ossclip-modal-subtitle">{subtitle}</div> : null}
      {children}
      {footer ? <div className="ossclip-modal-footer">{footer}</div> : null}
    </>
  );

  return (
    <div
      className="ossclip-modal-backdrop"
      onMouseDown={dismissable ? onClose : undefined}
    >
      {asForm ? (
        <form {...panelProps} onSubmit={onSubmit}>
          {inner}
        </form>
      ) : (
        <div {...panelProps}>{inner}</div>
      )}
    </div>
  );
};
