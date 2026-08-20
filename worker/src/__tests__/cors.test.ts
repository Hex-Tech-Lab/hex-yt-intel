import { describe, it, expect } from "vitest";
import { resolveCorsOrigin, isValidAppUrl } from "../middleware/cors";

describe("resolveCorsOrigin", () => {
  it("accepts exact production and legacy origins", () => {
    expect(resolveCorsOrigin("https://getvintel.com")).toBe("https://getvintel.com");
    expect(resolveCorsOrigin("https://www.getvintel.com")).toBe("https://www.getvintel.com");
    expect(resolveCorsOrigin("https://yt-intel.getmytestdrive.com")).toBe("https://yt-intel.getmytestdrive.com");
    expect(resolveCorsOrigin("https://v-intel.getmytestdrive.com")).toBe("https://v-intel.getmytestdrive.com");
    expect(resolveCorsOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("accepts this app's own vercel preview deployments", () => {
    expect(resolveCorsOrigin("https://hex-yt-intel-abc123.vercel.app")).toBe("https://hex-yt-intel-abc123.vercel.app");
  });

  it("rejects a spoofed subdomain suffix", () => {
    expect(resolveCorsOrigin("https://getvintel.com.evil.com")).toBeNull();
  });

  it("rejects an arbitrary vercel.app app", () => {
    expect(resolveCorsOrigin("https://evil-app.vercel.app")).toBeNull();
    expect(resolveCorsOrigin("https://hex-yt-intel.evil.vercel.app")).toBeNull();
  });

  it("rejects http for a domain that should be https", () => {
    expect(resolveCorsOrigin("http://getvintel.com")).toBeNull();
  });

  it("rejects an alternate port on an allowed host", () => {
    expect(resolveCorsOrigin("https://getvintel.com:8443")).toBeNull();
  });

  it("returns null for no origin", () => {
    expect(resolveCorsOrigin(undefined)).toBeNull();
  });
});

describe("isValidAppUrl", () => {
  it("allows an empty/undefined url (no callback requested)", () => {
    expect(isValidAppUrl(undefined, undefined, undefined, true)).toBe(true);
  });

  it("allows production and legacy hostnames in prod", () => {
    expect(isValidAppUrl("https://getvintel.com/api/x", undefined, undefined, true)).toBe(true);
    expect(isValidAppUrl("https://www.getvintel.com/api/x", undefined, undefined, true)).toBe(true);
    expect(isValidAppUrl("https://yt-intel.getmytestdrive.com/api/x", undefined, undefined, true)).toBe(true);
  });

  it("rejects an arbitrary vercel.app deployment as a callback target in prod", () => {
    expect(isValidAppUrl("https://evil-app.vercel.app/api/x", undefined, undefined, true)).toBe(false);
  });

  it("allows only this app's own vercel preview, even in prod", () => {
    expect(isValidAppUrl("https://hex-yt-intel-abc123.vercel.app/api/x", undefined, undefined, true)).toBe(true);
    expect(isValidAppUrl("https://hex-yt-intel.vercel.app/api/x", undefined, undefined, true)).toBe(true);
  });

  it("rejects localhost in prod but allows it outside prod", () => {
    expect(isValidAppUrl("http://localhost:3000/api/x", undefined, undefined, true)).toBe(false);
    expect(isValidAppUrl("http://localhost:3000/api/x", undefined, undefined, false)).toBe(true);
  });

  it("allows an explicit env/allowlist match regardless of prod", () => {
    expect(isValidAppUrl("https://custom.example.com/api/x", "https://custom.example.com", undefined, true)).toBe(true);
    expect(isValidAppUrl("https://custom.example.com/api/x", undefined, "https://custom.example.com", true)).toBe(true);
  });

  it("rejects an untrusted arbitrary domain", () => {
    expect(isValidAppUrl("https://attacker.example.com/api/x", undefined, undefined, true)).toBe(false);
  });

  it("returns false for a malformed URL", () => {
    expect(isValidAppUrl("not-a-url", undefined, undefined, true)).toBe(false);
  });
});
