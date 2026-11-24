// Ways of asking the model for one decision, for tune.mjs. Every variant gets the same orders, facts and offered
// actions. The one-call variants are not told which idea a case belongs to, so one prompt serves every kind of stop.
// The read-first variants are: they ask a question that the game would write for that kind of stop.
// A variant: { about, run({ model, orders, cases, idea }) → [{ action, note, ms, reading? }] }.
// Results on the development and held-out wordings are in GAME_NOTES.md ("Tuning the prompt and the setup").
import { messagesFor, thinkPrompt, readPrompt, userPrompt } from './llm.mjs';
import { READING, NOTICE_TOPIC } from './build.mjs';

const HEAD = orders => `You control one game hero. Follow these standing orders as your policy:\n\n${orders}\n\nChoose exactly one offered action at each turn, following the standing orders even when they are a bad strategy.`;
const ids = c => c.actions.map(a => a.id);
/** A reply made of short text fields followed by the action ID. The fields come first, so the action is chosen after them. */
const replySchema = (fields, c) => ({ type: 'object', properties: { ...Object.fromEntries(fields.map(f => [f, { type: 'string' }])), action: { type: 'string', enum: ids(c) } }, required: [...fields, 'action'], additionalProperties: false });
const noteOf = (json, fields) => json ? fields.map(f => `${f}: ${json[f]}`).join(' | ') : '(no complete reply)';
/** One call per decision, built by `prompt(orders, c)` → { messages, fields, maxTokens }. */
const single = prompt => async ({ model, orders, cases }) => {
  const built = cases.map(c => prompt(orders, c));
  const answers = await model.askAll(built.map((b, i) => ({ messages: b.messages, ids: ids(cases[i]), ...(b.fields ? { schema: replySchema(b.fields, cases[i]), maxTokens: b.maxTokens || 160 } : {}) })));
  return answers.map((a, i) => ({ action: a.action, note: built[i].fields ? noteOf(a.json, built[i].fields) : '', ms: a.ms }));
};

const STEPS = `Reply with JSON only: {"seen":"...","order":"...","action":"ID"}.
- "seen": one short sentence in plain words saying what is really happening right now: what the enemy, person, notice or item actually does or is.
- "order": the part of your standing orders that covers exactly that, copied word for word.
- "action": the available action ID that this part of the orders calls for.
Do not invent actions.`;

