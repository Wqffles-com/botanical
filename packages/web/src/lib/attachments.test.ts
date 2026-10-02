import { describe, expect, test } from "bun:test";
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_COUNT } from "@botanical/core";
import { acceptFiles, formatBytes, type PendingFile } from "./attachments";

const pending = (n: number): PendingFile[] =>
  Array.from({ length: n }, (_, i) => ({ id: String(i), file: new File(["x"], "a.txt"), name: "a.txt", previewUrl: null }));

describe("acceptFiles", () => {
  test("takes small files", () => {
    const { accepted, errors } = acceptFiles([], [new File(["hi"], "a.txt")]);
    expect(accepted).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test("rejects empty and oversized files", () => {
    const big = new File([new Uint8Array(ATTACHMENT_MAX_BYTES + 1)], "big.bin");
    const { accepted, errors } = acceptFiles([], [new File([], "none.txt"), big]);
    expect(accepted).toEqual([]);
    expect(errors).toHaveLength(2);
  });

  test("stops at the per-message cap", () => {
    const { accepted, errors } = acceptFiles(pending(ATTACHMENT_MAX_COUNT - 1), [
      new File(["a"], "a"),
      new File(["b"], "b"),
    ]);
    expect(accepted).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });
});

test("formatBytes", () => {
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(1500)).toBe("1.5 KB");
  expect(formatBytes(2_500_000)).toBe("2.5 MB");
});
