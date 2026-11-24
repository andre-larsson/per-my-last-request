// Orders for the nine plans, written by a second author who did not see the first set or the prompt variants.
export const FRESH = {
  warning: {
    guard: {
      terse: 'Quick strike, every turn. Guard only if SMASH is coming. Nothing else.',
      chatty: `Okay so, keep it simple: just poke the enemy with quick strikes, turn after turn. The only time I want you to put your guard up is when it's winding up for a SMASH. Otherwise, poke. Easy, right?`,
      rules: `- Default move in a fight: Quick strike\n- IF the enemy announces a SMASH THEN Guard\n- Never guard at any other time\n- Never use anything else`,
      memo: `To: Hero\nRe: Combat procedure\n\nPlease use light, quick strikes throughout every engagement. The sole exception is when the opponent flags a SMASH: on those turns, and only those, raise your guard. Thank you.`,
    },
    heal: {
      terse: 'Quick strike each turn. SMASH incoming = guard. Potion only when health LOW, not before.',
      chatty: `Alright, fights: just keep doing quick strikes, nothing fancy. If the enemy's about to SMASH you, block it with a guard. And hey, don't waste potions, only drink one once your health actually says LOW. Not a moment sooner, I'm watching your stash.`,
      rules: `1. Fight with quick strikes every turn.\n2. If the enemy is about to SMASH, guard that turn.\n3. If your health is LOW, drink a potion.\n4. Do not drink a potion at any other time.`,
      memo: `Hi hero,\n\nQuick follow-up on supplies. In combat, stick to quick strikes and guard whenever a SMASH is announced. Potions are budgeted: drink one when your health reads LOW and not earlier, please. Regards, Management`,
    },
    heavy: {
      terse: 'Heavy strike every turn. Guard only on SMASH.',
      chatty: `Go big! I want heavy strikes on every single turn, hit them as hard as you can. The one exception is when they're about to SMASH, then guard up and take it on the shield. Otherwise it's heavy hits all day.`,
      rules: `IF fighting: heavy strike\nIF enemy is about to SMASH: guard instead\nNo other moves. Ever.`,
      memo: `Dear Hero,\n\nOur approach to opposition this quarter is maximum force: use your heaviest strike every round. Please make one exception, defending only when a SMASH has been announced. No other deviations. Kind regards.`,
    },
  },
  prize: {
    sword: {
      terse: 'Fights: quick strike, guard vs SMASH, potion when LOW. Fight the bruiser too. Armorer: sharper sword only. No bench. Back at camp, submit right away.',
      chatty: `Hey! In fights, quick strikes mostly, guard if there's a SMASH coming, and a potion if you're getting LOW. Do take the bruiser's prize fight, we want the coins. Spend them on the sharper sword at the armorer, just the sword, nothing else shiny. Skip the bench, no naps. And the moment you're home at camp, hand the assignment in.`,
      rules: `FIGHTS\n- quick strike each turn\n- guard when SMASH is announced\n- potion when health is LOW\nPRIZE: accept the bruiser fight\nARMORER: buy the sharper sword. Buy nothing else.\nBENCH: skip it\nCAMP: submit immediately`,
      memo: `Subject: Assignment checklist\n\nHero, please fight with quick strikes, guarding against any SMASH and drinking a potion at LOW health. Do accept the optional prize bout with the bruiser. At the armorer, requisition the sharper sword only; no other purchases. Do not take breaks on the bench. On returning to camp, submit the assignment without delay.`,
    },
    frugal: {
      terse: 'Bruiser: retreat immediately, no prize fight. Other fights: quick strike, guard on SMASH, potion at LOW. Buy nothing. No bench. Submit at camp asap.',
      chatty: `So I don't love the prize fight, just run away from the bruiser straight off, not worth it. Everyone else: quick strikes, guard when they SMASH, potion if you're LOW. Don't spend any money at the armorer, we're saving. No sitting on the bench either, and when you get back to camp, submit it right then.`,
      rules: `1. Bruiser (prize fight): retreat at once.\n2. All other fights: quick strike; guard on SMASH; potion when LOW.\n3. Armorer: purchase nothing.\n4. Bench: do not rest.\n5. At camp: submit straight away.`,
      memo: `Hero,\n\nPer budget review, decline the optional prize fight; withdraw from the bruiser immediately. In other combat, use quick strikes, guard against a SMASH, and take a potion if health is LOW. No purchases are authorised. No bench time. Submit the assignment as soon as you reach camp.\n\n- Finance`,
    },
    buckler: {
      terse: 'Quick strikes, guard on SMASH, potion at LOW. Take bruiser fight. See medic. Armorer: buckler only. No bench. Submit as soon as at camp.',
      chatty: `Right, standard fighting: quick hits, guard when a SMASH is coming, potion when you're LOW. Yes to the bruiser fight, go get that prize. Stop by the medic too, free healing is free healing. At the armorer grab the buckler and nothing else. Don't rest on the bench, and submit the minute you're back at camp!`,
      rules: `- Fight: quick strike / guard on SMASH / potion if LOW\n- Bruiser: fight it\n- Medic: visit\n- Armorer: buckler, nothing else\n- Bench: never\n- Camp: submit right away`,
      memo: `Re: Your assignment\n\nPlease handle combat with quick strikes, guarding when a SMASH is called and using a potion when health is LOW. Accept the prize fight against the bruiser, and call on the field medic. At the armorer, purchase the buckler only. Skip the bench. Upon return to camp, submit immediately. Thanks!`,
    },
  },
  circuit: {
    careful: {
      terse: 'Quick strikes. Guard when SMASH. Potion if LOW. Skip prize fight, retreat.',
      chatty: `Just play it safe, okay? Quick strikes in fights, put your guard up if the enemy's going to SMASH, and drink a potion when you're LOW. And that optional prize fight? Nope, back out of it.`,
      rules: `IF fight: quick strike\nIF SMASH announced: guard\nIF health LOW: drink potion\nIF optional prize fight: retreat`,
      memo: `Hello Hero,\n\nStandard procedure for fights: light strikes, guard against any SMASH, a potion once health is LOW. The optional prize fight is out of scope this cycle; please retreat from it. Best.`,
    },
    medic: {
      terse: 'Quick strike. Guard on SMASH. Potion when LOW. Retreat from prize fight. Visit the medic.',
      chatty: `Quick strikes in fights please, guard when there's a SMASH on the way, and a potion if you hit LOW health. Don't bother with the optional prize fight, just retreat. Oh, and pop in to see the medic on your way, healing's free!`,
      rules: `1) Fights: quick strike every turn\n2) Guard when the enemy will SMASH\n3) Drink a potion when health is LOW\n4) Prize fight: retreat\n5) Visit the medic`,
      memo: `Dear Hero,\n\nIn combat, please use quick strikes, guard against a SMASH, and drink a potion at LOW health. Decline the optional prize fight by retreating. Also, kindly stop by the field medic for your check-up. Cheers.`,
    },
    sword: {
      terse: 'Quick strike, guard vs SMASH, potion at LOW. Fight the bruiser. Armorer: sharper sword, nothing else.',
      chatty: `Fights: quick strikes, guard up when a SMASH is coming, potion if you're LOW. Sure, take the bruiser's prize fight, go for it. Then at the armorer get the sharper sword. Just that, don't buy anything else.`,
      rules: `* In fights: quick strike\n* Enemy SMASH incoming: guard\n* Health LOW: potion\n* Bruiser prize fight: take it\n* Armorer: sharper sword only`,
      memo: `Hi Hero,\n\nFor fights: quick strikes, guard when a SMASH is flagged, potion when LOW. We do want you to take the prize fight against the bruiser. At the armorer, buy the sharper sword and nothing else. Thanks very much.`,
    },
  },
};
