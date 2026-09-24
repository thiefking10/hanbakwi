import { describe, expect, it } from "vitest";
import { BOARD } from "./board";
import { eulReul, euroRo, hasBatchim } from "./josa";

describe("조사", () => {
  it("받침에 따라 을/를", () => {
    expect(eulReul("속초")).toBe("속초를");
    expect(eulReul("서울")).toBe("서울을");
    expect(eulReul("강릉")).toBe("강릉을");
    expect(eulReul("대구")).toBe("대구를");
  });

  it("받침에 따라 로/으로 (ㄹ 받침은 로)", () => {
    expect(euroRo("서울")).toBe("서울로");
    expect(euroRo("강릉")).toBe("강릉으로");
    expect(euroRo("제주")).toBe("제주로");
    expect(euroRo("부산항")).toBe("부산항으로");
  });

  it("한글이 아니거나 빈 글자는 받침이 없는 것으로 본다", () => {
    expect(hasBatchim("A")).toBe(false);
    expect(hasBatchim("")).toBe(false);
  });

  it("판의 모든 칸 이름에 붙여도 이상하지 않다", () => {
    for (const tile of BOARD) {
      expect(eulReul(tile.name)).toMatch(/[을를]$/);
      expect(euroRo(tile.name)).toMatch(/(으로|로)$/);
    }
  });
});
