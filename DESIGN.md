# Per My Last ReQuest: design proposals

These are proposals from the brainstorming session. README.md describes the current demo. The selected title is **Per My Last ReQuest** (`per-my-last-request`).


### Earlier naming candidates

Earlier suggestions included:

- **Dear Hero, Please** — frames each prompt as a letter to an unreliable adventurer.
- **Quest, As Instructed** — emphasizes literal obedience and its consequences.
- **Please Advise, Adventurer** — suits the guild-and-contract premise.

These alternatives were not selected. Name availability has not been established.

### Core concept

A strategy game about writing standing orders. The player gives a hero a prompt, watches an expedition, and revises the instructions based on what happened.

The intended moment of discovery:

> They did exactly what I asked. I now understand why that was a terrible instruction.

Borrow the expedition structure of [Loop Hero](https://playdigious.com/games/loop-hero): a looping path, recurring encounters, equipment, and a camp. The player's main control is the hero's decision policy.

Use an adventurers' guild trial circuit as a working setting. Training monsters, rival applicants, shops, checkpoints, and badly worded contracts provide the challenges. The central objective is completing assignments through better instructions.

### Basic play cycle

1. Inspect a small map and its objective.
2. Write instructions for the hero.
3. Start the expedition. The hero walks automatically and makes decisions at encounters.
4. Observe actions and brief explanations.
5. At camp, or after defeat, edit the prompt and try again.

Example first prompt:

> Fight enemies, collect treasure, and heal when injured.

Possible outcome: the hero drinks a potion after losing two health, fills the inventory with rubbish, and enters the boss fight unprepared.

Example revision:

> Our priority is to defeat the arena champion and return alive. Keep one inventory slot free for a required quest item. Use potions below 40% health. Avoid optional battles after completing the guild assignment. Save heavy attacks for armored enemies.

The revision should produce visible changes in behavior.

### Level challenges

Each level should have a clear objective, understandable rules, and several viable strategies. Introduce different decision problems, then combine familiar mechanics in later levels.

| Level | Challenge | What the player learns to express |
| --- | --- | --- |
| **The First Expedition** | Collect three slime trophies and return alive. Optional enemies tempt the hero to keep fighting. | When to engage, when to stop, and when to retreat. |
| **Two Potions, Three Problems** | Complete two laps and defeat a boss with only two healing potions. | Resource reserves and conditional healing. "Heal when hurt" wastes supplies. |
| **A Backpack Full of Regret** | Collect three ingredients from a guild shopping list with four inventory slots. Optional loot and useful consumables compete for space. | Priorities, reserved space, and what to discard. |
| **The Expensive Shortcut** | Reach a gate before sunset while keeping enough gold to pay its toll. Shops offer tempting upgrades. | Balancing time, spending, and mandatory expenses. |
| **Armor and Agility** | Armored enemies resist quick strikes; agile enemies counter slow windups. Heavy attacks consume limited stamina. | Choosing actions from enemy properties instead of following one universal tactic. |
| **The Unmarked Fork** | Choose between routes with different dangers. Scouting reveals details but costs time. | When obtaining information is worth its cost. |
| **The Other Applicant** | Earn three contract stamps before a rival finishes the circuit. The rival's position and next destination are visible, and some rewards can only be claimed once. | Adapting priorities to a competitor and deciding which opportunities to concede. |
| **The Fine Print** | Complete a guild assignment without stealing supplies or damaging property. Faster, more profitable actions can violate the contract. | Distinguishing mandatory constraints from preferences and rejecting tempting shortcuts. |

Example combined challenge: finish the shopping-list assignment before a rival while respecting a spending limit and a ban on taking unattended supplies.

### Make the repeating loop matter

A repeating path lets instructions have consequences beyond the next encounter. Proposed mechanics:

- Enemies grow stronger each lap.
- Shops restock, but prices rise.
- A field medic offers one treatment per expedition.
- Defeated enemies leave resources that can be collected next lap.
- A boss appears after the third circuit.

The player can express a multi-lap plan:

> Spend the first lap gathering equipment. On the second lap, complete the guild contract and buy supplies within our budget. Challenge the arena champion on the third lap with one potion remaining.

The challenge becomes teaching the hero how to prepare, commit, and finish.

### Campaign progression

Progression should unlock new decisions:

- **Abilities:** guarding, scouting, cleansing poison, stunning, and escaping. Each adds a useful action that instructions can account for.
- **Equipment with tradeoffs:** heavy armor improves survival but slows travel; a larger backpack carries more but reduces dodge chance. Different objectives call for different policies.
- **Circuits:** introduce one mechanic, then combine it with earlier ones. A training yard adds fatigue, tournament grounds add enemy formations, and a market district adds competing contracts.

Keep permanent stat upgrades modest so better instructions remain an important source of success.

Optional medals can encourage replay:

- Finish faster.
- Preserve supplies.
- Collect extra treasure.
- Succeed across three map variations.

A working prompt becomes something to refine and share.

### Feedback and retries

The player needs a readable account of what happened. For example:

> **Room 7:** Used the last potion at 62% health.
>
> **Hero's stated reason:** "You instructed me to heal before combat."
>
> **Room 10:** Challenged the arena champion with no healing supplies.

Let players select the event, edit their prompt, and retry the same map and combat rolls. Preserve earlier prompt versions so outcomes can be compared.

A short explanation helps, but the actual action and its consequences are the evidence. The player should be able to see whether a change improved behavior.

### LLM and game-engine responsibilities

At each meaningful decision, provide the model with:

- The player's instructions.
- Current health, inventory, resources, and objective progress.
- Visible encounter facts.
- A list of currently legal actions.

The model chooses an action from that list. Game code resolves damage, loot, movement, and victory. Walking and combat animations proceed automatically between decisions.

This gives browser inference a small, concrete job. The hero can misunderstand priorities, while inventory contents and encounter outcomes remain governed by game rules.

### A simple browser action system

Treat each decision as choosing from a menu of concrete actions generated by game code. The LLM returns a JSON object containing one action ID. The browser looks up the corresponding command and resolves it with ordinary game rules.

```text
Game state → available actions + player orders → LLM
                                                  ↓
Next state ← game rules ← validated action ID as JSON
```

#### Action vocabulary

Start with a few command families. Actions are only offered when their physical prerequisites are satisfied.

| Family | Example command | Availability and consequences |
| --- | --- | --- |
| Movement | `advance` | A route is open; moving consumes game time. |
| Combat | `attack` with an existing target and style | A reachable enemy exists; the engine calculates stamina cost, damage, and retaliation. |
| Supplies | `use_item` with an owned item ID | The item is available; the engine applies its effect and removes it if consumed. |
| Retreat | `retreat` | The encounter allows retreat; its time, health, or loot cost is disclosed. |
| Inventory, later | `take`, `swap`, `equip` | Capacity and equipment rules determine which concrete choices can be offered. |
| Services, later | `buy`, `rest`, `scout` | The location, money, and remaining uses determine availability. |

For the first prototype, use movement, attacks, healing items, and retreat. Add guarding, scouting, trading, and inventory swaps when levels need them.

Physically available does not mean strategically wise. Keep options such as spending the toll money or taking forbidden supplies available when the world permits them. Following the player's priorities and contractual constraints is part of the challenge.

#### Concrete choices, not invented arguments

For example, the browser creates this menu for one combat decision:

```js
const legalActions = [
  {
    id: "a0",
    label: "Quick attack the practice rat: costs 0 stamina.",
    command: { type: "attack", targetId: "rat_2", style: "quick" },
  },
  {
    id: "a1",
    label: "Heavy attack the practice rat: costs 3 stamina.",
    command: { type: "attack", targetId: "rat_2", style: "heavy" },
  },
  {
    id: "a2",
    label: "Drink your last healing potion: restores 20 HP; takes a turn.",
    command: { type: "use_item", itemId: "potion_1" },
  },
  {
    id: "a3",
    label: "Retreat: abandon this encounter's reward; takes a turn.",
    command: { type: "retreat" },
  },
];
```

The numbers and costs are illustrative rules for this example. Offer enough known combat facts for the player and model to understand the tradeoffs, without revealing information that the hero has not discovered.

Send the model the action IDs and descriptions, the visible state, the objective, and the player's orders. Keep the command objects in browser memory. The model only needs to produce:

```json
{"action":"a2"}
```

The game obtains the item ID, target, and attack style from its own menu. Action IDs belong to that particular decision; do not reuse an old reply against a newly generated menu.

#### Parse and validate in JavaScript

```js
function parseCommand(raw, legalActions) {
  if (typeof raw !== "string") throw new Error("Missing decision");
  const result = JSON.parse(raw);

  if (
    result === null ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    Object.keys(result).length !== 1 ||
    typeof result.action !== "string"
  ) {
    throw new Error("Expected an object with one action ID");
  }

  const selected = legalActions.find((a) => a.id === result.action);
  if (!selected) throw new Error("Action was not offered");
  return selected.command;
}
```

Run the returned command through the game's own action dispatcher or reducer. That function checks prerequisites again, applies costs and outcomes, and advances the game state. Model output is data; it is never executed as JavaScript.

#### Constrain the model output

WebLLM supports a `json_object` response format with a JSON Schema supplied as a string. Its [response-format definition](https://github.com/mlc-ai/web-llm/blob/main/src/openai_api_protocols/chat_completion.ts) and [JSON-mode example](https://github.com/mlc-ai/web-llm/blob/main/examples/json-mode/src/json_mode.ts) describe this interface.

Build a schema whose enum contains only the IDs offered for the current decision:

```js
const schema = {
  type: "object",
  properties: {
    action: { type: "string", enum: legalActions.map((a) => a.id) },
  },
  required: ["action"],
  additionalProperties: false,
};

const reply = await engine.chat.completions.create({
  messages: [
    {
      role: "system",
      content:
        'Choose one offered action according to the standing orders. ' +
        'Return only JSON in the form {"action":"offered ID"}.',
    },
    {
      role: "user",
      content: JSON.stringify({
        orders: playerPrompt,
        observation: visibleState,
        actions: legalActions.map(({ id, label }) => ({ id, label })),
      }),
    },
  ],
  response_format: { type: "json_object", schema: JSON.stringify(schema) },
  temperature: 0,
  max_tokens: 64,
});

const choice = reply.choices[0];
if (choice?.finish_reason !== "stop") {
  throw new Error("Decision did not finish normally");
}
const command = parseCommand(choice.message.content, legalActions);
```

This is an integration sketch, not an implemented game. It assumes a loaded WebLLM engine, a nonempty action menu, a player prompt, and a visible-state object. Structured generation reduces format mistakes; browser-side validation remains necessary. Test the selected model and runtime together before relying on their structured output behavior.

The output format controls which commands can be expressed. It does not choose the strategy: two different player prompts can select different valid actions from exactly the same menu.

#### Turn handling and failures

- Allow only one pending decision per hero. Pause the simulation while waiting for it.
- Keep a run ID, state revision, and prompt revision with each request in application code. Discard replies after a restart, state change, or prompt edit.
- Treat deadlines as game turns, not wall-clock inference time, so slower devices do not give the hero less time to finish a level.
- If parsing, generation, or validation fails, retry once without advancing the game. If it still fails, pause with a visible retry option. A model-format failure should not cost the player health or supplies.
- If no actions are available, game code should resolve the terminal state or report a rules error; do not ask the model to invent an action.
- Record the prompt version, offered choices, selected action, and resolved outcome for replay and debugging.
- Request one action at a time. Rebuild the menu after its consequences are known.

Keep output minimal initially. An optional short explanation can be added later for the decision log, but it remains a character's stated reason rather than an authoritative account of the game state.

### First prototype

- One 12-tile loop.
- Three enemy types.
- Two potions.
- Four inventory slots.
- One boss.
- Prompt editing at camp.

The prototype should test whether it is enjoyable to observe a mistake, make one thoughtful prompt change, and see the hero handle the situation better.
