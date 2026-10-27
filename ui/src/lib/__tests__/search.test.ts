import { describe, expect, it } from "vitest";
import { parseSearchAnswer } from "../search";

describe("search calculator", () => {
  it.each([["12*7", "84"], ["(3+4)/2", "3.5"], ["2^10", "1024"], ["15% of 80", "12"]])("calculates %s", (input, text) => expect(parseSearchAnswer(input)?.text).toBe(text));
  it("does offline conversions", () => {
    expect(parseSearchAnswer("64 gb in mb")?.text).toBe("64000 mb");
    expect(parseSearchAnswer("5 km to mi")?.text).toBe("3.10685596 mi");
    expect(parseSearchAnswer("100 f to c")?.text).toBe("37.77777778 c");
    expect(parseSearchAnswer("2 h in min")?.text).toBe("120 min");
  });
  it("rejects code and incomplete expressions", () => {
    expect(parseSearchAnswer("window.alert(1)")).toBeNull();
    expect(parseSearchAnswer("2/")).toBeNull();
  });
});
