import { createHash, timingSafeEqual } from "node:crypto";

const tokenPattern = /^[A-Za-z0-9_-]{43,128}$/;

export function schedulerAuthorized(expected, presented) {
  if (
    typeof expected !== "string" ||
    typeof presented !== "string" ||
    !tokenPattern.test(expected) ||
    !tokenPattern.test(presented)
  ) {
    return false;
  }
  const digest = (token) => createHash("sha256").update(token, "utf8").digest();
  return timingSafeEqual(digest(expected), digest(presented));
}
