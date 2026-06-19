import { Hono } from "hono";
import { handleChatStream } from "../chat-stream";

const chat = new Hono();

chat.post("/chat-stream", handleChatStream);

export default chat;
