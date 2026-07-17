import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFileSafe, readFileSafe, fileExists } from "../fs.js";

describe("writeFileSafe", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kit-fs-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates file in existing directory", () => {
    const path = join(dir, "test.txt");
    writeFileSafe(path, "hello");
    expect(readFileSync(path, "utf-8")).toBe("hello");
  });

  it("creates parent directories recursively", () => {
    const path = join(dir, "a", "b", "c", "test.txt");
    writeFileSafe(path, "deep");
    expect(readFileSync(path, "utf-8")).toBe("deep");
  });

  it("overwrites existing file", () => {
    const path = join(dir, "test.txt");
    writeFileSafe(path, "first");
    writeFileSafe(path, "second");
    expect(readFileSync(path, "utf-8")).toBe("second");
  });
});

describe("readFileSafe", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kit-fs-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads existing file", () => {
    const path = join(dir, "test.txt");
    writeFileSync(path, "content");
    expect(readFileSafe(path)).toBe("content");
  });

  it("returns null for non-existent file", () => {
    expect(readFileSafe(join(dir, "nope.txt"))).toBeNull();
  });
});

describe("fileExists", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kit-fs-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns true for existing file", () => {
    const path = join(dir, "test.txt");
    writeFileSync(path, "");
    expect(fileExists(path)).toBe(true);
  });

  it("returns false for non-existent file", () => {
    expect(fileExists(join(dir, "nope.txt"))).toBe(false);
  });
});