// Read first, then decide: questions about the scene, answered by the model, become checklist lines in the decision
// prompt (READING in build.mjs writes them). The questions do not depend on the orders, so each case is read once per
// question set. Three sets differ for the two ideas that turn on a trick (a feint, a false seal); the other ideas
// always use the questions in build.mjs.
const YES_NO = ['yes', 'no'];
const yn = value => value ? 'yes' : 'no';
const first = options => Object.fromEntries(options.map((option, i) => [option, yn(i === 0)]));
const TELL_KINDS = ['winding up for its big attack', 'starting its big attack, then giving it up', 'a small ordinary attack', 'nothing dangerous: resting, waiting or distracted'];
const PROOF_KINDS = ["the guild's seal in red wax", 'something else that is red', 'a badge, a paper or a uniform, but no red wax seal', 'nothing at all'];
const QUESTIONS = {
  // One plain yes/no question.
  neutral: {
    tells: row => [{ q: 'Is the enemy winding up for its big attack this turn?', options: YES_NO, truth: yn(row.cls === 'big') }],
    inspector: row => [{ q: "Does this person show the guild's seal in red wax?", options: YES_NO, truth: yn(row.cls === 'genuine') }],
  },
  // The same question with the traps named. With a 3B model this wording produced "no" every time.
  guided: {
    tells: row => [{ q: 'Is the enemy starting its big attack this turn? Answer no for an ordinary attack, for a pause, and for a big attack that it starts and then abandons.', options: YES_NO, truth: yn(row.cls === 'big') }],
    inspector: row => [{ q: 'Does this person show a real guild seal made of red wax? Answer no for a seal that is drawn, promised or the wrong colour, and for any other red object.', options: YES_NO, truth: yn(row.cls === 'genuine') }],
  },
  // A choice between kinds, so that the traps are offered as answers. Only the first kind counts as "yes".
  kinds: {
    tells: row => [{ q: 'What is the enemy doing this turn?', options: TELL_KINDS, map: first(TELL_KINDS), truth: yn(row.cls === 'big') }],
    inspector: row => [{ q: 'What does this person show as proof of being a guild inspector?', options: PROOF_KINDS, map: first(PROOF_KINDS), truth: yn(row.cls === 'genuine') }],
  },
};
// The plain question with made-up examples of each kind (another enemy, other people). Development wordings only:
// the green wax example turned out to match a held-out scene, so tune.mjs refuses this set on the held-out wordings.
QUESTIONS.shots = {
  tells: row => [{ q: `Is the enemy winding up for its big attack this turn?
Examples with another enemy:
- "The ogre lifts its club high over its head with both arms." yes
- "The ogre lifts its club high, then lowers it again to scratch its back." no: it gave the attack up
- "The ogre pokes at you with the handle of its club." no: a small attack
- "The ogre sits down on a rock and yawns." no: no attack`, options: YES_NO, truth: yn(row.cls === 'big') }],
  inspector: row => [{ q: `Does this person show the guild's seal in red wax?
Examples with other people:
- "A woman unrolls a letter with the guild's seal pressed into red wax at the foot." yes
- "A man points at the red ribbon on his hat and calls it the seal." no: red, but not the wax seal
- "A man says his seal is at home." no: nothing is shown
- "A woman holds up a seal pressed into green wax." no: the wrong colour`, options: YES_NO, truth: yn(row.cls === 'genuine') }],
};
// Two plain questions for the tell: does a big attack begin, and is it broken off? A big attack is yes, then no.
// A feint is yes, then yes. Only the combined answer is scored as the reading; both replies are kept in `said`.
QUESTIONS.follow = {
  tells: row => [
    { q: 'Does the enemy begin to wind up for a big attack at any point this turn?', options: YES_NO, truth: yn(row.cls === 'big' || row.cls === 'feint'), big: yn(row.cls === 'big') },
    { q: 'Does the enemy break off what it began and turn to something harmless?', options: YES_NO, truth: yn(row.cls === 'feint') },
  ],
  inspector: QUESTIONS.neutral.inspector,
};
// The two-part tell question with the guided seal question: the best pair for Qwen 3 8B on the development wordings.
QUESTIONS['follow-guided'] = { tells: QUESTIONS.follow.tells, inspector: QUESTIONS.guided.inspector };
// A missing reply leaves the combined answer missing too: the label is then written as "no", and the reading counts as wrong.
const followed = ([begins, breaksOff]) => [{ ...begins, truth: begins.big, said: `begins ${begins.answer}, breaks off ${breaksOff.answer}`, answer: begins.answer === null || breaksOff.answer === null ? null : yn(begins.answer === 'yes' && breaksOff.answer === 'no'), ms: begins.ms + breaksOff.ms }];
const REDUCE = { follow: { tells: followed }, 'follow-guided': { tells: followed } };
// The plain question, answered after one sentence that says what happens from start to finish.
QUESTIONS.described = Object.fromEntries(Object.entries(QUESTIONS.neutral).map(([idea, make]) => [idea, row => make(row).map(x => ({ ...x, describe: true }))]));
const describedPrompt = (facts, question, options) => ({
  messages: [
    { role: 'system', content: 'You are the eyes of a game hero. Read the situation and answer the question about it. Return only JSON: {"seen":"...","answer":"..."}. In "seen", say in one short sentence what happens from start to finish, including how it ends. Then give one of the offered answers.' },
    { role: 'user', content: `SITUATION\n${facts}\n\nQUESTION\n${question}\nOffered answers: ${options.join(' | ')}` },
  ],
  ids: options,
  schema: { type: 'object', properties: { seen: { type: 'string' }, answer: { type: 'string', enum: options } }, required: ['seen', 'answer'], additionalProperties: false },
  maxTokens: 100,
});
const questionsFor = (set, idea, row) => (QUESTIONS[set]?.[idea] || READING[idea].questions)(row);

