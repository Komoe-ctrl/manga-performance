// Stand-in for Cloudflare's siteverify endpoint, so the e2e run does not depend on the Internet.
import { createServer } from "node:http";

createServer((request, response) => {
  request.resume();
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify({ success: true }));
}).listen(3101, "127.0.0.1", () => console.log("turnstile stub on 3101"));
