// Start pinned folders: the grid model (create, join, rename, move out, dissolve, reorder) and the open folder card.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppRef, StartItem } from "../bridge";
import { StartGrid } from "../components/StartGrid";
import { derive, dropOnto, keyOf, moveTo, rename, withoutApp } from "../lib/startItems";

afterEach(cleanup);
const F = (name: string, ...appIds: string[]): StartItem => ({ kind: "folder", name, appIds });
const A = (appId: string): StartItem => ({ kind: "app", appId });

describe("Start grid model", () => {
  it("an app dropped on an app makes a folder \"Folder\" in the target's place; on a folder it joins", () => {
    const g = derive(["a", "b", "c", "d"]);
    const one = dropOnto(g, "b", "app:a");
    expect(one).toEqual([F("Folder", "a", "b"), A("c"), A("d")]);
    expect(dropOnto(one, "d", "folder:a")).toEqual([F("Folder", "a", "b", "d"), A("c")]);
    expect(dropOnto(g, "a", "app:a")).toBe(g);
  });

  it("rename keeps the place; a blank name is \"Folder\"", () => {
    const g = [A("x"), F("Folder", "a", "b")];
    expect(rename(g, "folder:a", "  Work ")).toEqual([A("x"), F("Work", "a", "b")]);
    expect(rename(g, "folder:a", "   ")).toEqual(g);
  });

  it("an app moved out of a folder lands where dropped; a folder left with one app becomes that app", () => {
    const g = [F("Work", "a", "b", "c"), A("x"), A("y")];
    expect(moveTo(g, "app:b", "app:y", true)).toEqual([F("Work", "a", "c"), A("x"), A("y"), A("b")]);
    const two = [F("Work", "a", "b"), A("x")];
    expect(moveTo(two, "app:a", "app:x", false)).toEqual([A("b"), A("a"), A("x")]); // dissolved in place
    expect(withoutApp([F("W", "a")], "a")).toEqual([]);
  });

  it("cells keep their order; a folder moves as one cell", () => {
    const g = [A("a"), F("Work", "b", "c"), A("d")];
    expect(moveTo(g, "folder:b", "app:d", true).map(keyOf)).toEqual(["app:a", "app:d", "folder:b"]);
    expect(moveTo(g, "app:a", "app:d", false).map(keyOf)).toEqual(["folder:b", "app:a", "app:d"]);
  });

  it("dropping an app on its own two-app folder dissolves it and keeps the app", () => {
    expect(dropOnto([F("W", "a", "b")], "b", "folder:a")).toEqual([A("a"), A("b")]);
  });
});

describe("Start folder card", () => {
  const apps = new Map<string, AppRef>(["a", "b", "c", "x"].map((id) => [id, { appId: id, name: id.toUpperCase(), icon: "data:image/png;base64,AA==" } as AppRef]));

  it("Enter opens the folder in place, focus stays inside, rename saves, Esc closes back to the tile", () => {
    const onChange = vi.fn();
    render(<StartGrid items={[A("x"), F("Folder", "a", "b")]} apps={apps} onChange={onChange} onLaunch={() => undefined} />);
    const tile = screen.getByRole("button", { name: "Folder, folder, 2 apps" });
    tile.focus();
    fireEvent.click(tile); // Enter on a button = click
    const card = screen.getByRole("dialog", { name: "Folder folder" });
    expect(card.contains(document.activeElement)).toBe(true);
    expect(card.querySelectorAll(".appCell")).toHaveLength(2);
    // Tab from the last cell wraps to the name field: focus stays in the card
    (card.querySelectorAll<HTMLElement>(".appCell")[1]).focus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByLabelText("Folder name"));
    fireEvent.change(screen.getByLabelText("Folder name"), { target: { value: "Work" } });
    fireEvent.keyDown(screen.getByLabelText("Folder name"), { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith([A("x"), F("Work", "a", "b")]);
    act(() => { fireEvent.keyDown(document.activeElement!, { key: "Escape" }); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(tile);
  });

  it("a click on an app launches it; an uninstalled app's cell is left out", () => {
    const onLaunch = vi.fn();
    render(<StartGrid items={[A("x"), A("gone")]} apps={apps} onChange={() => undefined} onLaunch={onLaunch} />);
    fireEvent.click(screen.getByRole("button", { name: /X/ }));
    expect(onLaunch).toHaveBeenCalledWith("x");
    expect(document.querySelectorAll(".appCell")).toHaveLength(1);
  });
});
