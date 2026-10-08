/**
 * 版本号规则：`package.json` 的 version 是唯一来源，展示串由这里生成。
 * 1.0.0 → "V1.0"；补丁位非 0 才带出来（1.0.1 → "V1.0.1"、1.2.0 → "V1.2"）。
 * 发版时改 package.json + CHANGELOG.md（tests/version.test.ts 会校验）。
 */
export const formatVersion = (semver: string) => {
  const [major = "0", minor = "0", patch = "0"] = String(semver).trim().split(".");
  return `V${major}.${minor}${Number(patch) > 0 ? "." + patch : ""}`;
};
