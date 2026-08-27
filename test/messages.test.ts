import { describe, expect, it } from "vitest";
import { isHostMessage, parseClientMessage } from "../src/shared/messages.js";

describe("message contracts", () => {
  it("parses and trims valid client messages", () => expect(parseClientMessage({ type: "userMessage", text: "  hello  " })).toEqual({ type: "userMessage", text: "hello" }));
  it("accepts bounded task-dashboard controls", () => {
    expect(parseClientMessage({ type: "ready" })).toEqual({ type: "ready" });
    expect(parseClientMessage({ type: "taskAction", action: "viewTaskState" })).toEqual({ type: "taskAction", action: "viewTaskState" });
    expect(parseClientMessage({ type: "taskAction", action: "approve" })).toBeUndefined();
    expect(parseClientMessage({ type: "openUsage" })).toEqual({ type: "openUsage" });
  });
  it("requires an explicit execution mode with run options", () => {
    const options = { mode: 'plan', thinking: 'medium', autoResearch: 'when-uncertain', capabilities: { web: true, code: true, terminal: false, browser: true, computer: false, integrations: true }, approval: 'on-request' };
    expect(parseClientMessage({ type: 'setOptions', options })).toEqual({ type: 'setOptions', options });
    expect(parseClientMessage({ type: 'setOptions', options: { thinking: 'medium', approval: 'on-request' } })).toBeUndefined();
  });
  it('validates bounded multi-file attachment payloads', () => {
    expect(parseClientMessage({ type: 'userMessage', text: 'inspect', attachments: [{ id: 'a', name: 'a.txt', mediaType: 'text/plain', bytes: 1, dataBase64: 'eA==', source: 'drop' }] })).toMatchObject({ type: 'userMessage', attachments: [{ name: 'a.txt' }] });
    expect(parseClientMessage({ type: 'userMessage', text: 'inspect', attachments: [{ id: 'a', name: 'a.txt', mediaType: 'text/plain', bytes: 0, dataBase64: '', source: 'drop' }] })).toBeUndefined();
  });
  it("rejects malformed, empty, and oversized messages", () => {
    expect(parseClientMessage(null)).toBeUndefined(); expect(parseClientMessage({ type: "wrong", text: "hi" })).toBeUndefined(); expect(parseClientMessage({ type: "userMessage", text: " " })).toBeUndefined(); expect(parseClientMessage({ type: "userMessage", text: "x".repeat(4001) })).toBeUndefined();
  });
  it("recognizes only host messages", () => { expect(isHostMessage({ type: 'textDelta', text: 'ok' })).toBe(true); expect(isHostMessage({ type: "error", message: "bad" })).toBe(true); expect(isHostMessage({ type: 'unknown' })).toBe(false); });
});
