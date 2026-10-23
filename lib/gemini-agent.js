/**
 * Gemini 3.8 Flash Sales Agent for The Augusta Collection.
 *
 * Runs on Google Gemini 3.8 Flash via OpenRouter (or direct Gemini API),
 * with the Global Payments MCP tools registered as function definitions.
 * Emits real-time reasoning traces, tool-call frames, and latency metrics.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL_NAME = process.env.AGENT_MODEL || 'google/gemini-3.8-flash';

export function loadApiKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const candidates = [
    path.join(__dirname, '..', '.env'),
    path.join(process.env.HOME || '', '.hermes', '.env'),
    path.join(process.env.HOME || '', '.hermes', 'profiles', 'coder-prototyper', '.env'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      const match = fs.readFileSync(c, 'utf8').match(/^OPENROUTER_API_KEY=(.+)$/m);
      if (match && match[1]) return match[1].trim();
    }
  }
  return null;
}

const SYSTEM_PROMPT = `You are "The Augusta Concierge", the elite sales advisor for The Augusta Collection — a luxury clubhouse golf boutique.

CORE DIRECTIVE:
Provide expert, refined guidance to golfers selecting the ideal golf ball for their game, then seamlessly create a verified Global Payments payment link using the MCP server.

SHOP PRICING & PRODUCTS:
- 3 for $16.00 is the flagship offer across all three models:
  1. "Tour Velocity" (Distance, low driver spin, 95 compression, for swing speeds > 95mph)
  2. "Royal Classic" (Balanced, forgiving, 80 compression, for all handicaps)
  3. "Pure Soft" (Tour feel, high greenside spin, 65 compression, for soft feel & touch)
- Top-ups: 2-pack ($11.00), Single ($5.50).
- The exact customer order is specified in the ORDER CONTEXT. Use the total in cents from that context!

MCP TOOL EXECUTION:
When the customer confirms their purchase (or clicks "Send Link" / "Proceed to Checkout"), invoke create_payment_link:
- amount: total in cents from ORDER CONTEXT (e.g. "1600" for $16.00)
- currency: "USD"
- country: "US"
- name: name of the order (e.g. "The Augusta Collection - 3 Golf Balls")
- description: item summary and total
- reference: "AUGUSTA-GOLF-3BALLS"
- usage_mode: "SINGLE"
- link_type: "HOSTED_PAYMENT_PAGE"
- message_type: "EMAIL"
- payer_email: customer email from ORDER CONTEXT
- email_subject: "Your Private Checkout Link — The Augusta Collection"
- email_content: "Thank you for shopping with The Augusta Collection. Your single-use payment link is enclosed."

TONE:
Polished, knowledgeable, courteous, concise (1-3 sentences). Always cite the real payment URL and link ID returned by the tool. Never fabricate a payment link.`;

export class GeminiAgent {
  constructor({ apiKey, model = MODEL_NAME, onEvent = () => {} }) {
    this.apiKey = apiKey || loadApiKey();
    this.model = model;
    this.onEvent = onEvent;
    this.history = [];
  }

  formatToolsForOpenAI(mcpTools = []) {
    return mcpTools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.inputSchema || { type: 'object', properties: {} },
      },
    }));
  }

  async chat(userMessage, { mcpClient, mcpTools = [], customerEmail, requireTool = false }) {
    const t0 = Date.now();
    this.history.push({ role: 'user', content: userMessage });

    const openAiTools = this.formatToolsForOpenAI(mcpTools);
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...this.history,
    ];

    this.onEvent({
      kind: 'agent_thinking',
      model: this.model,
      message: 'Gemini 3.8 Flash evaluating customer intent and bag context...',
      at: Date.now(),
    });

    const bodyPayload = {
      model: this.model,
      messages,
      tools: openAiTools.length ? openAiTools : undefined,
      tool_choice: requireTool ? { type: 'function', function: { name: 'create_payment_link' } } : 'auto',
    };

    this.onEvent({
      kind: 'model_request',
      model: this.model,
      toolChoice: bodyPayload.tool_choice,
      at: Date.now(),
    });

    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://antigravity.google.internal',
        'X-Title': 'Antigravity Augusta Golf Shop',
      },
      body: JSON.stringify(bodyPayload),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini 3.8 API error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const durationMs = Date.now() - t0;
    const choice = data.choices?.[0];
    const assistantMsg = choice?.message;

    // Capture Gemini 3.8 Flash's internal reasoning
    const reasoning = assistantMsg?.reasoning || assistantMsg?.reasoning_details;
    if (reasoning) {
      this.onEvent({
        kind: 'gemini_reasoning',
        model: this.model,
        reasoning,
        at: Date.now(),
      });
    }

    this.onEvent({
      kind: 'model_response',
      model: this.model,
      durationMs,
      finishReason: choice?.finish_reason,
      usage: data.usage,
      at: Date.now(),
    });

    // Check for tool calls
    const toolCalls = assistantMsg?.tool_calls || [];
    let link = null;

    if (toolCalls.length > 0) {
      for (const call of toolCalls) {
        const fnName = call.function?.name;
        let fnArgs = {};
        try {
          fnArgs = JSON.parse(call.function?.arguments || '{}');
        } catch {
          fnArgs = {};
        }

        this.onEvent({
          kind: 'tool_call',
          tool: fnName,
          callId: call.id,
          args: fnArgs,
          at: Date.now(),
        });

        // Execute tool call through MCP stdio client
        const toolStart = Date.now();
        let toolResult = null;
        let toolError = null;

        try {
          toolResult = await mcpClient.callTool(fnName, fnArgs);
          this.onEvent({
            kind: 'tool_result',
            tool: fnName,
            callId: call.id,
            durationMs: Date.now() - toolStart,
            result: toolResult,
            at: Date.now(),
          });

          if (fnName === 'create_payment_link') {
            link = this.extractLinkFromToolResult(toolResult, fnArgs);
          }
        } catch (err) {
          toolError = err.message;
          this.onEvent({
            kind: 'tool_result',
            tool: fnName,
            callId: call.id,
            durationMs: Date.now() - toolStart,
            error: err.message,
            at: Date.now(),
          });
        }

        // Add assistant turn with tool call to history
        this.history.push({
          role: 'assistant',
          content: assistantMsg.content || null,
          tool_calls: [call],
        });

        // Add tool response to history
        this.history.push({
          role: 'tool',
          tool_call_id: call.id,
          content: toolError ? JSON.stringify({ error: toolError }) : JSON.stringify(toolResult),
        });

        // Final turn: ask Gemini 3.8 Flash to present the result to customer
        const followUpPayload = {
          model: this.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...this.history,
          ],
        };

        const followUpRes = await fetch(OPENROUTER_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(followUpPayload),
        });

        if (followUpRes.ok) {
          const followUpData = await followUpRes.json();
          const finalReply = followUpData.choices?.[0]?.message?.content || '';
          this.history.push({ role: 'assistant', content: finalReply });
          return {
            reply: finalReply,
            link,
            toolCalls,
            latencyMs: Date.now() - t0,
          };
        }
      }
    }

    const reply = assistantMsg?.content || 'I am ready to assist with your selection.';
    this.history.push({ role: 'assistant', content: reply });
    return {
      reply,
      link,
      toolCalls,
      latencyMs: durationMs,
    };
  }

  extractLinkFromToolResult(toolResult, args) {
    if (!toolResult) return null;
    let text = '';
    if (Array.isArray(toolResult.content)) {
      text = toolResult.content.map((c) => c.text || '').join('\n');
    } else if (typeof toolResult === 'string') {
      text = toolResult;
    } else {
      text = JSON.stringify(toolResult);
    }

    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* parse line by line or regex */
    }

    const id = parsed?.id || text.match(/LNK_[A-Za-z0-9]+/)?.[0] || 'LNK_PROVISIONAL';
    const url =
      parsed?.url ||
      parsed?.payment_link_url ||
      text.match(/https:\/\/[^\s"']+(?:redirect|payment|hpp)[^\s"']*/)?.[0] ||
      text.match(/https:\/\/[^\s"']+/)?.[0] ||
      '#';

    return {
      id,
      url,
      status: parsed?.status || 'ACTIVE',
      amount: parsed?.amount || args.amount || '1600',
      currency: args.currency || 'USD',
      reference: args.reference || 'AUGUSTA-GOLF-3BALLS',
      customerEmail: args.payer_email || null,
      createdAt: new Date().toISOString(),
    };
  }
}