// Ways of deciding once the checklist is written. Each takes the built cases ({ facts, actions }) and returns { action, ms, note }.
const DECIDE = {
  plain: async (model, orders, built) => model.askAll(built.map(b => ({ messages: messagesFor(orders, b.facts, b.actions), ids: ids(b) }))),
  last: async (model, orders, built) => model.askAll(built.map(b => ({ messages: [{ role: 'system', content: messagesFor(orders, b.facts, b.actions)[0].content }, { role: 'user', content: withOrdersLast(orders, b) }], ids: ids(b) }))),
  clerk: async (model, orders, built) => model.askAll(built.map(b => ({ messages: clerk(orders, b, 'Return only JSON: {"action":"ID"}.'), ids: ids(b) }))),
  // One yes/no question per offered action. A single yes decides; otherwise the plain question is asked among the
  // actions that got a yes (or among all of them, if none did).
  vote: async (model, orders, built) => {
    const asked = built.flatMap((b, at) => b.actions.map(a => ({ at, id: a.id, prompt: {
      messages: [
        { role: 'system', content: 'You check one proposed action against a player\'s written standing orders for a game hero. Answer yes only if the orders call for exactly this action in this situation. You do not judge whether it is a good move. Return only JSON: {"answer":"yes"} or {"answer":"no"}.' },
        { role: 'user', content: `SITUATION\n${b.facts}\n\nSTANDING ORDERS\n${orders}\n\nPROPOSED ACTION\n${a.id}: ${a.label}. ${a.detail}\n\nDo the standing orders call for this action in this situation?` },
      ],
      ids: YES_NO, schema: { type: 'object', properties: { answer: { type: 'string', enum: YES_NO } }, required: ['answer'], additionalProperties: false }, maxTokens: 16,
    } })));
    const votes = await model.askAll(asked.map(x => x.prompt));
    const yes = built.map((b, at) => asked.flatMap((x, i) => x.at === at && votes[i].json?.answer === 'yes' ? [x.id] : []));
    const spent = built.map((b, at) => asked.reduce((sum, x, i) => sum + (x.at === at ? votes[i].ms : 0), 0));
    const open = built.flatMap((b, at) => yes[at].length === 1 ? [] : [at]);
    const second = await model.askAll(open.map(at => { const actions = yes[at].length ? built[at].actions.filter(a => yes[at].includes(a.id)) : built[at].actions; return { messages: messagesFor(orders, built[at].facts, actions), ids: actions.map(a => a.id) }; }));
    return built.map((b, at) => {
      const again = open.indexOf(at);
      return { action: again < 0 ? yes[at][0] : second[again].action, ms: spent[at] + (again < 0 ? 0 : second[again].ms), note: `yes to: ${yes[at].join(', ') || 'none'}` };
    });
  },
};
// Two ways of writing the answers into the decision prompt. `checklist` (READING in build.mjs) adds them under the
// prose. `swap` puts them in place of the prose, so that the decision sees a labelled situation, as in the game today.
const replaceLine = (facts, prefix, text) => facts.split('\n').map(line => line.startsWith(prefix) ? `${prefix}${text}` : line).join('\n');
const SWAP = {
  tells: (c, [big]) => ({ ...c, facts: replaceLine(c.facts, "Enemy's move this turn: ", big === 'yes' ? 'BIG ATTACK. The enemy is winding up for its big attack, a far heavier blow than its ordinary strike.' : 'no big attack. An ordinary strike, or nothing at all.') }),
  notice: (c, [forbid, mandate], row) => ({ ...c, facts: replaceLine(c.facts, 'Guild notice in force today: ', [forbid === 'yes' && `it forbids ${NOTICE_TOPIC[row.stop].forbids} today.`, mandate === 'yes' && `it requires ${NOTICE_TOPIC[row.stop].requires} today.`].filter(Boolean).join(' Also, ') || 'it says nothing about this stop.') }),
  stock: (c, effects) => ({ ...c, actions: c.actions.map((a, i) => i < effects.length ? { ...a, detail: `Effect: ${effects[i]}. Spend 8 of 14 coins. Takes one turn.` } : a) }),
  inspector: (c, [seal]) => ({ ...c, facts: replaceLine(c.facts, 'On the path: ', seal === 'yes' ? "A guild inspector shows the guild's red wax seal and asks to see your stamp card." : "Someone asks for your stamp card. This person does NOT show the guild's red wax seal.") }),
  opponent: (c, [type], row) => ({ ...c, facts: replaceLine(c.facts, 'Enemy: ', `${row.name}, 16 of 16 health. This enemy is ${type}. This fight gives a required training stamp.`) }),
  offer: (c, [type]) => ({ ...c, facts: replaceLine(c.facts, 'Before the bell, an offer is made: ', `the bruiser proposes this: ${type}.`) }),
};
const readings = new Map();
/** `questions`: a set in QUESTIONS, or 'truth' for the true answers. `decide`: a key of DECIDE. */
const readFirst = ({ questions = 'neutral', decide = 'plain', write = 'checklist' } = {}) => async ({ model, orders, cases, idea }) => {
  const truth = questions === 'truth';
  const cache = readings.get(questions) || readings.set(questions, new Map()).get(questions);
  const todo = truth ? [] : cases.filter(c => !cache.has(c));
  const asked = todo.flatMap(c => questionsFor(questions, idea, c.source).map(question => ({ c, ...question })));
  const got = await model.askAll(asked.map(x => (x.describe ? describedPrompt : readPrompt)(x.c.facts, x.q, x.options)));
  for (const c of todo) {
    const list = asked.map((x, i) => { const said = got[i].json?.answer ?? null; return { ...x, said, answer: said === null ? null : x.map ? x.map[said] : said, ms: got[i].ms }; }).filter(x => x.c === c);
    cache.set(c, REDUCE[questions]?.[idea]?.(list) ?? list);
  }
  const read = c => truth ? READING[idea].questions(c.source).map(x => ({ ...x, answer: x.truth, ms: 0 })) : cache.get(c);
  // An unanswered question counts as its last option ("no").
  const built = cases.map(c => (write === 'swap' ? SWAP[idea] : READING[idea].apply)(c, read(c).map(x => x.answer ?? (x.map ? 'no' : x.options.at(-1))), c.source));
  const answers = await DECIDE[decide](model, orders, built);
  return answers.map((a, i) => {
    const mine = read(cases[i]);
    const wrong = mine.filter(x => x.answer !== x.truth);
    const misread = wrong.length ? `misread: ${wrong.map(x => `said "${x.said ?? x.answer}", true "${x.truth}"`).join('; ')}` : truth ? '' : 'read correctly';
    return { action: a.action, ms: a.ms + mine.reduce((sum, x) => sum + x.ms, 0), reading: mine.map(x => ({ answer: x.answer, truth: x.truth, said: x.said })), note: [misread, a.note].filter(Boolean).join(' | ') };
  });
};

