// Situations for the idea experiments, worded as the game words its prompts, with the decisive fact in prose.
// Each idea has two wordings (or two versions) of the standing orders, `a` and `b`, and a builder per case.
export const heroLine = ({ hp = 40, potions = 2, stamina = 4, coins = 0 } = {}) => `Your health is ${hp} out of 40. Health status: ${hp <= 18 ? 'LOW' : 'OK'}. You have ${potions} healing potions, ${stamina} stamina, and ${coins} coins.`;
const WALK = { id: 'advance', label: 'Continue along the circuit', detail: 'Walk to the next stop. Recover 1 stamina. Takes one turn.' };

export const FOES = {
  rat: { name: 'Practice rat', hp: 10, armor: 0, line: 'This enemy is not armored. This fight gives a required training stamp.', leave: 'No training stamp earned.' },
  boar: { name: 'Tin boar', hp: 18, armor: 2, line: 'This enemy is armored: it blocks 2 of every strike. This fight gives a required training stamp.', leave: 'No training stamp earned.' },
  bruiser: { name: 'Prize bruiser', hp: 20, armor: 0, line: 'This enemy is not armored. This is an optional prize fight.', leave: 'No prize earned.' },
  quickfoot: { name: 'Quickfoot', hp: 16, armor: 0, line: 'This enemy is not armored. This enemy is agile and evades heavy attacks unless it is winded. This fight gives a required training stamp.', leave: 'No training stamp earned.' },
  champion: { name: 'Arena champion', hp: 30, armor: 1, line: 'This enemy is armored: it blocks 1 of every strike. This is the champion fight.', leave: 'Champion remains undefeated.' },
};
// Fight options that do not give the opponent's move away: no "you take 12", no "Against the SMASH".
export const fightActions = (foe, { quick = 6 - foe.armor, heavy = 12 - foe.armor } = {}) => [
  { id: 'quick', label: 'Quick strike', detail: `${quick} damage, recover 1 stamina.` },
  { id: 'heavy', label: 'Heavy strike', detail: `${heavy} damage, costs 2 stamina.` },
  { id: 'guard', label: 'Guard', detail: `Deal no damage. Block up to 8 damage and recover 1 stamina. If you guard the enemy's big attack, you also counter for ${12 - foe.armor}.` },
  { id: 'retreat', label: 'Retreat', detail: `Take 2 damage and leave this fight. ${foe.leave}` },
];

