import Anthropic from "@anthropic-ai/sdk";

export type Action =
  | { kind: "add"; item: string }
  | { kind: "done"; item: string }
  | { kind: "remove"; item: string }
  | { kind: "show"; item: string }
  | { kind: "clear_done"; item: string };

const globalForAnthropic = globalThis as unknown as { anthropic?: Anthropic };

function getClient(): Anthropic {
  if (!globalForAnthropic.anthropic) {
    globalForAnthropic.anthropic = new Anthropic();
  }
  return globalForAnthropic.anthropic;
}

// Claude Opus 5 by default. Set CLAUDE_MODEL=claude-haiku-4-5 to trade some
// accuracy for roughly a fifth of the cost — see the README.
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5";

const SYSTEM = `You watch a family's WhatsApp group chat and maintain their shopping list.

Most messages are ordinary conversation and have nothing to do with shopping. For
those, return an empty actions array. Only act when someone is clearly talking
about what to buy or what has been bought.

Actions:
- add: someone wants something on the list. "we need milk" -> add milk.
  Split multiple items into one add each: "milk, eggs and bread" is three adds.
- done: someone bought or has an item already. "got the milk" -> done milk.
- remove: someone wants an item off the list without having bought it.
  "actually forget the bread" -> remove bread.
- show: someone asks what is on the list. "what do we still need?" -> show.
- clear_done: someone wants the bought items cleared off.

Guidelines:
- Write items as short, plain shopping-list entries: "oat milk", not
  "we should probably get some oat milk". Lowercase unless it is a brand name.
- Drop quantities into the item text only if someone said one: "2l milk".
- A question about whether something is on the list is a show, not an add.
- Someone mentioning food they ate or cooked is not a shopping request.
- Jokes, plans, and links are not shopping requests. When in doubt, do nothing.
- For show and clear_done, set item to an empty string.`;

const SCHEMA = {
  type: "object",
  properties: {
    actions: {
      type: "array",
      description: "Empty when the message is not about the shopping list.",
      items: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["add", "done", "remove", "show", "clear_done"],
          },
          item: {
            type: "string",
            description:
              "The shopping list item. Empty string for show and clear_done.",
          },
        },
        required: ["kind", "item"],
        additionalProperties: false,
      },
    },
  },
  required: ["actions"],
  additionalProperties: false,
} as const;

/**
 * Decides what a single group message means for the list. Returns an empty
 * array for the overwhelming majority of messages, which are just chat.
 */
export async function interpret(message: string, sender: string): Promise<Action[]> {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 4096,
    // Adaptive thinking at low effort: enough reasoning to tell chat from a
    // shopping request, without paying for deliberation on "haha same".
    thinking: { type: "adaptive" },
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: SCHEMA },
    },
    system: [
      { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: `${sender} says: ${message}` }],
  });

  if (response.stop_reason === "refusal") return [];

  const text = response.content.find((block) => block.type === "text");
  if (!text || text.type !== "text") return [];

  try {
    const parsed = JSON.parse(text.text) as { actions?: Action[] };
    return Array.isArray(parsed.actions) ? parsed.actions : [];
  } catch {
    return [];
  }
}