const withOrdersLast = (orders, c) => `${userPrompt(c.facts, c.actions).replace(/\n\nChoose the next action according to your standing orders\.$/, '')}\n\nYOUR STANDING ORDERS\n${orders}\n\nChoose the next action according to your standing orders.`;
const CLERK = 'You apply a player\'s written standing orders to a game situation. You are not playing to win and you do not use your own judgement about tactics: you pick the action that the orders call for in the situation in front of you, even when it is a bad move. Read the situation carefully first, because the orders often turn on one detail of it.';
const clerk = (orders, c, reply) => [{ role: 'system', content: `${CLERK} ${reply}` }, { role: 'user', content: `SITUATION\n${c.facts}\n\nAVAILABLE ACTIONS\n${c.actions.map(a => `${a.id}: ${a.label}. ${a.detail}`).join('\n')}\n\nSTANDING ORDERS\n${orders}\n\nWhich available action do the standing orders call for in this situation?` }];
const ASK = `Reply with JSON only: {"question":"...","answer":"...","action":"ID"}.
- "question": the one thing the standing orders need to know about this situation before an action can be picked, as a short question.
- "answer": the answer to that question, taken from the situation text, with the words that show it.
- "action": the available action ID that the orders call for, given that answer.`;
const REASON = 'Work out briefly what the situation shows and which part of the orders covers it. Then finish with one line of JSON and nothing after it: {"action":"ID"}, using one of the available action IDs.';

