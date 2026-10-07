import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { errorHandler } from "../../middleware/error-handler";

vi.mock("@sentry/cloudflare", () => ({
  captureException: vi.fn(() => "evt-123"),
}));

describe("errorHandler (fatal exception CORS hardening)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function buildApp(): Hono {
    const app = new Hono();
    app.onError(errorHandler);
    app.post("/boom", () => {
      throw new Error("synthesis crash");
    });
    return app;
  }

  it("sets Access-Control-Allow-Origin for a trusted origin so fatal 500s stay readable (2026-10-06 UAT incident)", async () => {
    const res = await buildApp().request("/boom", {
      method: "POST",
      headers: { Origin: "https://uat.getvintel.com" },
    });
    expect(res.status).toBe(500);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://uat.getvintel.com");
    const body = (await res.json()) as { error: string; errorId: string };
    expect(body.error).toBe("Internal server error");
    expect(body.errorId).toBe("evt-123");
  });

  it("stays headerless for an unknown origin (fail closed)", async () => {
    const res = await buildApp().request("/boom", {
      method: "POST",
      headers: { Origin: "https://evil.example.com" },
    });
    expect(res.status).toBe(500);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