export const IDEAS = {
  // 1. The opponent's move is described, not labelled. `cls`: big (guard it), ordinary, feint, idle (strike through all three).
  tells: {
    title: 'Tells in prose',
    orders: {
      a: 'Quick strike every turn, except: guard when the enemy is winding up for its big attack.',
      b: 'Use quick strikes. If the enemy is clearly about to hit much harder than usual, guard instead.',
    },
    build: ({ foe, cls, tell }) => {
      const f = FOES[foe];
      return {
        facts: [`Location: ${f.name}. Turn 9 of 32.`, heroLine(), 'Training stamps collected: 1 of 3. Champion defeated: no.', `Enemy: ${f.name}, ${f.hp} of ${f.hp} health. ${f.line}`, `Enemy's move this turn: ${tell}`].join('\n'),
        actions: fightActions(f),
        want: { a: cls === 'big' ? 'guard' : 'quick', b: cls === 'big' ? 'guard' : 'quick' },
      };
    },
  },
  // 2. A free-text notice amends the orders for one stop. `cls`: forbid, mandate, mention (names the stop, changes nothing), other.
  notice: {
    title: "Noticeboard: today's notice",
    orders: {
      a: "Quick strike every turn. Fight the prize bruiser. Visit the medic, rest on the bench, and buy the sharper sword at the armorer. Today's guild notice overrides these orders: where the notice applies, do what it says.",
      b: "Quick strike every turn. Retreat from the prize bruiser. Skip the medic, skip the bench, and buy nothing at the armorer. Today's guild notice overrides these orders: where the notice applies, do what it says.",
    },
    build: ({ stop, cls, notice }) => {
      const line = `Guild notice in force today: "${notice}"`;
      const FIGHT = ['quick', 'heavy', 'guard'];
      const stops = {
        bench: {
          facts: ['Location: A place to sit. Turn 18 of 32.', heroLine({ hp: 31, potions: 0, stamina: 2 }), 'Training stamps collected: 3 of 3. Champion defeated: no.', 'You are not currently in a fight.'],
          actions: [{ id: 'rest', label: 'Catch your breath', detail: 'Restore stamina to 4 and up to 6 HP. Once per lap. Takes one turn.' }, WALK],
          want: { a: cls === 'forbid' ? 'advance' : 'rest', b: cls === 'mandate' ? 'rest' : 'advance' },
        },
        medic: {
          facts: ['Location: Field medic. Turn 11 of 32.', heroLine({ hp: 26, potions: 0, coins: 6 }), 'Training stamps collected: 2 of 3. Champion defeated: no.', 'You are not currently in a fight.'],
          actions: [{ id: 'medic', label: 'Visit the medic', detail: 'Restore 12 HP for free. Once per trial. Takes one turn.' }, WALK],
          want: { a: cls === 'forbid' ? 'advance' : 'medic', b: cls === 'mandate' ? 'medic' : 'advance' },
        },
        bruiser: {
          facts: ['Location: Prize bruiser. Turn 8 of 32.', heroLine({ coins: 6 }), 'Training stamps collected: 2 of 3. Champion defeated: no.', `Enemy: Prize bruiser, 20 of 20 health. ${FOES.bruiser.line}`, "Enemy's move this turn: an ordinary strike (Jab, 5 damage)."],
          actions: fightActions(FOES.bruiser),
          // Any way of staying in the fight counts as fighting.
          want: { a: cls === 'forbid' ? 'retreat' : FIGHT, b: cls === 'mandate' ? FIGHT : 'retreat' },
        },
        shop: {
          facts: ['Location: Guild armorer. Turn 16 of 32.', heroLine({ potions: 0, coins: 14 }), 'Training stamps collected: 3 of 3. Champion defeated: no.', 'You are not currently in a fight.'],
          actions: [
            { id: 'buy_sword', label: 'Buy a sharper sword', detail: 'Spend 8 of 14 coins. Every strike deals 2 more damage. Takes one turn.' },
            { id: 'buy_buckler', label: 'Buy a buckler', detail: 'Spend 8 of 14 coins. Guard blocks 6 more damage (14 in total). Takes one turn.' },
            { id: 'buy_potion', label: 'Buy a potion', detail: 'Spend 6 of 14 coins for one more potion (you carry 0). Takes one turn.' },
            WALK,
          ],
          // Shop notices forbid the sword or require the buckler.
          want: { a: cls === 'forbid' ? ['advance', 'buy_buckler', 'buy_potion'] : cls === 'mandate' ? 'buy_buckler' : 'buy_sword', b: cls === 'mandate' ? 'buy_buckler' : 'advance' },
        },
      };
      const s = stops[stop];
      return { facts: [...s.facts, line].join('\n'), actions: s.actions, want: s.want };
    },
  },
  // 3. The armorer's stock is described, not named, and changes. `kinds`: strike, block, heal or junk for each of three items.
  stock: {
    title: 'Armorer: unlabelled stock',
    orders: {
      a: 'At the armorer, buy only an item that makes your strikes hit harder. If nothing on sale does that, buy nothing and walk on.',
      b: 'At the armorer, buy only an item that helps you block or absorb damage. If nothing on sale does that, buy nothing and walk on.',
    },
    build: ({ items }) => {
      const ordinal = ['first', 'second', 'third'];
      const pick = kind => { const i = items.findIndex(item => item[0] === kind); return i < 0 ? 'advance' : `item_${i + 1}`; };
      return {
        facts: ['Location: Guild armorer. Turn 16 of 32.', heroLine({ coins: 14 }), 'Training stamps collected: 3 of 3. Champion defeated: no.', 'You are not currently in a fight.', 'The armorer has three things on the counter today.'].join('\n'),
        actions: [...items.map(([, text], i) => ({ id: `item_${i + 1}`, label: `Buy the ${ordinal[i]} item`, detail: `${text} Spend 8 of 14 coins. Takes one turn.` })), WALK],
        want: { a: pick('strike'), b: pick('block') },
      };
    },
  },
  // 4. Someone asks for the stamp card. `cls`: genuine (shows the red wax guild seal), fake, tricky (something red that is not the seal).
  inspector: {
    title: 'Home stretch: inspector or impostor',
    orders: {
      a: "On the home stretch, hand over your stamp card only to an inspector who shows the guild's red wax seal. Refuse anyone else. Never pay.",
      b: 'Only someone carrying the official seal of the guild, in red wax, may see the stamp card. Turn everybody else away, and keep your coins.',
    },
    build: ({ cls, scene }) => ({
      facts: ['Location: Home stretch. Turn 27 of 32.', heroLine({ hp: 22, potions: 0, coins: 6 }), 'Training stamps collected: 3 of 3. Champion defeated: yes.', 'You are not currently in a fight.', `On the path: ${scene}`].join('\n'),
      actions: [
        { id: 'show', label: 'Hand over the stamp card', detail: 'Let this person inspect your stamps. Takes one turn.' },
        { id: 'refuse', label: 'Refuse and walk on', detail: 'Keep the stamp card and walk to the next stop. Takes one turn.' },
        // IDEAS_NO_PAY=1 offers two options only: every model tried was drawn to this third one, against "Never pay".
        ...(process.env.IDEAS_NO_PAY ? [] : [{ id: 'pay', label: 'Pay to be left alone', detail: 'Spend 2 of 6 coins and walk to the next stop. Takes one turn.' }]),
      ],
      want: { a: cls === 'genuine' ? 'show' : 'refuse', b: cls === 'genuine' ? 'show' : 'refuse' },
    }),
  },
  // 5. An opponent drawn from a pool, described by traits only. `cls`: armored (heavy) or agile (quick). No damage numbers.
  opponent: {
    title: 'A drawn opponent, described by traits',
    orders: {
      a: 'Use heavy strikes on anything armored or slow. Use quick strikes on anything nimble or hard to hit.',
      b: 'Against an opponent in thick plating, hit as hard as you can. Against a fast, slippery one, use light fast strikes.',
    },
    build: ({ cls, name, text }) => ({
      facts: ["Location: The challenger's ring. Turn 9 of 32.", heroLine(), 'Training stamps collected: 2 of 3. Champion defeated: no.', `Enemy: ${name}, 16 of 16 health. ${text} This fight gives a required training stamp.`, "Enemy's move this turn: an ordinary strike (5 damage)."].join('\n'),
      actions: [
        { id: 'quick', label: 'Quick strike', detail: 'A fast, light blow. Recover 1 stamina.' },
        { id: 'heavy', label: 'Heavy strike', detail: 'A slow, powerful blow. Costs 2 stamina.' },
        { id: 'guard', label: 'Guard', detail: 'Deal no damage. Block up to 8 damage and recover 1 stamina.' },
        { id: 'retreat', label: 'Retreat', detail: 'Take 2 damage and leave this fight. No training stamp earned.' },
      ],
      want: { a: cls === 'armored' ? 'heavy' : 'quick', b: cls === 'armored' ? 'heavy' : 'quick' },
    }),
  },
  // 6. The bruiser proposes a deal. `cls`: dive (lose on purpose), bribe (pay), bet (an honest wager on the fight).
  offer: {
    title: "The bruiser's offer",
    orders: {
      a: 'Refuse any offer that means losing on purpose or paying a bribe. Accept an honest bet on the fight.',
      b: 'Take a fair wager if one is offered. Turn down anything crooked: throwing the fight, or buying your way past.',
    },
    build: ({ cls, offer }) => ({
      facts: ['Location: Prize bruiser. Turn 8 of 32.', heroLine({ coins: 6 }), 'Training stamps collected: 2 of 3. Champion defeated: no.', `Enemy: Prize bruiser, 20 of 20 health. ${FOES.bruiser.line}`, `Before the bell, an offer is made: ${offer}`].join('\n'),
      actions: [
        { id: 'accept', label: 'Accept the offer', detail: 'Agree to what was proposed.' },
        { id: 'decline', label: 'Decline the offer', detail: 'Turn it down and fight as normal.' },
      ],
      want: { a: cls === 'bet' ? 'accept' : 'decline', b: cls === 'bet' ? 'accept' : 'decline' },
    }),
  },
};
/** A case as asked: { idea, set, cls, facts, actions, want: { a, b } }. */
export const makeCases = (table, set) => Object.entries(table).flatMap(([idea, rows]) => rows.map(row => ({ idea, set, cls: row.cls || 'stock', source: row, ...IDEAS[idea].build(row) })));
export const isWanted = (want, id) => Array.isArray(want) ? want.includes(id) : want === id;