export const VARIANTS = {
  plain: {
    about: "the game's prompt and reply as they are: one action ID",
    run: single((orders, c) => ({ messages: messagesFor(orders, c.facts, c.actions) })),
  },
  think: {
    about: 'one short sentence of thought before the action (the existing --mode=think)',
    run: async ({ model, orders, cases }) => (await model.askAll(cases.map(c => thinkPrompt(orders, c.facts, c.actions)))).map(a => ({ action: a.action, note: a.json?.thought ?? '(no complete reply)', ms: a.ms })),
  },
  steps: {
    about: 'reply names what is seen, then quotes the order that covers it, then the action',
    run: single((orders, c) => ({ messages: [{ role: 'system', content: `${HEAD(orders)} ${STEPS}` }, { role: 'user', content: userPrompt(c.facts, c.actions) }], fields: ['seen', 'order'] })),
  },
  'steps-last': {
    about: 'as steps, with the standing orders repeated after the situation',
    run: single((orders, c) => ({ messages: [{ role: 'system', content: `${HEAD(orders)} ${STEPS}` }, { role: 'user', content: `${userPrompt(c.facts, c.actions).replace(/\n\nChoose the next action according to your standing orders\.$/, '')}\n\nYOUR STANDING ORDERS\n${orders}\n\nChoose the next action according to your standing orders.` }], fields: ['seen', 'order'] })),
  },
  // read-<questions>[-swap][-<decide>]: the model answers the questions, then decides with its answers written in.
  // labels[-swap][-<decide>]: the same with the true answers. Not a contestant: it shows what deciding is worth once the reading is right.
  ...Object.fromEntries(['neutral', 'guided', 'kinds', 'described', 'shots', 'follow', 'follow-guided', 'truth'].flatMap(questions => ['checklist', 'swap'].flatMap(write => ['plain', 'last', 'clerk', 'vote'].map(decide => [
    [questions === 'truth' ? 'labels' : `read-${questions}`, write === 'swap' && 'swap', decide !== 'plain' && decide].filter(Boolean).join('-'),
    {
      about: `${questions === 'truth' ? 'the true answers to the scene questions' : `the model answers the scene questions first (${questions} wording); its answers`} are written ${write === 'swap' ? 'in place of the prose' : 'as checklist lines under the prose'}; decision: ${decide}`,
      run: readFirst({ questions, decide, write }),
    },
  ])))),
  last: {
    about: 'plain, with the standing orders repeated after the offered actions',
    run: single((orders, c) => ({ messages: [{ role: 'system', content: messagesFor(orders, c.facts, c.actions)[0].content }, { role: 'user', content: withOrdersLast(orders, c) }] })),
  },
  clerk: {
    about: 'the model applies the orders as a clerk, not as a player; orders after the situation; one action ID',
    run: single((orders, c) => ({ messages: clerk(orders, c, 'Return only JSON: {"action":"ID"}.') })),
  },
  ask: {
    about: 'clerk, and the reply first states the question the orders pose, then answers it from the situation, then acts',
    run: single((orders, c) => ({ messages: clerk(orders, c, ASK), fields: ['question', 'answer'] })),
  },
  reason: {
    about: "clerk, with free reasoning before the JSON (Qwen 3: its own thinking mode); no grammar on the reply",
    run: async ({ model, orders, cases }) => (await model.askAll(cases.map(c => ({ messages: clerk(orders, c, REASON), ids: ids(c), free: true, thinking: true, maxTokens: 900 })))).map(a => ({ action: a.action, ms: a.ms, note: (a.raw || '').replace(/\s+/g, ' ').slice(-260) })),
  },
};
