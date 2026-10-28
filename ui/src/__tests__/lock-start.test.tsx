import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Shell } from "../components/Shell";

afterEach(() => { act(() => fakeBridge.setLocked(false)); cleanup(); });

describe("Peeka lock keeps Start and Search shut", () => {
  it("clicking Start or Search while locked opens nothing; locking closes an open Start", async () => {
    render(<Shell monitor="m1" />);
    const start = await screen.findByRole("button", { name: "Start" });
    fireEvent.click(start);
    expect(start.getAttribute("aria-expanded")).toBe("true");
    act(() => fakeBridge.setLocked(true));
    expect(start.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(start);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(start.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: "Search" }).getAttribute("aria-expanded")).toBe("false");
  });
});