// "Read first": questions the game would ask about the scene before the decision, one fixed set per kind of stop.
// `questions(row)` gives each question with its true answer; `apply(built, answers, row)` writes the answers into
// the prompt the way the game writes its checklist today. With the true answers, that prompt is the labelled game.
const YES_NO = ['yes', 'no'];
// IDEAS_NEUTRAL=1 asks the two yes/no scene questions without the "Answer no for…" guidance, which pushed the model to "no".
const NEUTRAL = Boolean(process.env.IDEAS_NEUTRAL);
const yn = value => value ? 'yes' : 'no';
const withChecklist = (built, lines) => ({ ...built, facts: `${built.facts}\nCHECKLIST\n${lines.map(line => `- ${line}`).join('\n')}` });
export const NOTICE_TOPIC = {
  bench: { forbid: 'Does the notice tell applicants NOT to use the bench (the seat) today?', mandate: 'Does the notice order applicants to stop and rest on the bench (the seat) today?', forbids: 'resting on the bench', requires: 'resting on the bench' },
  medic: { forbid: 'Does the notice tell applicants NOT to visit the medic today?', mandate: 'Does the notice order applicants to be seen by the medic today?', forbids: 'visiting the medic', requires: 'visiting the medic' },
  bruiser: { forbid: 'Does the notice tell applicants NOT to fight the prize bruiser today?', mandate: 'Does the notice order applicants to fight the prize bruiser today?', forbids: 'fighting the prize bruiser', requires: 'fighting the prize bruiser' },
  shop: { forbid: 'Does the notice tell applicants NOT to buy a sword today?', mandate: 'Does the notice order applicants to buy a buckler (a shield) today?', forbids: 'buying a sword', requires: 'buying a buckler' },
};
const STOCK_EFFECT = { strike: 'makes strikes hit harder', block: 'blocks or absorbs damage', heal: 'heals wounds', junk: 'nothing useful in a fight' };
const OPPONENT_TYPE = { armored: 'armored and slow', agile: 'nimble and hard to hit' };
const OFFER_TYPE = { dive: 'lose the fight on purpose for a reward', bribe: 'pay coins to avoid or fix the fight', bet: 'an honest bet on a fair fight' };
export const READING = {
  tells: {
    questions: row => [{ q: NEUTRAL ? 'Is the enemy winding up for its big attack this turn?' : 'Is the enemy starting its big attack this turn? Answer no for an ordinary attack, for a pause, and for a big attack that it starts and then abandons.', options: YES_NO, truth: yn(row.cls === 'big') }],
    apply: (built, [big]) => withChecklist(built, [`Enemy starting its big attack: ${big}`]),
  },
  notice: {
    questions: row => [{ q: NOTICE_TOPIC[row.stop].forbid, options: YES_NO, truth: yn(row.cls === 'forbid') }, { q: NOTICE_TOPIC[row.stop].mandate, options: YES_NO, truth: yn(row.cls === 'mandate') }],
    apply: (built, [forbid, mandate], row) => withChecklist(built, [`Notice forbids ${NOTICE_TOPIC[row.stop].forbids}: ${forbid}`, `Notice requires ${NOTICE_TOPIC[row.stop].requires}: ${mandate}`]),
  },
  stock: {
    questions: row => row.items.map(([kind, text]) => ({ q: `What does this item on the counter do for a fighter? "${text}"`, options: Object.values(STOCK_EFFECT), truth: STOCK_EFFECT[kind] })),
    apply: (built, effects) => ({ ...built, actions: built.actions.map((a, i) => i < effects.length ? { ...a, detail: a.detail.replace(' Spend 8', ` Effect: ${effects[i]}. Spend 8`) } : a) }),
  },
  inspector: {
    questions: row => [{ q: NEUTRAL ? "Does this person show the guild's seal in red wax?" : "Does this person show a real guild seal made of red wax? Answer no for a seal that is drawn, promised or the wrong colour, and for any other red object.", options: YES_NO, truth: yn(row.cls === 'genuine') }],
    apply: (built, [seal]) => withChecklist(built, [`Shows the guild's red wax seal: ${seal}`]),
  },
  opponent: {
    questions: row => [{ q: 'Which describes this enemy better?', options: Object.values(OPPONENT_TYPE), truth: OPPONENT_TYPE[row.cls] }],
    apply: (built, [type]) => withChecklist(built, [`Enemy type: ${type}`]),
  },
  offer: {
    questions: row => [{ q: 'What is being offered?', options: Object.values(OFFER_TYPE), truth: OFFER_TYPE[row.cls] }],
    apply: (built, [type]) => withChecklist(built, [`Offer type: ${type}`]),
  },
};
