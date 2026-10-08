import { describe, it, expect } from "vitest";
import pkg from "../package.json";
import { formatVersion } from "../src/version";

describe("版本号", () => {
  it("展示串由 semver 生成：补丁位为 0 时省略", () => {
    expect(formatVersion("1.0.0")).toBe("V1.0");
    expect(formatVersion("1.0.1")).toBe("V1.0.1");
    expect(formatVersion("1.2.0")).toBe("V1.2");
    expect(formatVersion("2.11.3")).toBe("V2.11.3");
  });

  it("package.json 是唯一来源：当前发布版本为 V1.0", () => {
    // 发版时改 package.json + CHANGELOG.md，这行断言会跟着提醒。
    expect(pkg.version).toBe("1.0.0");
    expect(formatVersion(pkg.version)).toBe("V1.0");
  });
});
