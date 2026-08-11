import Anthropic from "@anthropic-ai/sdk";

export type Action =
  | { kind: "add"; item: string }
  | { kind: "done"; item: string }
  | { kind: "undone"; item: string }
  | { kind: "remove"; item: string }
  | { kind: "show"; item: string }
  | { kind: "clear_done"; item: string }
  | { kind: "clear_all"; item: string };

const globalForAnthropic = globalThis as unknown as { anthropic?: Anthropic };

function getClient(): Anthropic {
  if (!globalForAnthropic.anthropic) {
    globalForAnthropic.anthropic = new Anthropic();
  }
  return globalForAnthropic.anthropic;
}

// Haiku 4.5 by default: this is a short classification on every group message,
// which is what it's built for. Set CLAUDE_MODEL=claude-opus-5 for better
// judgement on messages that only sound like shopping — see the README.
const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5";

// Adaptive thinking and the effort parameter are rejected by Haiku 4.5, so
// they're only sent to models that accept them.
const ADAPTIVE_THINKING_MODELS = new Set([
  "claude-fable-5",
  "claude-mythos-5",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
]);
const useAdaptiveThinking = ADAPTIVE_THINKING_MODELS.has(MODEL);

const SYSTEM = `You watch a family's WhatsApp group chat and maintain their shopping list.

Most messages are ordinary conversation and have nothing to do with shopping. For
those, return an empty actions array. Only act when someone is clearly talking
about what to buy or what has been bought.

Actions:
- add: someone wants something on the list. "we need milk" -> add milk.
  Split multiple items into one add each: "milk, eggs and bread" is three adds.
- done: someone bought or has an item already. "got the milk" -> done milk.
- undone: someone takes that back — they had not actually got it after all.
  "sorry, didn't get the milk" -> undone milk.
- remove: someone wants an item off the list without having bought it.
  "actually forget the bread" -> remove bread.
- show: someone asks what is on the list. "what do we still need?" -> show.
- clear_done: someone wants the bought items cleared off.
- clear_all: someone wants the whole list emptied, bought or not. Only for an
  unmistakable request like "clear the whole list" or "start the list over" —
  when in doubt prefer clear_done, which is not destructive.

Guidelines:
- Write items as short, plain shopping-list entries: "oat milk", not
  "we should probably get some oat milk". Lowercase unless it is a brand name.
- Drop quantities into the item text only if someone said one: "2l milk",
  "6x eggs".
- To change an item, remove the old one and add the new: "make the milk 2
  litres" -> remove milk, add "2l milk".
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
            enum: [
              "add",
              "done",
              "undone",
              "remove",
              "show",
              "clear_done",
              "clear_all",
            ],
          },
          item: {
            type: "string",
            description:
              "The shopping list item. Empty string for show, clear_done and clear_all.",
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

const FORMAT = { type: "json_schema" as const, schema: SCHEMA };

/**
 * Decides what a single group message means for the list. Returns an empty
 * array for the overwhelming majority of messages, which are just chat.
 */
export async function interpret(message: string, sender: string): Promise<Action[]> {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2048,
    // On a thinking model, keep it shallow — this is triage, not deliberation.
    ...(useAdaptiveThinking
      ? { thinking: { type: "adaptive" as const }, output_config: { effort: "low" as const, format: FORMAT } }
      : { output_config: { format: FORMAT } }),
    system: [
      // Only takes effect on models whose minimum cacheable prefix is small
      // enough (512 tokens on Opus 5). On Haiku 4.5 it is a silent no-op.
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
