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
    expect(parseClientMessage({ type: 'setOptions', options: { mode: 'planning', thinking: 'medium', approval: 'on-request' } })).toEqual({ type: 'setOptions', options: { mode: 'planning', thinking: 'medium', approval: 'on-request' } });
    expect(parseClientMessage({ type: 'setOptions', options: { thinking: 'medium', approval: 'on-request' } })).toBeUndefined();
  });
  it("rejects malformed, empty, and oversized messages", () => {
    expect(parseClientMessage(null)).toBeUndefined(); expect(parseClientMessage({ type: "wrong", text: "hi" })).toBeUndefined(); expect(parseClientMessage({ type: "userMessage", text: " " })).toBeUndefined(); expect(parseClientMessage({ type: "userMessage", text: "x".repeat(4001) })).toBeUndefined();
  });
  it("recognizes only host messages", () => { expect(isHostMessage({ type: 'textDelta', text: 'ok' })).toBe(true); expect(isHostMessage({ type: "error", message: "bad" })).toBe(true); expect(isHostMessage({ type: 'unknown' })).toBe(false); });
});
