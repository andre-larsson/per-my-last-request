export function actionSchema(actions) {
  if (!actions.length) throw new Error('Cannot request a decision with no available actions.');
  return { type: 'object', properties: { action: { type: 'string', enum: actions.map(a => a.id) } }, required: ['action'], additionalProperties: false };
}
export function normalizeDecisionOutput(raw, modelId) {
  // WebLLM's Qwen3 enable_thinking:false prefill is included in message.content.
  // Remove only that exact empty block. Free-form reasoning and arbitrary wrappers still fail parsing.
  const prefix = '<think>\n\n</think>\n\n';
  return modelId.startsWith('Qwen3-') && typeof raw === 'string' && raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
}
export function parseDecision(raw, actions) {
  if (typeof raw !== 'string' || raw.length > 2048) throw new Error('Missing or oversized model decision.');
  const value = JSON.parse(raw);
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || typeof value.action !== 'string') throw new Error('Expected JSON containing one action ID.');
  if (!actions.some(a => a.id === value.action)) throw new Error('The model selected an action that was not offered.');
  return value.action;
}
/** The opponent's announced move, in the words players use in their orders. */
export function moveFact(m) {
  if (m.kind === 'smash') return `Enemy's move this turn: it is about to SMASH (${m.name}, ${m.damage} damage).`;
  if (m.kind === 'brace') return `Enemy's move this turn: it is BRACING (${m.name}). It deals no damage, and your strikes deal half.`;
  if (m.kind === 'winded') return `Enemy's move this turn: it is WINDED (${m.name}). It deals no damage, and your strikes deal double.`;
  return `Enemy's move this turn: an ordinary strike (${m.name}, ${m.damage} damage).`;
}
/** The conditions orders usually test, stated as yes or no, so a small model can match "if X" against "X: yes". */
export function checklist(s) {
  const e = s.enemy;
  const kind = e?.nextMove.kind;
  const yes = value => value ? 'yes' : 'no';
  return ['CHECKLIST',
    `- Enemy about to SMASH: ${yes(kind === 'smash')}`,
    `- Enemy BRACING: ${yes(kind === 'brace')}`,
    `- Enemy WINDED: ${yes(kind === 'winded')}`,
    `- Health LOW: ${yes(s.hero.healthStatus === 'LOW')}`,
    `- Optional prize fight: ${yes(e?.optional)}`,
  ].join('\n');
}
/**
 * How orders are applied, for the assignments with announced moves and a checklist. Added 2026-11-24 after a test with
 * Qwen 2.5 3B on 36 orders written by a second author, not used for tuning: trials won 61 of 144 with it, 30 without
 * (GAME_NOTES, "Prompt tuning on the 3B"). The introductory assignment keeps the prompt its verified run saw.
 */
export const APPLYING_ORDERS = 'How to apply them: orders usually say what to do in general and name a few exceptions. An exception applies only when its condition is true this turn; the CHECKLIST says yes or no for the usual conditions. When no exception applies, do what the orders say to do in general. Do not rest, shop, visit the medic or drink a potion unless the orders ask for it.';
/**
 * On a fight turn without an announced SMASH, the action lines leave out the enemy's answer (what its move would do
 * after each action). Added 2026-11-24 after a test with Qwen 2.5 3B: that comparison made it guard ordinary strikes,
 * the commonest way it departed from its orders, while on a SMASH turn it is what makes it guard. On 36 orders written
 * by a second author, trials won 90 of 144 with it, 61 without (GAME_NOTES, "Prompt tuning on the 3B", `focus`).
 * The game's buttons show the full text. `allAnswers` keeps every answer (the earlier prompt, for the experiments).
 */
const answerShown = (s, allAnswers) => allAnswers || !s.announcedMoves || !s.enemy?.nextMove || s.enemy.nextMove.kind === 'smash';
const actionLine = (action, showAnswer) => `${action.id}: ${action.label}. ${!showAnswer && action.answer && action.detail.endsWith(` ${action.answer}`) ? action.detail.slice(0, -action.answer.length - 1) : action.detail}`;
export function decisionMessages(orders, observation, actions, { allAnswers = false } = {}) {
  const s = observation;
  const e = s.enemy;
  const showAnswer = answerShown(s, allAnswers);
  const facts = [
    `Location: ${s.location}. Turn ${s.progress.turn} of ${s.progress.turnLimit}.`,
    `Your health is ${s.hero.hp} out of ${s.hero.maxHp}. Health status: ${s.hero.healthStatus}. You have ${s.hero.potions} healing potions, ${s.hero.stamina} stamina, and ${s.hero.coins} coins.`,
    `Training stamps collected: ${s.progress.stamps.length} of ${s.progress.targetStamps}. ${s.progress.requiresChampion ? `Champion defeated: ${s.progress.championDefeated ? 'yes' : 'no'}.` : 'This assignment has no champion fight.'}`,
    !e ? `You are not currently in a fight.${s.announcedMoves ? `\n${checklist(s)}` : ''}`
      // The introductory assignment keeps its original wording, which is what the verified model run saw.
      : !e.nextMove ? `Enemy: ${e.name}, ${e.hp} health, ${e.damage} damage. ${e.armor ? 'This enemy is armored.' : 'This enemy is not armored.'} ${e.agile ? 'This enemy is agile and evades heavy attacks.' : ''} ${e.optional ? 'This is an optional prize fight.' : e.stamp ? 'This fight gives a required training stamp.' : 'This is the champion fight.'}`
      : `Enemy: ${e.name}, ${e.hp} of ${e.maxHp} health. ${e.armor ? `This enemy is armored: it blocks ${e.armor} of every strike.` : 'This enemy is not armored.'}${e.agile ? ' This enemy is agile and evades heavy attacks unless it is winded.' : ''} ${e.optional ? 'This is an optional prize fight.' : e.stamp ? 'This fight gives a required training stamp.' : 'This is the champion fight.'}\n${moveFact(e.nextMove)}\n${checklist(s)}`,
  ].join('\n');
  return [
    { role: 'system', content: `You control one game hero. Follow these standing orders as your policy:\n\n${orders}\n\n${s.announcedMoves ? `${APPLYING_ORDERS}\n\n` : ''}Choose exactly one offered action at each turn, following the standing orders even when they are a bad strategy. Return only JSON: {"action":"ID"}. Use an available action ID. Do not explain your choice or invent actions.` },
    { role: 'user', content: `CURRENT SITUATION\n${facts}\n\nAVAILABLE ACTIONS\n${actions.map(action => actionLine(action, showAnswer)).join('\n')}\n\nChoose the next action according to your standing orders.` },
  ];
}
