import { fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { useFocusTrap } from "../lib/useFocusTrap";

function Card({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, onClose);
  return (
    <div ref={ref} role="dialog">
      <button>one</button><input aria-label="two" /><button>three</button>
    </div>
  );
}
function Host({ onClose }: { onClose: () => void }) {
  return <><button>opener</button><Card onClose={onClose} /></>;
}

describe("focus trap", () => {
  it("focuses the first control on open", () => {
    const { getByText } = render(<Host onClose={() => undefined} />);
    expect(document.activeElement).toBe(getByText("one"));
  });
  it("Tab wraps inside the card (last to first), Shift+Tab first to last", () => {
    const { getByText, getByRole } = render(<Host onClose={() => undefined} />);
    const dlg = getByRole("dialog");
    getByText("three").focus();
    fireEvent.keyDown(dlg, { key: "Tab" });
    expect(document.activeElement).toBe(getByText("one"));
    fireEvent.keyDown(dlg, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(getByText("three"));
  });
  it("Esc closes; when the card unmounts focus returns to the opener", () => {
    const onClose = vi.fn();
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const { getByRole, unmount } = render(<Card onClose={onClose} />);
    fireEvent.keyDown(getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    unmount();
    expect(document.activeElement).toBe(opener);
  });
});
