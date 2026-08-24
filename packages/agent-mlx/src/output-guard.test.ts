import { describe, expect, it } from "vitest";
import { repeatedSequenceStart, StreamingOutputGuard } from "./output-guard";

describe("MLX streaming output guard", () => {
  it("finds the beginning of a repeated eight-token sequence", () => {
    const first = "하나 둘 셋 넷 다섯 여섯 일곱 여덟";
    const value = `${first} 중간 문장입니다. ${first} 아홉`;
    expect(repeatedSequenceStart(value)).toBe(value.lastIndexOf(first));
  });

  it("stops before emitting a repeated sequence", () => {
    const guard = new StreamingOutputGuard();
    const first = "하나 둘 셋 넷 다섯 여섯 일곱 여덟";
    const chunks = [
      guard.push(`${first}. `),
      guard.push(`${first}. 계속`),
      guard.flush(),
    ];
    expect(chunks.join("")).toBe(`${first}. `);
    expect(guard.stopped).toBe(true);
  });

  it("removes reasoning blocks even when tags cross chunks", () => {
    const guard = new StreamingOutputGuard();
    const chunks = [
      guard.push("<thi"),
      guard.push("nk>내부 추론</thi"),
      guard.push("nk>최종 답변입니다."),
      guard.flush(),
    ];
    expect(chunks.join("")).toBe("최종 답변입니다.");
  });
});
