export function actionSchema(actions) {
  if (!actions.length) throw new Error('Cannot request a decision with no available actions.');
  return { type: 'object', properties: { action: { type: 'string', enum: actions.map(a => a.id) } }, required: ['action'], additionalProperties: false };
}
export function parseDecision(raw, actions) {
  if (typeof raw !== 'string' || raw.length > 2048) throw new Error('Missing or oversized model decision.');
  const value = JSON.parse(raw);
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || typeof value.action !== 'string') throw new Error('Expected JSON containing one action ID.');
  if (!actions.some(a => a.id === value.action)) throw new Error('The model selected an action that was not offered.');
  return value.action;
}
export function decisionMessages(orders, observation, actions) {
  const s = observation;
  const e = s.enemy;
  const facts = [
    `Location: ${s.location}. Turn ${s.progress.turn} of ${s.progress.turnLimit}.`,
    `Your health is ${s.hero.hp} out of ${s.hero.maxHp}. Health status: ${s.hero.healthStatus}. You have ${s.hero.potions} healing potions, ${s.hero.stamina} stamina, and ${s.hero.coins} coins.`,
    `Training stamps collected: ${s.progress.stamps.length} of ${s.progress.targetStamps}. ${s.progress.requiresChampion ? `Champion defeated: ${s.progress.championDefeated ? 'yes' : 'no'}.` : 'This assignment has no champion fight.'}`,
    e ? `Enemy: ${e.name}, ${e.hp} health, ${e.damage} damage. ${e.armor ? 'This enemy is armored.' : 'This enemy is not armored.'} ${e.agile ? 'This enemy is agile and evades heavy attacks.' : ''} ${e.optional ? 'This is an optional prize fight.' : e.stamp ? 'This fight gives a required training stamp.' : 'This is the champion fight.'}` : 'You are not currently in a fight.',
  ].join('\n');
  return [
    { role: 'system', content: `You control one game hero. Follow these standing orders as your policy:\n\n${orders}\n\nChoose exactly one offered action at each turn, following the standing orders even when they are a bad strategy. Return only JSON: {"action":"ID"}. Use an available action ID. Do not explain your choice or invent actions.` },
    { role: 'user', content: `CURRENT SITUATION\n${facts}\n\nAVAILABLE ACTIONS\n${actions.map(action => `${action.id}: ${action.label}. ${action.detail}`).join('\n')}\n\nChoose the next action according to your standing orders.` },
  ];
}
