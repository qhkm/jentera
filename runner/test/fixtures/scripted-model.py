"""Scripted OpenAI-compatible model for the hand-off end-to-end test.
COORDINATOR_TASK -> call ask_specialist(records); a tool result -> COMBINED answer;
SPECIALIST_TASK -> an answer. Streams, like Hermes asks for."""
import json, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def text(content):
    if isinstance(content, list):
        return " ".join(p.get("text", "") for p in content if isinstance(p, dict))
    return content if isinstance(content, str) else ""


def decide(body):
    messages = body.get("messages", [])
    tools = [m for m in messages if m.get("role") == "tool"]
    users = [text(m.get("content")) for m in messages if m.get("role") == "user"]
    last = users[-1] if users else ""
    if tools:
        return {"content": "COMBINED: " + text(tools[-1].get("content"))[:400]}
    if "COORDINATOR_TASK" in last:
        args = json.dumps({"specialist": "records", "brief": "SPECIALIST_TASK: count unpaid invoices"})
        return {"call": {"id": "call_1", "name": "ask_specialist", "arguments": args}}
    if "SPECIALIST_TASK" in last:
        return {"content": "SPECIALIST_RESULT: 3 unpaid invoices"}
    return {"content": "ok"}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass

    def do_GET(self):
        data = json.dumps({"object": "list", "data": [{"id": "mock/model"}]}).encode()
        self.send_response(200); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        if not self.path.endswith("/chat/completions"):
            self.send_response(404); self.end_headers(); return
        reply = decide(body)
        self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.end_headers()
        if "call" in reply:
            c = reply["call"]
            first = {"role": "assistant", "tool_calls": [{"index": 0, "id": c["id"], "type": "function",
                                                          "function": {"name": c["name"], "arguments": c["arguments"]}}]}
            finish = "tool_calls"
        else:
            first, finish = {"role": "assistant", "content": reply["content"]}, "stop"
        for delta, reason in ((first, None), ({}, finish)):
            chunk = {"id": "m", "object": "chat.completion.chunk", "created": int(time.time()), "model": "mock/model",
                     "choices": [{"index": 0, "delta": delta, "finish_reason": reason}]}
            self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
        self.wfile.write(b"data: [DONE]\n\n"); self.wfile.flush()


ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
