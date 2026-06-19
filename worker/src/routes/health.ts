import { Hono } from "hono";

const health = new Hono();

health.get("/", (c) => {
  return c.json({
    status: "ok",
    message: "YouTube Intelligence Worker API",
    endpoint: "/fetch-metadata?video_id=VIDEO_ID",
  });
});

export default health;
