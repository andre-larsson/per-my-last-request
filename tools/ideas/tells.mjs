// What each opponent's move looks like, for the trial experiment. All of these are wordings the rule writer never saw.
// `feint` sentences look like the start of the big attack and are not: they replace a share of the other moves.
export const FEINT_SHARE = 0.2;
export const TELLS = {
  rat: {
    strike: ['The rat darts in and nips at your ankle.', 'The rat gnaws at the toe of your boot.', 'The rat takes a run at your shin, squeaking.', 'The rat hops up and bites at your trouser leg.'],
  },
  boar: {
    smash: [
      "The boar's whole tin body clenches like a spring and its hooves dig two trenches in the dirt.",
      'The boar squeals, lines you up between its ears and begins to thunder forward at full tilt.',
      'Every plate on the boar rattles as it gathers itself for the one move the noticeboard warns applicants about.',
      'The boar trots off to the far rope, wheels round and comes at you gathering speed, tusks levelled.',
      'The boar lowers its snout to the dirt, hindquarters rising, and its furnace-red eyes fix on your midriff.',
    ],
    strike: ['The boar gives you a lazy shove with its snout.', 'The boar clips at your elbow in passing.', 'The boar hooks a tusk at your knee.', 'The boar butts your hip, not very hard.'],
    feint: ['The boar scrapes the ground twice as if to rush you, then sits down and scratches its ear.', 'The boar lowers its head as though to come at you full pelt, sneezes, and settles for a half-hearted poke.'],
  },
  bruiser: {
    smash: [
      'The bruiser winds its whole arm round like a windmill, tongue between its teeth.',
      'The bruiser cracks its knuckles, takes one step back and loads everything it has into one shoulder.',
      'The bruiser drops its right hand almost to the floor and starts it on a long journey toward your chin.',
      "The bruiser shouts 'This one is for the cheap seats!' and puts its whole back into a swing from the hip.",
    ],
    strike: ['The bruiser pokes at your guard with short, bored punches.', 'The bruiser cuffs at your ear with an open hand.', 'The bruiser snaps a left at your nose.', 'The bruiser taps you twice on the ribs to keep you honest.'],
    winded: ['The bruiser is blowing kisses to somebody in the third row.', 'The bruiser has stopped to flex for the crowd.', 'The bruiser strolls round the ring with both arms raised, soaking up applause.'],
    feint: ['The bruiser rears back for a mighty swing, thinks better of it, and adjusts its belt instead.', 'The bruiser cocks its fist behind its head, winks, and lets it drop.'],
  },
  quickfoot: {
    strike: ['Quickfoot skips in and flicks a blade across your knuckles.', 'Quickfoot circles left and stings you on the way past.', 'Quickfoot darts under your arm with a quick stab.', 'Quickfoot bobs at your face and nicks your wrist.'],
    winded: ['Quickfoot stops, hands on knees, gulping air.', 'Quickfoot leans on the rope, panting, one finger raised to ask for a moment.', 'Quickfoot has run out of puff and stands there blowing like a kettle.'],
  },
  champion: {
    strike: ['The champion tries a short, tidy cut at your sleeve.', 'The champion taps your blade aside and jabs.', 'The champion flicks a brisk thrust at your shoulder.', 'The champion steps in with a neat, economical poke.'],
    brace: ['The champion has tucked itself entirely behind its shield.', 'The champion sets its shield edge on the ground and peers over the top.', 'The champion brings its shield up to its chin and waits for you.'],
    smash: [
      "The champion's blade goes up and up until it blocks out the sun, and its knees bend.",
      'The champion draws a long breath, shifts both hands to the very end of the grip and lifts the sword over its shoulder like an executioner.',
      'The champion hoists the greatsword overhead in both fists, and the crowd goes quiet.',
      'The champion swings the sword up behind its back until the point touches the sand, eyes on the top of your head.',
    ],
    winded: ['The champion is doubled over, wheezing.', 'The champion props itself on its sword and pants.', 'The champion pulls off a gauntlet to wipe its brow, chest heaving.'],
    feint: ['The champion lifts its sword overhead, holds it there, then lowers it to check the edge for nicks.', 'The champion raises the greatsword high as if for a finishing blow, yawns, and rests it on one shoulder.'],
  },
};
