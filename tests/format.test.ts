import { describe, expect, it } from "vitest";
import { formatTags } from "../src/server/publisher/format";
import { parseTags } from "../src/server/validation";

describe("metadata formatting", () => {
  it("normalizes tags", () => {
    expect(parseTags("城市生活, #探店  美食，探店")).toEqual(["城市生活", "探店", "美食"]);
    expect(formatTags(["城市生活", "探店"])).toBe("#城市生活 #探店");
  });

});
