import { fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { useFocusTrap } from "../lib/useFocusTrap";

function Card({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, onClose);
  return (
    <div ref={ref} role="dialog">
      <button>bir</button><input aria-label="iki" /><button>üç</button>
    </div>
  );
}
function Host({ onClose }: { onClose: () => void }) {
  return <><button>açan</button><Card onClose={onClose} /></>;
}

describe("odak tuzağı", () => {
  it("açılınca ilk denetime odak verir", () => {
    const { getByText } = render(<Host onClose={() => undefined} />);
    expect(document.activeElement).toBe(getByText("bir"));
  });
  it("Tab kartın içinde döner (sondan başa), Shift+Tab baştan sona", () => {
    const { getByText, getByRole } = render(<Host onClose={() => undefined} />);
    const dlg = getByRole("dialog");
    getByText("üç").focus();
    fireEvent.keyDown(dlg, { key: "Tab" });
    expect(document.activeElement).toBe(getByText("bir"));
    fireEvent.keyDown(dlg, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(getByText("üç"));
  });
  it("Esc kapatır; kart sökülünce odak açan öğeye döner", () => {
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
