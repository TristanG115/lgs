import { describe, expect, it } from 'vitest';
import { lines } from '../src/model/backend.js';

describe('stream handling', () => {
  it('splits chunked newline-delimited responses', async () => {
    const encoder = new TextEncoder();
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode('first\nsec')); controller.enqueue(encoder.encode('ond\n')); controller.close(); } }));
    const result: string[] = [];
    for await (const line of lines(response)) result.push(line);
    expect(result).toEqual(['first', 'second']);
  });
});
