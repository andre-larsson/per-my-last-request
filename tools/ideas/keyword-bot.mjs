// A rule-based baseline for the idea experiments: keyword lists, regular expressions and small scoring tables.
// No model, no network, no files read at run time. choose() is deterministic and always returns an offered action id.
// The bot is told which idea and which orders version it plays, so each idea's reading of the orders is hard-coded;
// the situation itself arrives only as text, as it does for the LLM.

// ---------- shared text helpers ----------
const norm = text => String(text ?? '')
  .toLowerCase()
  .replace(/[‘’ʼ`]/g, "'")
  .replace(/[“”]/g, '"')
  .replace(/[‒-―]/g, ' - ')
  .replace(/\s+/g, ' ')
  .trim();

/** The text after `label` on the facts line that starts with it, or '' when there is no such line. */
const lineAfter = (facts, label) => {
  const line = String(facts ?? '').split('\n').map(l => l.trim()).find(l => l.toLowerCase().startsWith(label.toLowerCase()));
  return line ? line.slice(label.length).trim() : '';
};

const NEGATOR = /\b(?:no|not|never|none|nothing|nobody|neither|nor|without|hardly|barely|scarcely|cannot|\w+n't|fails? to|failed to|refus\w+ to|declin\w+ to|forg[eo]ts? to|instead of|rather than|short of|far from|too \w+ to|no longer)\b/;
const CLAUSE_BREAKS = [',', ';', ':', '.', '!', '?', ' but ', ' - ', ' yet ', ' though '];
/** The part of `t` before index `i` that belongs to the same clause. */
const clauseBefore = (t, i) => {
  const head = t.slice(0, i);
  let cut = 0;
  for (const b of CLAUSE_BREAKS) { const k = head.lastIndexOf(b); if (k >= 0) cut = Math.max(cut, k + b.length); }
  return head.slice(cut);
};
const lastWords = (s, n) => s.trim().split(/\s+/).filter(Boolean).slice(-n).join(' ');
/** True when a negating word sits within `n` words before index `i`, inside the same clause. */
const negatedAt = (t, i, n = 4) => NEGATOR.test(lastWords(clauseBefore(t, i), n));

/** All matches of weighted rules `[regex, weight]`, in text order. */
const scan = (t, rules) => {
  const hits = [];
  for (const [re, w] of rules) for (const m of t.matchAll(re)) hits.push({ i: m.index, e: m.index + m[0].length, w, s: m[0] });
  return hits.sort((a, b) => a.i - b.i);
};
const any = (t, re) => { re.lastIndex = 0; return re.test(t); };
const pickId = (actions, ...prefs) => {
  const ids = (actions || []).map(a => a.id);
  for (const p of prefs) if (ids.includes(p)) return p;
  return ids[0];
};

// ---------- 1. tells: is the described move the wind-up for the big attack? ----------
const WINDUP = [
  [/\bwind(?:s|ing)?(?:\s+\w+){0,3}\s+up\b|\bwind-?up\b|\bwound up\b/g, 3],
  [/\bhaymaker|\broundhouse|\bsledgehammer|\bpile-?driver|\bknock-?out\b|\bexecutioner|\bwoodcutter|\blumberjack|\bheadsman/g, 3],
  [/\b(?:over|above)\s+(?:its|his|her|the)\s+(?:own\s+)?(?:head|helm|helmet|crest|plume)\b|\boverhead\b|\baloft\b|\bskywards?\b|\bto(?:wards?)? the (?:sky|heavens|rafters|clouds|sun|ceiling)\b/g, 3],
  [/\b(?:both|two)\s+(?:hands|fists|arms)\b|\b(?:two|double)-handed\b/g, 1.5],
  [/\bcharg(?:e|es|ing)\b|\bstampede\w*/g, 3],
  [/\b(?:run|sprint|gallop|dash|rush|bolt|thunder|barrel|hurtle|career)(?:s|es|ing)?\s+(?:straight\s+|right\s+|directly\s+|headlong\s+)?(?:at|towards?|for|into)\s+you\b/g, 3],
  [/\b(?:long|good|proper|full|flying|clear)\s+run(?:-| )?(?:up)?\b|\brun(?:-| )up\b|\brunning start\b/g, 3],
  [/\bpaw(?:s|ing)?\s+(?:at\s+)?the\s+\w+/g, 3],
  [/\bscrap(?:es|ing)\s+(?:a|its|one|the|at)\s+(?:\w+\s+){0,2}(?:hoof|trotter|foot|ground|dirt|sand|floor)\b/g, 2.5],
  [/\bstamp(?:s|ing)?\s+(?:(?:a|its|one|the|at)\s+)?(?:\w+\s+){0,2}(?:hoof|trotter|ground|dirt|sand)\b/g, 2],
  [/\b(?:far|way|right|all the way|well|clear)\s+back\b/g, 2.5],
  [/\bback\s+(?:behind|past|over (?:its|his|her)|as far|beyond|to (?:its|his|her) (?:ear|shoulder|hip))\b/g, 2.5],
  [/\bbehind\s+(?:its|his|her)\s+(?:own\s+)?(?:ear|head|shoulder|back|neck)\b/g, 2.5],
  [/\b(?:fists?|arms?|sword|blade|greatsword|elbow)\b[^.,;]{0,25}\bbehind (?:it|him|her)\b/g, 2],
  [/\b(?:twists?|turns?|winds?|coils?) (?:at|from) the (?:waist|hips?)\b/g, 1],
  [/\bas (?:far|high|hard) as\b/g, 2],
  [/\b(?:tighter|faster|louder|hotter|brighter|redder|shriller)\b/g, 1],
  [/\b(?:whirr?|tick|clank|grind|gear|spring|flywheel|piston|valve|boiler|engine|clockwork|key)\w*\b[^.;]{0,25}\b(?:faster|louder|harder|tighter|to a (?:scream|shriek|howl|whine|roar)|full)\b/g, 2],
  [/\bwinds? (?:its|the|his|her) (?:\w+\s+)?(?:main)?spring\b|\b(?:main)?spring\b[^.;]{0,20}\b(?:tight|tighter|taut|wound)\b|\bwound tight\b|\btaut\b/g, 2],
  [/\bcrouch(?:es|ing)? low\b|\bsinks? (?:low|down|back) on(?:to)? (?:its|his|her) haunches\b|\bhaunches\b|\brising\b|\bmounting\b/g, 1],
  [/\bbackswing\b|\bfrom (?:the|its|his|her) (?:hip|floor|heels|knees|boots)\b/g, 2.5],
  [/\b(?:rock|lean|sway|tilt|arch|bend|rear)(?:s|es|ing)?\s+(?:\w+\s+){0,2}back(?:wards?)?\b(?! (?:foot|leg|hoof|trotter)\b)/g, 1.5],
  [/\bmeasur(?:es|ing)\b[^.,;]{0,20}\b(?:you|your|distance)\b/g, 1],
  [/\bwith (?:all|everything)\b|\ball (?:its|his|her) (?:weight|strength|might|force)\b|\b(?:whole|full|entire) (?:weight|body|strength|might|force)\b|\beverything (?:it|he|she) (?:has|has got|'s got)\b/g, 2.5],
  [/\b(?:mighty|massive|enormous|tremendous|almighty|colossal|crushing|devastating|thunderous|murderous|killing|finishing|terrible|monstrous|gigantic|big|bigger|biggest|huge|great|giant|heavy|heaviest|hardest|full|wide|sweeping|vast|proper)\s+(?:\w+\s+)?(?:blow|swing|punch|hit|strike|attack|cut|chop|stroke|smash|slam|cleave|arc|sweep|downstroke|overhand|right|left|hook|kick|lunge|thrust|slash|swipe|wallop|one)\b/g, 3],
  [/\bsmash\w*|\bslam(?:s|ming)?\b|\bcleav\w+|\bpulveri\w+|\bflatten\w*|\bdemolish\w*|\bobliterat\w+|\bcrush\w*|\bfell(?:s|ing)? a tree\b|\bin (?:half|two)\b|\bnext week\b|\bwallop\w*/g, 2],
  [/\b(?:rais|lift|hoist|haul|swing|bring|draw|pull|cock|rear|wrench|yank|drag|reach|sweep|crank|ratchet|heav)(?:e|es|s|ing)?\s+(?:\w+\s+){0,4}(?:back|backwards?|high|up|upwards?)\b/g, 2],
  [/\b(?:rais|lift|hoist)(?:e|es|s|ing)\s+(?:its|his|her|the|a|that|both)\s+(?:\w+\s+){0,2}(?:greatsword|sword|blade|fists?|arms?|club|hammer|axe|weapon|hoof|hooves|forelegs?)\b/g, 1.5],
  [/\b(?:greatsword|sword|blade|fist|arm)\s+(?:is\s+)?(?:raised|lifted|held high|cocked|drawn back|pulled back|goes up|comes up|rises|rising|climbs|climbing|swings up|goes back|creeps back|creeping back)\b/g, 2],
  [/\b(?:drop|lower|dip|duck|tuck|level|point|angle)(?:s|ping|ing)?\s+(?:its|his|her|both|the)\s+(?:\w+\s+)?(?:head|tusks?|snout|horns?|shoulders?|chin)\b/g, 1.5],
  [/\b(?:head|tusks?|snout)\s+(?:goes\s+|comes\s+)?(?:down|low|lowered|levell?ed)\b/g, 1.5],
  [/\baim(?:s|ing)?\b/g, 1.5],
  [/\b(?:lines?|lining|lined|sights?|sighting|squares?|squaring|squared|levels?|levell?ed|levell?ing|points?|pointing|pointed|fix(?:es|ed)?|locks?|locked|trains?|trained|aimed)\b[^.,;]{0,25}\b(?:you|your)\b/g, 1.5],
  [/\b(?:straight|directly|squarely|dead)\s+at\s+you(?:r)?\b|\bright\s+at\s+you\b/g, 1.5],
  [/\b(?:plant|set|brace|dig|spread|squar|ground)(?:s|es|ing)?\s+(?:its|his|her|in|both)\s+(?:\w+\s+)?(?:feet|hooves|heels|legs|stance|trotters|foot)\b/g, 1],
  [/\bdigs? in\b|\bbraces?\b|\bbracing\b|\bwide stance\b/g, 1],
  [/\b(?:weight|leans?)\s+(?:\w+\s+){0,3}back (?:foot|leg|heel)\b/g, 1.5],
  [/\b(?:gather|coil|tens|bunch|hunch|crouch|load|build|stor|summon|muster|collect)(?:s|es|ing)?\b[^.;]{0,30}\b(?:spring|leap|pounce|launch|charge|strike|blow|swing|rush|lunge|steam|speed|momentum|power|strength|itself|himself|herself|pressure|force|haunches)\b/g, 2],
  [/\bhead of steam\b|\bfull steam\b|\bfull tilt\b|\bfull pelt\b|\bfull speed\b|\btop speed\b|\bflat out\b|\bmomentum\b|\bpressure (?:builds|rises|climbs|mounts)\b/g, 2],
  [/\bcoil(?:s|ed|ing)?\b|\bcocks?\b|\bcocked\b|\brears\b|\brearing\b|\bloads? up\b/g, 1.5],
  [/\babout to\b|\bready(?:ing)? to\b|\breadies\b|\bprepar\w+\b|\bpoised\b|\bgets? set\b|\bbrac\w+ (?:itself|himself|herself)\b|\bset(?:s|ting)? (?:itself|himself|herself)\b|\btelegraph\w*/g, 1],
  [/\bdeep(?:est)? breath\b|\b(?:huge|great|long|big) breath\b|\bfills? (?:its|his|her) (?:lungs|chest)\b/g, 0.75],
  [/\b(?:backs?|backing|reverses?|reversing|retreats?|trots?|walks?|steps?|paces?|draws?|edges?)\s+(?:\w+\s+){0,2}(?:up|off|away|back)\b/g, 0.75],
  [/\b\w+\s+(?:paces|yards|strides|lengths)\b/g, 1],
  [/\bsteam\b/g, 0.5],
  [/\b(?:whistl|hiss|shriek|scream|whin|roar|bellow|snort|howl|squeal)\w*/g, 0.5],
  [/\bglow\w*|\bred-?hot\b|\bwhite-?hot\b/g, 0.5],
  [/\bhigh(?:er)?\b/g, 1],
  [/\b(?:big|biggest|heaviest|hardest|strongest|worst) (?:attack|hit|move)\b|\bfinisher\b|\bsignature (?:move|blow)\b/g, 3],
  [/\b(?:ram|gore|trample|skewer|impale)(?:s|d)?\b|\bramming\b|\bbowl you\b/g, 1.5],
  [/\b(?:no|not an?|far from|nothing like an?) (?:ordinary|routine|usual|everyday|normal)\b|\b(?:harder|bigger|heavier|more) than (?:usual|normal|before|ever)\b|\bmuch harder\b/g, 2.5],
  [/\b(?:mighty|massive|enormous|tremendous|colossal|devastating|murderous|monstrous)\b/g, 0.5],
];
const SMALL = [
  [/\b(?:jab|nip|prod|poke|tap|flick|slap|cuff|swat|shove|push|nudge|bump|butt|peck|pinch|clip|graze|nick|dab|snap|jostle|elbow|trip|kick|pat|rap|swipe|bat|tweak|tickle|nibble|bite|backhand|scuff|cut|prick)(?:s|es|ped|ping|bing|ing)?\b/g, 2],
  [/\b(?:jabbing|nipping|prodding|poking|tapping|slapping|swatting|shoving|nudging|butting|clipping|snapping|patting|rapping|batting)\b/g, 2],
  [/\b(?:short|quick|light|little|small|lazy|routine|ordinary|usual|casual|brisk|tidy|measured|testing|probing|half-?hearted|glancing|plain|simple|modest|mild|gentle|soft|weak|feeble|perfunctory|token|workmanlike|businesslike|polite|cursory|careless|offhand|bored|tentative|cautious|exploratory|standard|everyday|regular|normal|basic|textbook|economical|neat|dull|unremarkable|familiar|lightly|gently|casually|lazily|idly|half-?heartedly|absent-?mindedly)\b/g, 1.5],
  [/\b(?:tip|flat|butt|rim|edge) of\b|\bback of (?:its|his|her|the|a) (?:hand|fist|glove|gauntlet)\b/g, 3],
  [/\bone (?:tusk|hand|finger|hoof)\b|\bone-handed\b/g, 1],
  [/\b(?:shins?|ankles?|toes?|knees?|boots?|sleeve|elbow)\b/g, 1.5],
  [/\bnothing (?:special|fancy|new|much)\b|\bas usual\b|\bthe usual\b|\bits usual\b/g, 2],
];
const IDLE = [
  [/\bbreath(?:es|ing) (?:hard|heavily)\b|\b(?:catch|get)(?:es|s|ing)? (?:its|his|her) (?:breath|wind)\b|\bout of (?:breath|steam|puff)\b|\bbreather\b/g, 2.5],
  [/\bstands? (?:still|there|idle|about|around|quietly)\b|\bwait(?:s|ing)?\b|\blean(?:s|ing)?\b|\brest(?:s|ing)?\b|\bpaus(?:es|ing)\b|\bpant(?:s|ing)?\b|\bwheez\w*|\bgasp\w*|\bpuff(?:s|ing|ed)?\b|\bwinded\b|\btired\b|\bexhausted\b|\bflagging\b|\bspent\b|\bslump\w*|\bsag(?:s|ging)?\b|\bsways?\b|\bstagger\w*|\bstumbl\w*|\bdazed\b|\bdizzy\b/g, 1.5],
  [/\bturns? (?:its|his|her) back\b|\bturns? away\b|\blooks? (?:away|elsewhere|around)\b|\bdistracted\b|\bignor(?:es|ing) you\b|\bnot looking\b|\bbehind (?:its|his|her|the) shield\b|\bhid(?:es|ing)\b|\bcower\w*|\bkeeps? (?:its|his|her) distance\b|\bout of (?:reach|range)\b|\bcircl(?:es|ing)\b|\bwatch(?:es|ing)\b|\bstar(?:es|ing)\b|\bdo(?:es|ing) nothing\b|\bidl(?:es|ing)\b|\bdither\w*|\bhesitat\w+/g, 1.5],
  [/\bsits?\b|\bsitting\b|\bkneel\w*|\blies down\b|\bwip(?:es|ing)\b|\bpolish\w*|\boil(?:s|ing)\b|\bcools?\b|\bcooling\b|\bvent(?:s|ing)\b|\blets? off\b|\bsputter\w*|\bstall\w*|\bjam(?:s|med)\b|\bseiz(?:es|ed) up\b|\bstuck\b|\brattl\w+|\bsettl\w+|\brivet\b|\bloose\b|\bwinds? down\b|\bruns? down\b|\b(?:fall|keel|toppl)(?:s|es)? over\b|\bready to drop\b/g, 1.5],
  [/\blowers? (?:its|his|her|the) (?:\w+\s+)?(?:sword|greatsword|blade|fists?|arms?|guard|weapon|shield|hands?)\b|\bdrops? (?:its|his|her|the) (?:\w+\s+)?(?:sword|guard|arms|fists|hands)\b|\bsheath\w*|\bbacks? down\b|\bgives? ground\b/g, 2],
  [/\bshield\s+(?:up|high|raised)\b|\b(?:rais|lift|bring|hoist)(?:e|es|s|ing)\s+(?:its|his|her|the)\s+shield\b/g, 2.5],
];
// Harmless business that cancels a wind-up wherever it stands in the sentence.
const STRONG_CANCEL = /\bscratch\w*|\byawn\w*|\bacorns?\b|\brooting\b|\broots? (?:in|around|about|through|for)\b|\b(?:to|at|for|towards?) the (?:crowd|audience|spectators|stands|gallery|judges|benches|onlookers)\b|\b(?:acknowledg|greet|thank|salut|milk|address|applaud)\w*\s+(?:the|its|his|her)\s+(?:crowd|audience|fans|spectators|admirers|public)\b|\bsneez\w*|\bhiccup\w*|\bbelch\w*|\bburp\w*|\bnaps?\b|\bdoz\w+|\basleep\b|\bsnooz\w*|\bsnor(?:es|ing)\b|\bpretend\w*|\bfeint\w*|\bfak(?:e|es|ing)\b|\bbluff\w*|\bmock\w*|\bfor show\b|\bshowboat\w*|\bplay-?act\w*|\bthinks? better\b|\bchanges? (?:its|his|her) mind\b|\bsecond thoughts\b|\bloses? interest\b|\binstead\b(?! of)|\bonly to\b|\bnothing (?:happens|comes)\b|\bharmless\w*/g;
// Harmless business that cancels a wind-up only when it comes after it.
const HARMLESS = /\bwink\w*|\bwav(?:es|ing)\b|\bbows?\b|\bbowing\b|\bsalut\w+|\bsniff\w*|\bsnuffl\w*|\bgraz(?:es|ing)\b|\bmunch\w*|\bchew\w*|\bnibbl\w*|\beats?\b|\beating\b|\bdrinks?\b|\bsips?\b|\bpicks? (?:its|his|her|at)\b|\badjust\w*|\bstraighten\w*|\btightens? (?:a|its|his|her|the) (?:\w+ )?(?:strap|belt|buckle|laces?|bootlaces?|helmet|gloves?|gauntlets?|girth)\b|\bpolish\w*|\bwip(?:es|ing)\b|\bmops?\b|\bpreen\w*|\bpos(?:es|ing)\b|\bflex\w*|\bautograph\w*|\bkiss\w*|\bforg[eo]ts?\b|\bgives? up\b|\blets? (?:it|them|the \w+) (?:drop|fall|sink|hang|go)\b|\blowers? (?:it|them)\b|\bputs? (?:it|them) (?:down|away)\b|\bsets? (?:it|them) down\b|\brests? (?:it|them)\b|\brelax\w*|\bshrug\w*|\bsighs?\b|\bsits?\b|\bsitting\b|\blies down\b|\bwanders?\b|\bambles?\b|\b(?:trots|walks|strolls|waddles) (?:off|away)\b|\bturns? away\b|\blooks? (?:away|elsewhere|bored|around|at (?:its|his|her))\b|\bchecks?\b|\binspects?\b|\badmir\w+|\bties?\b|\blaces?\b|\bstretch\w*|\bdoes nothing\b|\bcoughs?\b|\bblows? (?:its|his|her) nose\b|\bapologi[sz]\w+|\bstops? to\b|\bpauses? to\b|\buses? (?:it|them) to\b|\b(?:a|the|some) (?:fly|wasp|gnat|moth|bee|midge|pigeon|butterfly|pie|sandwich|biscuit|bun|snack|apple|turnip|truffle|handkerchief|hankie|daisy|dandelion|flower|clock|sundial|puddle|trough)\b|\b(?:its|his|her) (?:own )?(?:nose|hair|moustache|armpit|belly|nails|teeth|bootlaces?|shoelaces?|trousers|breeches|belt|plume|collar|cuffs?)\b|\bhitch(?:es)? up\b|\bcracks? (?:its|his|her) knuckles\b/g;
const ATTACK = /\b(?:lunges?|rush(?:es)?|thunders?|barrels?|hurtles?|launch(?:es)?|leaps?|springs?|pounces?|swings?|brings? (?:it|them|the \w+) (?:down|round|around|crashing)|drives?|hurls?|throws?|flings?|strikes?|hits?|attacks?|comes? (?:at|for|on|down|in)|goes? for|makes? for|bears? down|runs?|gallops?|sprints?|storms?|ploughs?|plows?|lets? (?:fly|rip|go with)|unleash\w*|uncoils?|explodes?|erupts?|crash(?:es)?|hammers?|chops?|heaves?|holds? (?:it|them) there)\b/g;
const STRONG_PIVOT = /\b(?:and then|then|but|yet|however|though|although|except)\b/g;

function tellIsBig(tell) {
  const t = norm(tell);
  const live = rules => scan(t, rules).filter(h => !negatedAt(t, h.i));
  const wind = live(WINDUP);
  const small = live(SMALL);
  const idle = live(IDLE);
  const strong = [...t.matchAll(STRONG_CANCEL)].filter(m => !negatedAt(t, m.index));
  const harmless = [...t.matchAll(HARMLESS)].filter(m => !negatedAt(t, m.index));
  const sum = hits => hits.reduce((n, h) => n + h.w, 0);
  if (!wind.length) return false;

  // "Starts to X, then does something harmless": after a turning word the sentence must still be winding up or attacking.
  const pivots = [...t.matchAll(STRONG_PIVOT)];
  if (pivots.length) {
    const cut = pivots[pivots.length - 1].index;
    const windBefore = wind.some(h => h.i < cut);
    if (windBefore) {
      const after = hits => hits.some(h => (h.i ?? h.index) > cut);
      if (after(small) || after(strong) || after(harmless)) return false;
      const tail = t.slice(cut);
      const attacking = wind.some(h => h.i > cut && h.w >= 0.75) || any(tail, ATTACK);
      if (!attacking) return false;
    }
  }
  // Harmless business after the last real wind-up signal cancels it.
  const lastWind = Math.max(...wind.filter(h => h.w >= 1).map(h => h.i), -1);
  if (lastWind >= 0 && harmless.some(m => m.index > lastWind)) return false;

  const score = sum(wind) - sum(small) - sum(idle) - 4 * strong.length;
  return score >= 1;
}

function chooseTells(facts, actions) {
  const tell = lineAfter(facts, "Enemy's move this turn:") || facts;
  return tellIsBig(tell) ? pickId(actions, 'guard', 'quick') : pickId(actions, 'quick');
}

// ---------- 2. notice: does today's notice forbid or require the action at this stop? ----------
const AVOID_GENERAL = String.raw`walk(?:s|ing|ed)? (?:straight |right |directly )?(?:past|on|by|around)|pass(?:es|ing|ed)?(?: by| on)?|keep(?:s|ing)? (?:on )?(?:walking|moving|going|off|away|out|clear)|stay(?:s|ing)? (?:off|away|out|clear)|steer(?:s|ing)? clear|mov(?:e|es|ing) (?:on|along|past)|carry(?:ing)? (?:straight )?on|carries on|press(?:es|ing)? on|continu(?:e|es|ing)|proceed(?:s|ing)?|go(?:es|ing)? (?:straight |right )?(?:on|past|by|around|further|farther|any further|without)|skip(?:s|ping|ped)?|avoid(?:s|ing|ed)?|bypass(?:es|ing|ed)?|ignor(?:e|es|ing)|forgo(?:es|ing)?|do(?:ing)? without|wide berth`;
const re = (src, flags = 'g') => new RegExp(String.raw`\b(?:${src})\b`, flags);
const STOPS = {
  bench: {
    strong: /\b(?:bench|benches|seat|seats|sit|sits|sitting|seated)\b/,
    topic: /\b(?:bench|benches|sit|sits|sitting|seat|seats|seated|rest(?! of)|rests|resting|rested|breather|sit-?down|stool|pew)\b/,
    act: re(String.raw`sit(?:s|ting)?(?: down)?|seated|rest(?:s|ing|ed)?(?! of)|us(?:e|es|ing)|occup(?:y|ies|ying)|take (?:a |the )?(?:\w+ )?(?:seat|rest|break|breather|pew)|catch (?:their|your|his|her) breath|stop(?:s|ping)? (?:at|and|for)|paus(?:e|es|ing)|sit-?down|breather`),
    avoid: re(String.raw`${AVOID_GENERAL}|stand(?:s|ing)?|remain(?:s|ing)? (?:standing|upright|on (?:their|your) feet)|on (?:their|your) feet|keep(?:s|ing)? (?:their|your) feet|leave(?:s)? (?:it|the bench)`),
    subject: /\b(?:bench|benches|seat|seats|seating|sitting|resting|rest)\b/,
    indicative: /^(?:sits?|rests?|stops? (?:at|and|for)|takes? a (?:seat|rest|break|breather))\b/,
    indicativeAvoid: /^(?:walks? (?:past|on|by)|keeps? (?:walking|moving|off)|moves? (?:on|along)|carr(?:y|ies) on|pass(?:es)? by|skips?|stands?|stays? (?:off|standing))\b/,
    imperative: /^(?:please |kindly |so |now |then )?(?:sit|rest|take a|use the|stop (?:at|and|for)|pause)\b/,
    imperativeAvoid: /^(?:please |kindly |so |now |then )?(?:walk (?:past|on|by)|keep (?:walking|moving|going|off|away|out|clear)|stay (?:off|away|clear|standing)|move (?:on|along)|carry on|continue|proceed|pass (?:by|on)|go (?:on|past|by|around)|skip|avoid|stand|leave)\b/,
  },
  medic: {
    strong: /\b(?:medic|medics|doctor|physician|surgeon|nurse|healer|infirmary|sawbones)\b/,
    topic: /\b(?:medic|medics|medical|doctor|physician|surgeon|nurse|healer|infirmary|sick ?bay|examin\w*|treat\w*|bandag\w*|check-?ups?|sawbones|apothecary|patch(?:ed)? up|stitch\w*)\b/,
    act: re(String.raw`visit\w*|see|sees|seen|seeing|examin\w*|treat\w*|check(?:ed)?(?: over)?|inspect\w*|report(?:s|ing)? to|call(?:s|ing)? (?:at|on|in)|stop(?:s|ping)? (?:at|in|by|for)|attend\w*|consult\w*|present (?:themselves|yourself)|look(?:ed)? (?:at|over)|patched up|bandag\w*|tended|check-?ups?|go(?:es)? to|us(?:e|es|ing)|approach\w*|troubl\w*|disturb\w*|bother\w*|queu\w*|admit\w*|receiv\w*|tend(?:s|ed|ing)?|car(?:e|es|ing)|attention|serv(?:e|es|ing)|help(?:s|ing)?|heal\w*|dress\w*|nurs\w*|mend\w*|patch\w*|submit\w* to|ask(?:s|ing)?|sign\w*|certificate|clearance|approv\w+|chit|bill of health|medical`),
    avoid: re(String.raw`${AVOID_GENERAL}|untreated|leav(?:e|es|ing) (?:the medic |him |her |them )?(?:alone|in peace|be)|without (?:treatment|stopping|a check)`),
    subject: /\b(?:medic|medics|medical|doctor|physician|surgeon|nurse|healer|infirmary|sick ?bay|treatment|surgery|examinations?|tent|sawbones|apothecary)\b/,
    indicative: /^(?:reports? to|visits?|stops? (?:at|in|by)|go(?:es)? to|calls? (?:at|on|in)|(?:is|are) (?:seen|examined|checked|treated))\b/,
    indicativeAvoid: /^(?:walks? (?:past|on|by)|keeps? (?:walking|moving|out|away)|moves? (?:on|along)|carr(?:y|ies) on|pass(?:es)? by|skips?|stays? (?:out|away))\b/,
    imperative: /^(?:please |kindly |so |now |then )?(?:visit|see the|report to|call (?:at|on|in)|stop (?:at|in|by)|attend|consult|go to|get (?:yourself |yourselves )?(?:examined|checked|treated|seen))\b/,
    imperativeAvoid: /^(?:please |kindly |so |now |then )?(?:walk (?:past|on|by)|keep (?:walking|moving|going|off|away|out|clear)|stay (?:off|away|clear|out)|move (?:on|along)|carry on|continue|proceed|pass (?:by|on)|go (?:on|past|by|around)|skip|avoid|leave)\b/,
  },
  bruiser: {
    strong: /\b(?:bruiser|prize)\b/,
    topic: /\b(?:bruiser|prize|purse|bout|prize-?fight\w*)\b/,
    act: re(String.raw`fight(?:s|ing)?|fought|fac(?:e|es|ing)|box(?:es|ing)?|spar(?:s|ring)?|tak(?:e|es|ing) on|stand (?:and|their|your) (?:fight|ground)|go the distance|enter\w* the ring|step\w* into the ring|accept\w*|see(?:s|ing)? it through|stay\w* in|finish\w*|meet|challeng\w*|bout|compet\w*|contest\w*|go(?:es|ing)? through|trade blows|put up (?:their|your) fists`),
    avoid: re(String.raw`retreat\w*|walk\w* (?:away|off|past|out|on|by)|leav(?:e|es|ing)|withdraw\w*|back(?:s|ing)? (?:out|down|off|away)|declin\w*|refus\w*|forfeit\w*|stand(?:s|ing)? down|step\w* (?:away|out|aside|down)|pull\w* out|turn\w* (?:back|away|tail)|run\w* away|flee\w*|skip\w*|avoid\w*|quit\w*|giv(?:e|es|ing) up|duck\w*|dodg\w*|shirk\w*|bow\w* out|conced\w*|yield\w*|opt\w* out|sit\w* (?:it|this one) out`),
    subject: /\b(?:bruiser|prize|bout|fight|fights|fighting|ring|contest|match)\b/,
    indicative: /^(?:fights?|faces?|go(?:es)? through|stands? and|meets?|takes? on|enters? the ring|steps? into)\b/,
    indicativeAvoid: /^(?:retreats?|withdraws?|leaves?|walks? (?:away|past|on|by)|stands? down|backs? (?:out|off|down)|declines?)\b/,
    imperative: /^(?:please |kindly |so |now |then )?(?:fight|face|stand (?:and|your)|stay in|enter the ring|step into|take on)\b/,
    imperativeAvoid: /^(?:please |kindly |so |now |then )?(?:retreat|leave|withdraw|walk (?:away|off|past|on|by)|back (?:out|down|off|away)|decline|refuse|stand down|step (?:away|out|aside|down)|turn (?:back|away)|skip|avoid)\b/,
  },
  shop: {
    strong: /\b(?:armou?rers?|swords?|bucklers?|shields?|blades?)\b/,
    topic: /\b(?:armou?rers?|sword\w*|buckler\w*|shield\w*|blade\w*|smith\w*|weapon\w*|stock|shop|counter|wares|goods|purchas\w*|buy\w*|sale|sell\w*|sold)\b/,
    act: re(String.raw`buy(?:s|ing)?|bought|purchas\w*|carry(?:ing)?|carries|carried|bear(?:s|ing)?|hold(?:s|ing)?|own(?:s|ing)?|bring(?:s|ing)?|wear(?:s|ing)?|equip\w*|issued|have|has|having|obtain\w*|acquir\w*|get|pick\w* up|take|collect\w*|sell(?:s|ing)?|sale|sold|shop(?:s|ping)?|arm(?:ed)?|kit\w*|bucklers?|shields?|swords?|blades?`),
    avoid: re(String.raw`walk(?:s|ing|ed)? (?:straight |right )?(?:past|on|by)|pass(?:es|ing)? (?:by|on)|keep(?:s|ing)? (?:walking|moving|their coins|your coins|their money|your money)|mov(?:e|es|ing) (?:on|along)|go(?:es|ing)? (?:on |further |any further |past )?without|proceed(?:s|ing)? without|do(?:ing)? without|without (?:a|one|it|buying|stopping)|empty-?handed|buy(?:ing)? nothing|sav(?:e|ing) (?:their|your) coins|refus\w*|declin\w*|skip\w*|avoid\w*|proceed(?:s|ing)?|go(?:es|ing)? (?:on|past|further|any further)|pass(?:es|ing)?`),
    subject: /\b(?:armou?rers?|swords?|bucklers?|shields?|blades?|forge|smithy|shop|stall|counter|weapons?)\b/,
    indicative: /^(?:buys?|carr(?:y|ies)|purchases?|picks? up|collects?)\b/,
    indicativeAvoid: /^(?:walks? (?:past|on|by)|keeps? (?:walking|moving)|moves? (?:on|along)|buys? nothing)\b/,
    imperative: /^(?:please |kindly |so |now |then )?(?:buy|purchase|carry|bring|get|pick up|take|arm yourself|equip)\b/,
    imperativeAvoid: /^(?:please |kindly |so |now |then )?(?:walk (?:past|on|by)|keep (?:walking|moving|your coins)|move (?:on|along)|buy nothing|skip|avoid|leave)\b/,
  },
};
const FLIP = /\b(?:fail\w* to|failure to|without|refus\w+ to|neglect\w* to|declin\w+ to|omit\w* to|instead of|rather than|(?:who|that|which) (?:do|does|did) not|(?:who|that|which) (?:don't|doesn't)|anyone not|those not|found not|caught not)\s*(?:\w+\s+){0,2}$/;
const EXEMPT = /\b(?:need not|needn't|not (?:required|obliged|compulsory|mandatory|necessary|obligatory|expected|forbidden|prohibited|banned|closed|cancelled|canceled|suspended|reserved)|no longer (?:\w+)|(?:do|does|did) not (?:have|need) to|(?:don't|doesn't) (?:have|need) to|no (?:need|obligation|requirement|rule|ban)\b[^.;]{0,20}|optional|voluntary|if (?:they|you) (?:wish|like|please|want|choose)|at (?:their|your) (?:own )?discretion|as (?:they|you) (?:wish|please|like)|free to|welcome to|(?:is|are) (?:allowed|permitted|invited) to)\b/g;
const INFO = /\b(?:should|must|shall|will|are asked to|are advised to|are reminded to|may wish to|need to|please|kindly)\s+(?:please\s+)?(?:note|be aware|remember|bear in mind|know|understand|be advised|take note)\b/g;
const PROHIBIT_ACTIVE = [
  /\b(?:must|shall|may|can|should|will|ought|would|could)\s*(?:not|never)\b(?: to\b)?/g,
  /\b(?:mustn't|shan't|can't|cannot|shouldn't|won't|mayn't)\b/g,
  /\b(?:is|are|were|be) (?:not|never) to\b/g,
  /\bnot to\b/g,
  /(?<!\b(?:who|that|which|anyone|those)\s)\b(?:do not|don't|never)\b/g,
];
const PROHIBIT_QUANT = /\b(?:no|not a single|not one)\s+(?:applicants?|candidates?|entrants?|one|trainees?|challengers?|heroes|hero|hopefuls?|competitors?|contestants?|person|fighters?)\b|\b(?:nobody|no-one)\b/g;
const PROHIBIT_PRED = /\b(?:forbidden|prohibited|banned|barred|disallowed|outlawed|(?:(?:will|shall|can|may|must|would|is|are)\s+)?not (?:be )?(?:allowed|permitted|welcome|acceptable|accepted|an option|on offer|tolerated|entertained|considered|granted|excused|honou?red|recogni[sz]ed|counted)|off[- ]?limits|out of bounds|against (?:the )?(?:rules|regulations|guild law)|an offence|unacceptable)\b/g;
const PENALTY = /\b(?:fined|penalised|penalized|disqualified|turned back|sent back|sent home|punished|docked|ejected|expelled|struck off|thrown out|los(?:e|es) (?:a|their|your|his|her) stamps?|forfeits? (?:a|their|your) stamps?|penalty|on pain of|a fine)\b/g;
const OBLIGE_ACTIVE = [
  /^(?:all |every |each )?(?:applicants?|candidates?|entrants?) to\b/g,
  /\b(?:must|shall|have to|has to|need to|needs to|ought to|should|have got to|had better)\b/g,
  /\b(?:is|are|be) to\b(?! be (?:found|had)\b)/g,
  /\b(?:is|are|be|been|being)\s+(?:hereby\s+)?(?:required|obliged|ordered|instructed|directed|commanded|expected|told|asked|requested|urged|advised|compelled|bound)\s+to\b/g,
  /\b(?:requires?|orders?|instructs?|directs?|commands?|insists?|expects?|demands?|decrees?|asks?|wants?)\s+(?:that\s+)?(?:all\s+|every\s+|each\s+|any\s+)?(?:applicants?|candidates?|entrants?|everyone|you|trainees?|challengers?|heroes|hopefuls?)\b/g,
  /\b(?:applicants?|candidates?|entrants?|everyone|everybody|you|trainees?|challengers?|hopefuls?)\s+(?:will|are going to)\b(?!\s+(?:not|be (?:fined|penali[sz]ed|disqualified|turned|sent|punished|docked|ejected|expelled|struck|thrown|failed|told|informed|notified|pleased|glad|delighted|relieved|sorry)|find|notice|note|have|recall|remember|know))/g,
];
const OBLIGE_PRED = /\b(?:compulsory|mandatory|obligatory|required|requirement|requires?|not optional|is an order|a must|necessary|essential)\b/g;
const STATUS_FORBID = /\b(?:closed|shut|cancell?ed|called off|suspended|postponed|reserved|out of (?:order|service|use|bounds|action|commission)|unavailable|not available|withdrawn|recalled|condemned|quarantin\w*|roped off|cordoned off|fenced off|under (?:repair|quarantine|investigation|inspection|review|guard)|being (?:repaired|mended|fixed|inspected|replaced|cleaned)|broken|collapsed|removed|confiscated|impounded|seized|(?:does not|doesn't|will not|won't|is not|isn't|are not|aren't) (?:see(?:ing)?|treat(?:ing)?|admit(?:ting)?|serv(?:e|ing)|sell(?:ing)?|tak(?:e|ing)|accept(?:ing)?|receiv(?:e|ing)|open|available)|turn(?:s|ing)? (?:all )?(?:applicants|candidates|everyone) away|(?:officials?|auditors?|judges?|staff|inspectors?|masters?|members|officers|stewards|clerks|veterans|champions|committee|guests|dignitaries|seniors|instructors|examiners) only|only\s+(?:\w+\s+){0,2}(?:officials?|auditors?|judges?|staff|inspectors?|masters?|members|officers|stewards|clerks|committee|examiners)|for the (?:exclusive |sole )?use of)\b/g;
const STATUS_EXTRA = {
  bench: /\b(?:wet paint|wet varnish|freshly (?:painted|varnished)|being (?:repainted|varnished|painted)|still wet|not dry|taken away|(?:is|are) (?:missing|occupied|taken|full))\b/g,
  medic: /\b(?:absent|off duty|on (?:leave|strike|holiday)|at lunch|indisposed|unwell|fully booked|(?:is|are) away|(?:is|are) out|called away|not in|no (?:treatment|appointments|patients)|busy)\b/g,
  bruiser: /\b(?:(?:is|are) off|indisposed|unwell|injured|unfit|scratched|void|abandoned|disqualified|no (?:fight|bout|contest))\b/g,
  shop: /\b(?:sold out|out of stock|none left|off sale|not for sale|faulty|defective|unsafe|failed inspection|no (?:sales|swords|blades))\b/g,
};
const REOPEN = /\b(?:re-?open\w*|open(?:ed)? (?:to all|again|as usual|once more)|again open|as (?:usual|normal|ever|before)|back (?:in|on|at|from)|resum\w*|restor\w*|lifted|rescinded|revoked|has been (?:repaired|mended|fixed|replaced|restocked)|business as usual)\b/;
const THIRD_PARTY = /\b(?:officials?|auditors?|judges?|inspectors?|stewards?|spectators?|visitors?|clerks?|masters?|committee members?|members of the public|the public|children|pets|dogs|horses|hawkers|pedlars|bards|minstrels|veterans|graduates|non-applicants|staff|guests)\b/g;
const APPLICANT = /\b(?:applicants?|candidates?|entrants?|everyone|everybody|anyone|all|you|trainees?|challengers?|heroes|hero|hopefuls?|competitors?|contestants?)\b/g;
const SUBORDINATE = /\b(?:before|after|until|unless|when|while|if|because|whenever|once)\b/;

const lastIndexOfRe = (s, rx) => { let k = -1; for (const m of s.matchAll(rx)) k = m.index; return k; };

/** Positive: the notice requires the usual action at this stop. Negative: it forbids it. Zero: it changes nothing here. */
function noticeDirective(stop, noticeText) {
  const cfg = STOPS[stop];
  const whole = norm(noticeText);
  if (!cfg || !cfg.topic.test(whole)) return { score: 0, pos: 0, neg: 0 };
  // A notice that names another stop and not this one is about that other stop.
  const named = Object.keys(STOPS).filter(k => STOPS[k].strong.test(whole));
  if (named.length && !named.includes(stop)) return { score: 0, pos: 0, neg: 0 };
  if (stop === 'bruiser' && /\bchampion/.test(whole) && !cfg.strong.test(whole)) return { score: 0, pos: 0, neg: 0 };

  let pos = 0;
  let neg = 0;
  let status = 0;
  const add = v => { if (v > 0) pos += v; else neg -= v; };
  const sentences = whole.split(/(?<=[.!?;])\s+|:\s+/).map(s => s.replace(/^["'\s]+|["'\s.!?;]+$/g, '')).filter(Boolean);
  for (const s of sentences) {
    // The do / avoid actions in this sentence, in order.
    const acts = [];
    for (const m of s.matchAll(cfg.avoid)) acts.push({ i: m.index, e: m.index + m[0].length, pol: -1 });
    for (const m of s.matchAll(cfg.act)) {
      const a = { i: m.index, e: m.index + m[0].length, pol: 1 };
      if (!acts.some(b => a.i < b.e && b.i < a.e)) acts.push(a);
    }
    acts.sort((a, b) => a.i - b.i);
    for (const a of acts) if (FLIP.test(s.slice(0, a.i))) a.pol *= -1;

    const taken = [];
    const free = (i, e) => !taken.some(([a, b]) => i < b && a < e);
    const claim = (i, e) => taken.push([i, e]);
    let optional = false;
    for (const m of s.matchAll(EXEMPT)) { optional = true; claim(m.index, m.index + m[0].length); }
    for (const m of s.matchAll(INFO)) claim(m.index, m.index + m[0].length);

    const notForApplicants = i => {
      const before = clauseBefore(s, i);
      return lastIndexOfRe(before, THIRD_PARTY) > lastIndexOfRe(before, APPLICANT);
    };
    const firstAfter = (e, words) => {
      let rest = s.slice(e);
      const sub = rest.match(SUBORDINATE);
      if (sub) rest = rest.slice(0, sub.index);
      if (words) rest = rest.split(/\s+/).slice(0, words + 1).join(' ');
      const limit = e + rest.length;
      return acts.find(a => a.i >= e && a.i < limit);
    };
    const firstBefore = i => acts.find(a => a.e <= i);
    const active = (m, sign) => {
      const i = m.index; const e = i + m[0].length;
      if (!free(i, e)) return;
      claim(i, e);
      if (notForApplicants(i)) return;
      // "No swords are to be sold", "Nobody is to leave": a negative subject turns the obligation round.
      if (sign > 0 && /\b(?:no|nobody|no-one|none|neither|nothing)\b/.test(clauseBefore(s, i))) sign = -1;
      const a = firstAfter(e, 9);
      if (a) add(2 * sign * a.pol);
    };

    for (const m of s.matchAll(PROHIBIT_PRED)) {
      const i = m.index; const e = i + m[0].length;
      if (!free(i, e) || negatedAt(s, i, 3)) continue;
      claim(i, e);
      const a = firstAfter(e, 4) || firstBefore(i);
      add(a ? -2 * a.pol : -1.5);
    }
    for (const rx of PROHIBIT_ACTIVE) for (const m of s.matchAll(rx)) active(m, -1);
    for (const m of s.matchAll(PROHIBIT_QUANT)) {
      const i = m.index; const e = i + m[0].length;
      if (!free(i, e)) continue;
      claim(i, e);
      const a = firstAfter(e, 9) || firstBefore(i);
      if (a) add(-2 * a.pol);
    }
    // "No sitting", "No walking away", "No retreat".
    for (const a of acts) {
      const before = s.slice(0, a.i);
      const m = before.match(/\bno(?: more| further)?\s+(?:(?!is\b|are\b|was\b)\w+\s+)?$/);
      if (m && free(m.index, a.i)) { claim(m.index, a.i); add(-2 * a.pol); }
    }
    for (const m of s.matchAll(PENALTY)) {
      const i = m.index; const e = i + m[0].length;
      if (!free(i, e) || negatedAt(s, i, 3)) continue;
      claim(i, e);
      const a = firstBefore(i) || firstAfter(e, 6);
      if (a) add(-2 * a.pol);
    }
    for (const rx of OBLIGE_ACTIVE) for (const m of s.matchAll(rx)) {
      if (/\b(?:not|never|hardly|scarcely|no longer|\w+n't)\b/.test(lastWords(clauseBefore(s, m.index), 2))) { claim(m.index, m.index + m[0].length); continue; }
      active(m, 1);
    }
    for (const m of s.matchAll(OBLIGE_PRED)) {
      const i = m.index; const e = i + m[0].length;
      if (!free(i, e)) continue;
      claim(i, e);
      if (negatedAt(s, i, 3)) continue;
      const a = firstBefore(i) || firstAfter(e, 6);
      if (a) add(2 * a.pol);
      else if (/^(?:compulsory|mandatory|obligatory|not optional)$/.test(m[0])) add(1.5);
    }
    // "Every applicant goes through the prize bruiser": a plain statement used as an order.
    for (const m of s.matchAll(/\b(?:every|each|all)\s+(?:applicants?|candidates?|entrants?)\s+/g)) {
      const rest = s.slice(m.index + m[0].length);
      if (cfg.indicativeAvoid.test(rest)) add(-2);
      else if (cfg.indicative.test(rest)) add(2);
    }
    // Plain status words ("closed") count only when the sentence is about this stop.
    const aboutStop = cfg.subject.test(s) || /^(?:it|they|he|she|this|that|these|those)\b/.test(s) || s.split(/\s+/).length <= 3;
    if (aboutStop && !REOPEN.test(s)) {
      for (const m of [...s.matchAll(STATUS_FORBID), ...s.matchAll(STATUS_EXTRA[stop])]) {
        const i = m.index; const e = i + m[0].length;
        if (!free(i, e) || negatedAt(s, i, 3)) continue;
        if (/^(?:reserved|for the)/.test(m[0]) && /^\s*(?:for\s+)?(?:the\s+)?(?:applicants?|candidates?|entrants?|all|everyone)\b/.test(s.slice(e))) continue;
        status += 1.5;
      }
    }
    if (optional) continue;
    if (cfg.imperativeAvoid.test(s)) add(-2);
    else if (cfg.imperative.test(s)) add(2);
  }
  return { score: pos - neg - Math.min(status, 3), pos, neg, status };
}

function chooseNotice(orders, facts, actions) {
  const ids = actions.map(a => a.id);
  const stop = ids.includes('rest') ? 'bench' : ids.includes('medic') ? 'medic' : ids.some(id => id.startsWith('buy_')) ? 'shop' : ids.includes('retreat') ? 'bruiser' : null;
  const notice = lineAfter(facts, 'Guild notice in force today:').replace(/^"|"$/g, '');
  const { score, pos, neg } = noticeDirective(stop, notice); // pos and neg leave out plain status words ("closed")
  const mandate = score > 0.5;
  const forbid = score < -0.5;
  const a = orders === 'a';
  if (stop === 'bench') return a ? (forbid ? pickId(actions, 'advance') : pickId(actions, 'rest')) : (mandate ? pickId(actions, 'rest') : pickId(actions, 'advance'));
  if (stop === 'medic') return a ? (forbid ? pickId(actions, 'advance') : pickId(actions, 'medic')) : (mandate ? pickId(actions, 'medic') : pickId(actions, 'advance'));
  if (stop === 'bruiser') return a ? (forbid ? pickId(actions, 'retreat') : pickId(actions, 'quick')) : (mandate ? pickId(actions, 'quick') : pickId(actions, 'retreat'));
  if (stop === 'shop') {
    // Shop notices forbid the sword or require the buckler, so a directive that names only the buckler is a requirement.
    const t = norm(notice);
    const buckler = /\b(?:buckler|shield)s?\b/.test(t);
    const sword = /\b(?:swords?|blades?)\b/.test(t);
    const directive = pos > 0.5 || neg > 0.5;
    if (directive && buckler && (pos > 0.5 || !sword)) return pickId(actions, 'buy_buckler', 'advance');
    if (mandate && sword && !buckler) return pickId(actions, 'buy_sword', 'advance');
    if (mandate && /\bpotions?\b/.test(t)) return pickId(actions, 'buy_potion', 'advance');
    if (forbid) return pickId(actions, 'advance');
    return a ? pickId(actions, 'buy_sword', 'advance') : pickId(actions, 'advance');
  }
  return pickId(actions, 'advance');
}

// ---------- 3. stock: which described item makes strikes harder, and which blocks? ----------
// Rules are [regex, weight, isEffect]: an effect that is negated ("cuts no better") wipes the item's score for that kind.
const STRIKE = [
  [/\b(?:hit|strike|cut|bite|land|swing|blow|punch|stab|thrust|slash|chop|hack|slice|sting|wound|hurt|bit)(?:s|es)?\s+(?:\w+\s+){0,3}(?:harder|deeper|heavier|sharper|truer|cleaner|fiercer|stronger|keener|worse|twice)\b/g, 3, true],
  [/\bmore\s+(?:force|power|weight|damage|bite|punch|hurt|pain|heft|sting|harm|edge|blood)\b|\b(?:extra|added|additional|greater|double|doubled|twice the)\s+(?:force|power|weight|damage|bite|punch|heft|sting|harm)\b/g, 3, true],
  [/\bsharpen\w*|\bwhetstone\b|\bwhet(?:s|ted)?\b|\bhon(?:e|es|ed|ing)\b|\bgrind(?:s|ing)?\b|\bground (?:to|onto|into|down)\b|\bkeener\b|\bkeen edge\b|\brazor\w*|\bsharper\b|\bsplits? hairs\b/g, 3, true],
  [/\b(?:every|each|your)\s+(?:strike|blow|hit|swing|cut|stroke|thrust|punch|attack)s?\b/g, 1],
  [/\bheavier\b|\bweighted\b|\bleaded\b|\blonger\b|\bserrated\b|\bbarbed\b|\bspiked\b|\bstudded\b|\btoothed\b|\bjagged\b|\bpoison\w*|\bvenom\w*|\bflaming\b|\bspikes?\b|\bbarbs?\b|\bteeth\b/g, 1.5],
  [/\bdamage\b|\bdeadl\w+|\blethal\b|\bharder\b(?! to)|\bdeeper\b|\bpierc\w+|\bpenetrat\w+|\bpunch(?:es)? through\b|\bcleav\w+|\bdraws? blood\b|\btears\b|\brips\b|\bbite\b|\bbites\b|\bgoes through\b|\bcuts through\b|\bthrough (?:armou?r|plate|mail|bone)\b/g, 2, true],
  [/\bedge\b|\bpommel\b|\bhilt\b|\bblade\b|\bforce\b|\bsharp\b/g, 0.5],
];
STRIKE.push([/\bhits? like\b|\blands? like\b|\bstrikes? like\b|\btwice as (?:hard|deep|much)\b|\b(?:weight|force|power|muscle|strength|heft) (?:behind|to|into|in) (?:your|each|every|a|the)\b|\b(?:strikes?|blows?|hits?|swings?|cuts?|punches) (?:do|does|deal|deals|carry|carries|hurt|hurts)\s+(?:\w+\s+)?(?:more|extra|harder|deeper|twice)\b/g, 3, true]);
STRIKE.push([/\bknuckle\w*|\bnails\b|\bhobnail\w*/g, 1.5]);
const BLOCK = [
  [/\bbucklers?\b|\bshields?\b|\btarge\b|\bpavise\b|\bbracers?\b|\bvambraces?\b|\bhelmet\b|\bhelm\b|\barmou?r\b|\bchain-?mail\b|\bmail\b|\bhauberk\b|\bbreastplate\b|\bcuirass\b|\bgreaves\b|\bpauldrons?\b|\bgorget\b|\bgambeson\b|\bpadding\b|\bplating\b|\bvisor\b|\bcoif\b|\bshin-?guards?\b|\bbrigandine\b/g, 3],
  [/\b(?:shin|knee|elbow|arm|leg|chest|shoulder|neck|head|wrist|forearm|throat|belly|back|thigh)[- ]?(?:plates?|guards?|pads?|pieces?|caps?|cups?|bands?|wraps?|protectors?)\b|\bboiled leather\b|\bhardened leather\b|\bleather (?:jerkin|cap|coat|apron|jack|vest|sleeves?)\b/g, 3],
  [/\bplates?\b|\bgauntlets?\b/g, 1.5],
  [/\bjerkin\b|\bguards?\b|\bapron\b|\bcoat\b|\bvest\b|\bcollar\b|\bcap\b|\bgloves?\b|\bsleeves?\b/g, 1],
  [/\bsoak\w*|\babsorb\w*|\bdeflect\w*|\bblock(?:s|ing)?\b|\bparr(?:y|ies|ying)\b|\bprotect\w*|\bshield(?:s|ing) you\b|\bcushion(?:s|ing)\b|\bdeaden\w*|\bturn(?:s|ing)?\s+(?:\w+\s+){0,3}(?:aside|away)\b|\bward(?:s|ing)? off\b|\bfend(?:s|ing)? off\b|\b(?:stop|turn|catch|halt|foil|meet)(?:s|es|ping|ing)?\s+(?:a|an|the|most|any|every)\s+(?:\w+\s+)?(?:blow|blade|sword|hit|strike|cut|punch|arrow|thrust|club|fist|knock|point|edge|tusk|axe|mace|hammer)\b|\bkeep(?:s|ing)? (?:a|an|the|any|most) (?:\w+\s+)?(?:blow|blade|sword|point|edge|tusk|fist)s? (?:off|out|away|from)\b|\btak(?:e|es|ing) the (?:worst|sting|edge|force|brunt)\b|\bsoften\w*|\bwithstand\w*|\bshrug\w* off\b|\b(?:glanc|bounc|slid|skid|skitter|rattl|clatter)\w+ off\b|\b(?:your|the) (?:guard|parry|defen[cs]e)\b|\b(?:get|hide|duck|shelter|crouch)(?:s|ing)? behind\b|\bless of (?:each|every|a|the) (?:hit|blow|strike)\b|\brid(?:e|es|ing) out\b|\bbetween you and\b|\bless (?:damage|hurt|pain|harm)\b|\bhurts? less\b|\bsafe from\b/g, 3, true],
  [/\b(?:blows?|hits?|strikes?|cuts?|knocks?|impacts?)\s+(?:\w+\s+){0,3}(?:softer|lighter|weaker|duller|less)\b|\b(?:dull|deaden|soften|blunt|muffle|break|slow|spread)s?\s+(?:the|a|an|any|every|each|incoming)\s+(?:\w+\s+)?(?:blows?|hits?|strikes?|impacts?|cuts?|knocks?|punch(?:es)?|thumps?|clouts?|falls?|force|shock|worst)\b/g, 3, true],
  [/\bpadded\b|\bquilted\b|\breinforc\w+|\bthick(?:er)?\b|\bsturd\w+|\btoughen\w*|\bharden\w*|\blined with\b|\blayers? of\b/g, 1.5],
];
const HEAL = [
  [/\btonic\b|\bpotions?\b|\belixir\b|\bdraught\b|\bsalve\b|\bointment\b|\bbalm\b|\bpoultice\b|\bbandages?\b|\bmedicine\b|\bremedy\b|\bcur(?:e|es|ing)\b|\bheal\w*|\bmend(?:s|ing)?\b|\brestor\w+|\brecover\w*|\bcloses?\b|\bknits?\b|\bstitch\w*|\bbruises\b|\bhealth\b|\bsooth\w+|\bherbs?\b|\bherbal\b|\bleech\w*|\bplasters?\b|\bliniment\b|\bcordial\b|\brestorative\b|\bsmelling salts\b|\breviv\w+/g, 2],
];
HEAL.push([/\bwounds?\b|\bpain\b|\bach(?:e|es|ing)\b|\bsore\w*/g, 1.5]);
HEAL.push([/\bvigou?r\b|\btea\b|\bbrew\b|\bbroth\b|\bsoup\b|\bstew\b|\bwillow\b|\bnumb\w*|\bback on your feet\b|\bsecond wind\b|\bbleeding\b|\bstrength back\b|\bpick-me-up\b|\btincture\b|\bsyrup\b|\blozenges?\b|\bpills?\b|\bpowders?\b|\bcompress\b|\bsplint\b|\bphysic\b|\bdressing\b|\blint\b|\bhoney\b/g, 2]);
const JUNK = [
  [/\bdo(?:es)? nothing\b|\bno (?:use|good|help|effect|difference|purpose)\b|\buseless\b|\bworthless\b|\bpointless\b|\bdecorat\w+|\bornament\w*|\bceremonial\b|\bfor show\b|\bfor looks\b|\bpurely\b|\bsouvenir\b|\bkeepsake\b|\bnovelty\b|\breplica\b|\btoy\b|\bcommemorat\w+|\bnot real\b|\bmade of (?:paper|cardboard|pastry|cheese|sugar|marzipan|gingerbread|wax)\b|\bpaper\b|\bcardboard\b|\bnothing (?:else|more|at all)\b|\bmakes no\b|\badds? nothing\b|\bchanges? nothing\b|\ball it does\b|\b(?:only|just|merely) (?:smells|looks|shines|sparkles|rattles|jingles|glitters)\b|\bno (?:sharper|harder|better|stronger|safer)\b/g, 10],
  [/\bit (?:does|will|is|can|has|would|did) ?(?:not|n't)(?=\s*(?:[.!]|$))|\bit (?:doesn't|won't|isn't|can't|wouldn't)(?=\s*(?:[.!]|$))/g, 10],
  [/\bplumes?\b|\bpolish\b|\bribbons?\b|\btassels?\b|\bscabbard\b|\bsheath\b|\bfeathers?\b|\b\w+-shaped\b|\bshaped like\b|\b(?:picture|painting|portrait|drawing|engraving|statue|model|poem|song|book|pamphlet|print) (?:of|about)\b|\b(?:cushion|case|stand|rack|cover|bag|box|hook|peg|label|tag|nameplate|cosy|cozy|cloth|duster|display|hanger)\b[^.]{0,15}\bfor (?:your|the|a)\b/g, 4],
  [/\blucky\b|\bluck\b|\bcharm\b|\btrinket\b|\bbauble\b|\binitials\b|\bmonogram\w*|\bengrav\w+|\btooled\b|\bembroider\w+|\bbadge\b|\bbrooch\b|\bcertificate\b|\bwhistle\b|\bsupposedly\b|\ballegedly\b|\bsaid to\b|\bclaims?\b|\bconcedes\b|\badmits\b/g, 2],
  [/\bshin(?:e|es|y)\b|\bgleam\w*|\bsparkl\w+|\bhandsome\w*|\bsmart\b|\bdashing\b|\bfashion\w*|\bstylish\b|\bpretty\b|\bbeautiful\w*|\belegant\b|\bgilded\b|\bgilt\b|\blooks?\b|\bcolou?rs\b|\bmotto\b|\bembossed\b|\benamell?ed\b|\bgold leaf\b/g, 1],
];
const NEGATED_AFTER = /^\s*(?:\w+\s+){0,1}(?:no|nothing|not|none|neither|any)\b/;
const USELESS_STRIKE = /\b(?:not|n't|never|no|nothing|hardly|barely)\s+(?:(?!but\b)\w+\s+){0,4}(?:cut|hit|hurt|harm|strike|sharpen|bite|pierce|dent|damage|improve|add|sharper|harder|deeper)\w*/;
const USELESS_BLOCK = /\b(?:not|n't|never|no|nothing|hardly|barely)\s+(?:(?!but\b)\w+\s+){0,4}(?:stop|block|protect|save|turn|deflect|absorb|soak|withstand|keep|survive|shield|guard)\w*/;

function kindScore(t, rules, uselessRe) {
  let score = 0;
  for (const h of scan(t, rules.map(([rx, w, eff]) => [rx, eff ? w + 1000 : w]))) {
    const effect = h.w >= 1000;
    const w = effect ? h.w - 1000 : h.w;
    if (effect && (negatedAt(t, h.i, 6) || /\bany\s+(?:\w+\s+)?$/.test(t.slice(0, h.i)) || /^any\b/.test(h.s) || NEGATED_AFTER.test(t.slice(h.e)))) { score = 0; continue; }
    score += w;
  }
  // "It would not stop a thrown bun": a negated verb of this kind with no later effect wipes the nouns before it.
  const m = uselessRe && t.match(uselessRe);
  if (m) {
    const later = scan(t, rules.filter(r => r[2])).some(h => h.i > m.index + m[0].length && !negatedAt(t, h.i, 6));
    if (!later) score = 0;
  }
  return score;
}

function itemScores(detail) {
  const t = norm(detail).replace(/\s*spend \d+ of \d+ coins\..*$/, '').trim();
  const junk = scan(t, JUNK).reduce((n, h) => n + h.w, 0);
  return {
    strike: kindScore(t, STRIKE, USELESS_STRIKE) - junk,
    block: kindScore(t, BLOCK, USELESS_BLOCK) - junk,
    heal: kindScore(t, HEAL, null),
  };
}

function chooseStock(orders, facts, actions) {
  const want = orders === 'a' ? 'strike' : 'block';
  let best = null;
  for (const action of actions) {
    if (!/^item_/.test(action.id)) continue;
    const s = itemScores(action.detail);
    const rivals = Math.max(...Object.entries(s).filter(([k]) => k !== want).map(([, v]) => v), 0);
    const margin = s[want] - rivals;
    if (s[want] >= 1.5 && margin > 0 && (!best || margin > best.margin)) best = { id: action.id, margin };
  }
  return best ? best.id : pickId(actions, 'advance');
}

// ---------- 4. inspector: is the guild's red wax seal actually shown? ----------
const RED = String.raw`red|scarlet|crimson`;
const OTHER_COLOURS = String.raw`blue|green|black|yellow|purple|white|brown|orange|pink|grey|gray|gold|golden|silver|violet|plain|colourless|colorless|clear|maroon|lilac|turquoise|ochre|mustard|tan|cream|ivory|amber`;
const RED_WAX = new RegExp(String.raw`\b(?:${RED})\s+(?:sealing[- ]?)?wax\b|\bwax\b[^.!?]{0,25}\b(?:${RED})\b|\b(?:${RED})\b[^.!?]{0,14}\bwax\b`);
const WRONG_COLOUR = new RegExp(String.raw`\b(?:${OTHER_COLOURS})\s+(?:sealing[- ]?)?(?:wax|seal)\b|\bwax\b\s*(?:is|was|looks|seems|,)?\s*(?:more\s+|rather\s+|distinctly\s+|a\s+)?(?:${OTHER_COLOURS})\b|\bseal\b[^.!?]{0,12}\bin\s+(?:${OTHER_COLOURS})\b|\b(?:not|isn't|never|no longer|more \w+ than|rather than|instead of)\s+(?:\w+\s+)?(?:${RED})\b`);
// The seal has to be the guild's: "the guild's red wax seal", "seal of the guild", "official seal", not just a guild coat nearby.
const GUILD_SEAL = /\bguild(?:'s)?\s+(?:\w+\s+){0,3}seal\b|\bseal(?:ed|s)?\b[^.!?]{0,30}\b(?:of|from|with|by|bearing|showing|carrying)\s+(?:the\s+|your\s+|our\s+)?guild(?:'s)?\b|\bofficial\s+(?:\w+\s+){0,2}seal\b|\bguild's\b[^.!?]{0,45}\b(?:seal\w*|wax)\b|\b(?:seal\w*|wax)\b[^.!?]{0,45}\bguild's\b/;
const OTHER_GUILD = /\b(?:another|other|different|rival|wrong|some|a|any|neighbou?ring|foreign|unknown|made-up|imaginary)\s+guild\b|\bguild of\b|\b(?:bakers?|butchers?|fishmongers?|cheesemongers?|ironmongers?|brewers?|tailors?|weavers?|masons?|cobblers?|chandlers?|vintners?|coopers?|tanners?|drapers?|grocers?|plumbers?|thieves|beggars?|candlemakers?|cheesemakers?|bards?|minstrels?|barbers?|carpenters?|glovers?|hatters?|millers?|potters?|farmers?|shepherds?|merchants?|moneylenders?|rat-?catchers?|gravediggers?|wizards?|alchemists?|bakery|laundry|launderers?|pie-?makers?|brewery|tavern|inn|bank|post office|library|school|church|temple|circus|theatre|dairy|fishmarket|market)(?:'s|s')?\s+(?:guild|seal)\b|\bnot (?:the|your|our|this) guild|\bno guild\b|\b(?:his|her|their|its|my) own (?:\w+ )?seal\b|\b(?:family|personal|private|household) seal\b|\bnever heard of\b|\b(?:do not|don't|cannot|can't) recogni[sz]e\b|\bunfamiliar\b|\bnot one you know\b/;
const WRONG_SEAL = /\b(?:candle|crayon|cheese|bottle|jar|apple|lipstick|jam|paint(?:ed)?|(?:red|in) ink(?!-)|chalk|drawing|drawn (?:on|in|with)|sketch\w*|picture|painting|sticker|potato|carved|home-?made|toy|copy|copied|forg\w+|fake\w*|counterfeit\w*|false|sham|imitation|blank|blob|lump|thumbprint|unmarked|scribbl\w+|doodl\w+|stolen|borrowed|tomato|cherry|beetroot|sauce|wine|blood|empty|hole)\b/;
const UNSURE = /\b(?:suppos\w+|so-called|alleged\w*|purported\w*|what (?:he|she|they) calls?|passes for|meant to be|apparently|whether|might be|may be|could be|perhaps|possibly|looks (?:a bit |rather |something )?like|something like|resembl\w+|similar to|a sort of|kind of|as good as|somewhere)\b/;
const SEAL_ABSENT = /\bseal\b[^.!?]{0,40}\b(?:missing|absent|gone|nowhere|not there|at home|in (?:his|her|their) other|tomorrow|later|in the post|on its way|lost|forgot\w*|left (?:it|behind)|fell off|has fallen off|broken off|peeled off|should be|ought to be|used to be|would be)\b|\b(?:lost|forgot\w*|mislaid|left)\b[^.!?]{0,25}\bseal\b|\btoo (?:quick|fast|brief|far|dark|small)\w*\b|\bbefore you can (?:see|read|look)|\b(?:covers?|covering|hides?|hiding|hidden|conceal\w*|thumb over)\b|\bwon't let you (?:see|look)|\bglimpse\b/;
const SEAL_BUT = /\b(?:but|though|although|except|however|only)\b[^.!?]*\b(?:seal|wax|crest|mark|emblem|impression|design|stamp|guild|it is|it's|it has|this one)\b[^.!?]*\b(?:not|n't|no|wrong|different|another|other|own|blank|missing|fake|forg\w+|false|strange|unfamiliar|unknown|never|rival|upside)\b/;
const SHOW_VERB = /\b(?:hold(?:s|ing)? (?:up|out)|show(?:s|ing)?|present(?:s|ing)?|produc(?:es|ing)|display(?:s|ing)?|tap(?:s|ping)?|bear(?:s|ing)|carr(?:ies|ying)|unfold(?:s|ing)?|unroll(?:s|ing)?|open(?:s|ing)?|hands? you|offer(?:s|ing)?|point(?:s|ing)? (?:to|at)|lift(?:s|ing)?|rais(?:es|ing)|thrust(?:s|ing)?|wears?|wearing|hangs?|hanging|dangl\w+|pinned|clipped|stamped|closed with|fastened with|sealed with|turns? (?:it|the \w+) (?:over|round|around|towards? you))\b/;
const CLAIM_VERB = /\b(?:says?|said|claims?|claiming|insists?|swears?|promises?|assures you|tells you|announces|declares|explains|maintains|mutters|mentions|shouts|whispers|calls? it|calling it)\b/g;
// Direct speech in single or double quotes; an apostrophe inside a word ("guild's") does not close it.
const SPEECH = /"[^"]*"|(?<![a-z])'(?:[^']|'(?=[a-z]))*'/g;

function sealIsShown(scene) {
  const t = norm(scene);
  if (!/\bseal(?:s|ed|ing)?\b/.test(t) || !/\bwax\b/.test(t)) return false;
  if (!RED_WAX.test(t) || !GUILD_SEAL.test(t)) return false;
  if (WRONG_COLOUR.test(t) || OTHER_GUILD.test(t)) return false;
  // What is only said out loud is a claim, not a seal shown: the narration has to show it too, or a showing verb must go with the speech.
  const narration = t.replace(SPEECH, m => ' '.repeat(m.length));
  const narrated = /\bseal(?:s|ed|ing)?\b/.test(narration) && RED_WAX.test(narration);
  if (!narrated && !SHOW_VERB.test(narration)) return false;
  for (const s of t.split(/(?<=[.!?])\s+/)) {
    if (!/\b(?:seal\w*|wax)\b/.test(s)) continue;
    if (WRONG_SEAL.test(s) || UNSURE.test(s) || SEAL_ABSENT.test(s) || SEAL_BUT.test(s)) return false;
    for (const m of s.matchAll(/\b(?:seal(?:s|ed)?|wax|guild's)\b/g)) if (negatedAt(s, m.index, 5)) return false;
    // "says it is the guild's seal": a claim, unless something is shown between the saying and the seal.
    for (const m of s.matchAll(CLAIM_VERB)) {
      const rest = s.slice(m.index + m[0].length);
      const seal = rest.search(/\bseal/);
      if (seal >= 0 && seal <= 80 && !SHOW_VERB.test(rest.slice(0, seal))) return false;
    }
  }
  return true;
}

function chooseInspector(facts, actions) {
  const scene = lineAfter(facts, 'On the path:') || facts;
  return sealIsShown(scene) ? pickId(actions, 'show', 'refuse') : pickId(actions, 'refuse');
}

// ---------- 5. opponent: armored or slow (heavy), nimble or hard to hit (quick) ----------
// Rules are [regex, weight, fixed]: a fixed phrase is never turned round by a nearby "not".
const ARMORED = [
  [/\barmou?r\w*|\bplat(?:e|es|ed|ing)\b|\bshell\w*|\bcarapace\b|\bchain-?mail\b|\bmail\b|\brivet\w*|\bcuirass\b|\bbreastplate\b|\bhauberk\b|\bbrigandine\b|\bgambeson\b|\bencased\b|\bclad\b|\bcladding\b|\bcasing\b|\bsuit of\b|\bironclad\b|\btank\b|\bboiler\b|\bbulwark\b|\bfortress\b|\bjuggernaut\b|\bgolem\b|\bstatue\b|\btortoise\b|\bturtle\b|\bsnail\b|\bcrab\b|\blobster\b|\barmadillo\b|\bbeetle\b|\brhino\w*|\bpangolin\b|\boyster\b|\bclam\b|\bbarnacle\w*|\blimpet\b|\bportcullis\b|\bstrongbox\b|\bvault\b|\bgate\w*|\bdrawbridge\b|\brampart\b|\bbastion\b|\btower\b|\bscale\b|\bboiled leather\b|\btin-?opener\b|\bcan-?opener\b|\bcrowbar\b|\bbattering ram\b|\bsiege\b/g, 3],
  [/\biron\b|\bsteel\b|\blead\b|\bleaden\b|\bbrass\b|\bbronze\b|\btin\b|\bcopper\b|\bpewter\b|\bmetal\w*|\bstone\b|\bgranite\b|\bmarble\b|\bbrick\w*|\boak\w*|\btimber\b|\bplank\w*|\banvil\b|\bcauldron\b|\bkettle\b|\bbucket\b|\bbarrel\w*|\bsafe\b|\bdoor\b|\bwall\b|\bwardrobe\b|\bcupboard\b|\bcabinet\b|\bcrate\b|\bcart\b|\bwagon\b|\box\b|\bbull\b|\bhippo\w*|\belephant\b|\bmammoth\b|\bbear\b|\bwalrus\b|\bwhale\b|\bmountain\b|\bboulder\b|\bslab\b|\bfurnace\b|\bstove\b|\bbell\b|\bbathtub\b|\bchimney\b|\bcannon\b|\bleather\b|\bmonument\b|\bmilestone\b|\bbollard\b|\bpillar\b|\bcolumn\b/g, 2],
  [/\bthick\w*|\bheavy\b|\bheavily\b|\bslow\b|\bslowly\b|\bslowest\b|\bslower\b|\blumber\w*|\bplod\w*|\bponderous\w*|\bcumbersome\b|\bclank\w*|\bclang\w*|\bclunk\w*|\bcreak\w*|\btrudg\w*|\bwaddl\w*|\bstomp\w*|\bshuffl\w*|\bcrawl\w*|\bsluggish\w*|\bimmovable\b|\bunhurried\b|\bsolid\b|\bmassive\b|\bhuge\b|\benormous\b|\bvast\b|\bbulk\w*|\bhulk\w*|\bstout\b|\bdense\b|\btons?\b|\btonnes?\b|\brooted\b|\bpatched\b|\bwelded\b|\bbolted\b|\bhammered\b|\bstrapped\b|\bbuckled\b|\bwrapped\b|\bswaddled\b|\bbundled\b|\blayer\w*|\bpadded\b|\bquilted\b|\breinforc\w+|\bhide\b|\bscales\b|\bscaly\b|\bcrust\w*|\bbark\b|\bshield\b|\bhelm\b|\bvisor\b|\bsize of\b|\bloaded\b|\bladen\b|\bgrind(?:s|ing)\b|\brumbl\w+|\bstiff\w*|\brust\w*|\bunstoppable\b|\bbuilt like\b|\bsturdy\b|\btough\b|\bfat\b|\bwide\b|\bbroad\b|\bgirth\b|\bbelly\b|\bblubber\b|\bburly\b|\bstolid\b|\bdeliberate\w*|\bpatient\w*|\bhead to (?:toe|foot)\b|\bchin to (?:ankle|toe)\b|\bevery inch\b|\binch(?:es)? (?:of|thick)\b/g, 2],
  [/\bweigh\w*|\bpans?\b|\bpots?\b|\blids?\b|\bskillet\b|\bgriddle\b|\bsaucepans?\b/g, 1.5],
  [/\bnever hurr\w+|\bin no hurry\b|\btakes? (?:its|his|her) time\b|\b(?:does not|doesn't|barely|hardly|rarely|seldom|never|cannot|can't) (?:move|moves|budge|budges|turn|turns|run|runs|hurry|hurries|rush|rushes)\b|\bhard to (?:move|shift|hurt|dent|budge|knock|harm|crack|break)\b|\bshrugs? off\b|\b(?:bounce|glance|ring|slide|skid|clang|rattle|rebound)s? off\b|\bfeels? nothing\b|\ball day to\b|\ba (?:full )?(?:minute|week|while|age) to\b|\bbefore (?:it|he|she) (?:turns|notices|moves)\b|\blike a (?:loaded|laden)\b|\b(?:nobody|no one|no-one|nothing) (?:has |has ever |ever |can |could )?(?:dent|hurt|mov|shift|budg|scratch|harm|bruis|crack|pierc)\w*|\b(?:has|have) (?:not|never) (?:been )?(?:dent|hurt|mov|shift|budg|scratch|crack|pierc)\w*|\bdent\w*|\b(?:is|was|has been) in no\b|\bnever needed to\b|\bdoes not need to\b|\bdoesn't need to\b/g, 3, true],
  [/\bhelmet\b/g, 0.5],
];
const AGILE = [
  [/\bnimbl\w+|\bagil\w+|\bquick\w*|\bfast\b|\bfaster\b|\bfastest\b|\bswift\w*|\bslipper\w+|\bgreas\w+|\boiled\b|\bbuttered\b|\bsoap\w*|\bdart\w*|\bdodg\w+|\bweav\w+|\bslip(?:s|ping|ped)?\b|\bslither\w*|\belusive\b|\bevasive\b|\bevad\w+|\bwiry\b|\blithe\b|\blimber\b|\bspry\b|\bsprightly\b|\bfleet\w*|\bacrobat\w*|\btumbl\w+|\bjuggler\b|\bdanc\w+|\bduell?ist\b|\bfencer\b|\bblur\w*|\bflicker\w*|\bskat\w+|\bglid\w+|\bskitter\w*|\bwriggl\w+|\bsquirm\w*|\bjink\w*|\b\w+-footed\b/g, 3],
  [/\beel\b|\bferret\b|\bweasel\b|\bstoat\b|\bmink\b|\botter\b|\bhare\b|\brabbit\b|\bcat\b|\bkitten\b|\bfox\b|\bmouse\b|\bshrew\b|\bsquirrel\b|\bmonkey\b|\bwasp\b|\bhornet\b|\ba fly\b|\bhorsefly\b|\bgadfly\b|\bgnat\b|\bflea\b|\bmosquito\b|\bmidge\b|\bsparrow\b|\bhummingbird\b|\bdragonfly\b|\bminnow\b|\btrout\b|\bfish\b|\blizard\b|\bgecko\b|\bsnake\b|\bcricket\b|\bgrasshopper\b|\bfrog\b|\bgreyhound\b|\bwhippet\b|\bmoth\b|\bbat\b|\bbee\b|\bmagpie\b|\bstarling\b|\bnewt\b|\bsprite\b|\bimp\b|\bpixie\b|\bwren\b|\bkestrel\b|\bmayfly\b|\bgoat\b|\bhound\b/g, 3],
  [/\bhard to (?:hit|pin|catch|see|follow|find|touch|track|hold)\b|\bnever (?:once |yet |quite )?(?:been )?(?:where|there|still|in the same|stands still|stops moving|stays|in one place)\b|\balready (?:behind|gone|elsewhere|somewhere|past|moved|beside)\b|\bbehind you\b|\bsomewhere else\b|\belsewhere\b|\btwo places at once\b|\beverywhere at once\b|\bbefore you (?:can|have|see|finish|blink|know)\b|\bby the time\b|\b(?:can't|cannot|couldn't|never|not) (?:land|lay|laid|touch|catch|pin|find)\b|\bout of reach\b|\bjust out of\b|\bwhere (?:you|it|he|she) (?:were|was|are|had been|just was) (?:looking|aiming|standing)?\b|\bkeeps? moving\b|\b(?:won't|will not|does not|doesn't|cannot|can't|never) (?:stand|stay|keep|sit|hold) still\b|\b(?:only|empty|thin) air\b|\b(?:nobody|no one|no-one|nothing) (?:has |has ever |ever |can |could )?(?:touch|hit|caught|catch|laid|lay|land)\w*|\bweighs? (?:nothing|less|next to nothing|no more|about as much as)\b|\blight as\b|\bbarely touch(?:es)? the\b|\b(?:look|looks|feel|feels|seem|seems) (?:slow|heavy|clumsy)\b|\bmakes? (?:you|everyone|the rest)\b[^.]{0,20}\b(?:slow|clumsy|heavy)\b|\b(?:you|your \w+) (?:are|were|is|was|will be) (?:always |ever )?(?:too )?(?:slow|late)\b|\btoo slow to (?:hit|catch|touch)\b|\btoo late\b|\balways (?:a step|a moment|a second|just) (?:ahead|late|behind)\b|\bjust (?:left|vacated)\b|\bwhere (?:it|he|she) (?:was|had been|used to be)\b|\bunarmou?red\b|\bno armou?r\b|\bnot a (?:scrap|stitch|plate) of\b/g, 3, true],
  [/\blight\b|\blightly\b|\btiptoe\w*|\btoes\b|\bbounc\w+|\bsprings? (?:away|aside|back|up|about|out|clear)\b|\bspringy\b|\bspring-heel\w*|\bleap\w*|\bhop(?:s|ping)?\b|\bjump\w*|\bskip\w*|\bcartwheel\w*|\bsomersault\w*|\bspin(?:s|ning)?\b|\btwirl\w*|\bpirouett\w*|\brestless\b|\bfidget\w*|\btwitch\w*|\bjitter\w*|\blean\b|\bthin\b|\bskinny\b|\bscrawny\b|\bbony\b|\bstringy\b|\bsinewy\b|\bspindly\b|\brangy\b|\bslight\b|\bsmall\b|\btiny\b|\blittle\b|\bwisp\w*|\bshadow\w*|\bsmoke\b|\bmist\b|\bghost\w*|\bvanish\w*|\bdisappear\w*|\bgone\b|\bmiss(?:es|ed)?\b|\buntouchable\b|\bsprint\w*|\brunner\b|\bcourier\b|\bmessenger\b|\bpickpocket\b|\bthief\b|\bcutpurse\b|\bbarefoot\b|\bscamper\w*|\bscurr\w+|\bflit\w*|\bzip\w*|\bwhirl\w*|\bblink\w*|\bfeather\w*|\bbreeze\b|\bquicksilver\b|\bmercury\b|\blightning\b|\bflash\w*|\bglimpse\b|\bducks?\b|\bducking\b|\bsidestep\w*|\bslides? (?:away|past|aside|out)\b|\bbob(?:s|bing)?\b|\bboneless\b|\bdouble-jointed\b|\brubber\w*|\belastic\b|\bbendy\b|\btwist\w*|\bnaked\b|\bshirtless\b|\bbare\b/g, 2],
  [/\bruns?\b|\brunning\b|\braces?\b|\bracing\b|\bdash(?:es|ing)?\b|\bbolt(?:s|ing)\b/g, 1.5],
];
const POST_NOT = /^\s*(?:(?:he|she|it|they)\s+)?(?:is|are|was|were)\s+not\b/;

function chooseOpponent(facts, actions) {
  const enemy = lineAfter(facts, 'Enemy:') || facts;
  const m = enemy.match(/^(.*?),\s*\d+ of \d+ health\.\s*(.*)$/);
  const name = norm(m ? m[1] : '');
  const text = norm(m ? m[2] : enemy).replace(/this fight gives a required training stamp\.?/, '').trim();
  let armored = 0;
  let agile = 0;
  const tally = (t, scale) => {
    const side = (rules, own) => {
      for (const [rx, w, fixed] of rules) for (const h of t.matchAll(rx)) {
        const turned = !fixed && (negatedAt(t, h.index, 3) || POST_NOT.test(t.slice(h.index + h[0].length)));
        const v = scale * (turned ? w / 2 : w);
        if ((own === 'armored') !== turned) armored += v; else agile += v;
      }
    };
    side(ARMORED, 'armored');
    side(AGILE, 'agile');
  };
  tally(text, 1);
  tally(name, 0.5); // names can be ironic; the description counts for more
  return armored > agile ? pickId(actions, 'heavy', 'quick') : pickId(actions, 'quick');
}

// ---------- 6. offer: accept an honest bet, decline a dive or a bribe ----------
// "Lose and you owe me six" is a bet's condition; "lose and I'll pay you" is a dive. What follows the losing decides.
const HERO_LOSES = /\b(?:lose|go down|goes down|take (?:a|the) (?:fall|dive|knee)|fall(?: down| over)?|drop|stay down|lie down|hit the (?:floor|canvas|deck|sand|dirt))\b/g;
const REWARD = /\bi(?:'ll| will| can| could|'d| would)? (?:pay|give|split|share|see|make|slip|hand|cut|toss|pass|owe) (?:you|it|the)\b|\byou(?:'ll| will)? (?:get|have|keep|take|receive|walk away with|pocket)\b|\b(?:is|are|'s) yours\b|\bfor you\b|\bworth your while\b|\bin it for you\b|\bhalf\b|\bshare\b|\bsplit\b/;
const COST = /\byou (?:owe|pay|forfeit|hand|give me|cover|buy|stand me|are out|lose)\b|\byou're (?:out|down)\b|\bi (?:keep|take|pocket|collect)\b|\b(?:they're|they are|it's|it is|is|are) mine\b|\bmine\b|\bcosts? you\b|\byou(?:'ll| will)? (?:get|have|keep|take|win) (?:nothing|no\b|none)|^\s*(?:and|,)?\s*(?:you )?(?:pay|owe|forfeit|hand over|cough up)\b/;
const CONDITIONAL_BEFORE = /\b(?:if|should|when|whoever|unless|suppose|in case|whichever|either)\b(?:\s+\w+){0,3}\s*$/;
const BET_CONDITION = /\b(?:if|should|when|whoever|unless|in case|suppose)\b[^.;!?]{0,40}?\b(?:lose|loses|lost|win|wins|go(?:es)? down|fall(?:s)?|drop(?:s)?|beat(?:s|en)?|knock(?:s|ed)?|standing|last)\b|\b(?:the one who|he who|whichever of us|either of us|anyone who|whoever) (?:loses|wins)\b|\b(?:i|you) win\b[^.;!?]{0,30}\b(?:you|i) (?:pay|owe|keep|take|get)\b/g;
const NOTHING_TO_LOSE = /\b(?:nothing|got|much|little|anything|what have you) (?:\w+ )?to lose\b/g;
const DIVE = /\b(?:go|goes|going|stay|stays) down\b|\bstay(?:ing)? (?:on the (?:floor|ground|canvas|mat|sand)|there)\b|\b(?:don't|do not|never) get (?:back )?up\b|\btak(?:e|es|ing) (?:a|the) (?:dive|fall|knee|count|tumble)\b|\bdive\b|\bthrow(?:s|ing)? (?:the|this|it|your)\b|\bthrown\b|\blose (?:to me|on purpose|for me|this one|the fight|the bout|deliberately|quietly|nicely|badly|convincingly|gracefully)\b|(?:^|[.!?:;]\s*|['"]\s*)lose\b|\bon purpose\b|\bdeliberate\w*|\blet(?:s|ting)? (?:me|him|the bruiser) (?:win|have|keep|take)\b|\b(?:lie|lay|fall|drop|flop|keel|tip) (?:down|over)\b|\bpull(?:ing)? (?:your|the|a few) punch\w*|\bgo(?:ing)? easy\b|\beasy on me\b|\bmake it look\b|\blook (?:good|real|convincing)\b|\b(?:split|share|halve|divide)(?:s|ting|ing)? the (?:purse|prize|winnings|takings|money|pot)\b|\bhalf (?:of )?the (?:purse|prize|takings|winnings)\b|\b(?:a|your) (?:cut|share)\b|\b(?:nobody|no one|no-one) (?:need|needs|has to|will|would) (?:ever )?know\b|\b(?:our|little) secret\b|\bquiet word\b|\bkeep (?:it|this) quiet\b|\bmiss (?:me|on|a few|every)\b|\bswing wide\b|\bdrop your guard\b|\bleave your (?:chin|guard)\b|\bstumbl\w+|\btrip (?:over|on)\b|\bslip (?:over|on|up)\b|\bcount of \w+\b|\bmy (?:record|reputation|streak)\b|\bneed (?:this|the) win\b|\bforfeit\b|\bconcede\b|\bsurrender\b|\bgive up\b|\byield\b|\bfold\b|\bthrow in the towel\b|\b(?:don't|do not) (?:hit|swing|try|fight) (?:back|too hard|so hard|hard)\b|\bfight badly\b|\bhold back\b|\barrangement\b|\bworth your while\b|\bsomething in it for you\b|\bin it for you\b|\bgo to sleep\b|\bkiss the (?:canvas|floor|sand|dirt)\b|\bhit the (?:deck|floor|canvas|dirt)\b|\bplay dead\b/g;
const BRIBE = /\blet(?:s|ting)? you (?:walk|pass|past|through|go|by|off|slip|stroll|leave|win|have)\b|\b(?:walk|stroll|step|slip|go|get|wave you|stroll) (?:on |straight |right )?(?:past|by|through|around)\b|\bwithout a (?:scratch|fight|bruise|blow|mark|punch)\b|\bwalk away\b(?! with)|\b(?:turn around|go home|clear off)\b|\b(?:skip|avoid|dodge|spare|save) (?:the|this|us|you|yourself|ourselves)\b|\b(?:no|needn't|need not|don't have to|not have to|no need to|never have to|won't have to) fight\b|\b(?:slip|tip|cross) (?:me|my palm)\b|\b(?:fee|toll|bribe|sweetener|consideration|donation|contribution|gratuity)\b|\bi(?:'ll| will| can| could| might)? (?:just )?(?:go|fall|stay|lie|drop) (?:down|over)\b|\bi(?:'ll| will) (?:lose|take (?:a|the) (?:dive|fall)|throw)\b|\b(?:call|say|write|mark|put) (?:it|you|this) (?:a|down as|as) (?:a )?(?:win|won|victory|draw)\b|\bsay you (?:won|beat)\b|\btell (?:them|the judges|the guild|the clerk|everyone) you\b|\blook the other way\b|\bturn a blind eye\b|\bforget (?:the|this|about|we|i|you)\b|\bbuys? (?:you|your way|me off|my silence|passage|a pass)\b|\bbuy your\b|\bbought\b|\bfor sale\b|\bgrease\b|\bnever (?:needs?|has) to happen\b|\bno questions\b|\b(?:never|didn't|did not) (?:saw|see) you\b|\bsomething for (?:me|my)\b|\bfor my trouble\b|\b(?:step|stand) aside\b|\bout of your way\b|\bpersuaded\b|\bworth my while\b/g;
const WEAK_BRIBE = /\b(?:pay|hand|give|toss|pass) (?:me|him|the bruiser)\b|\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|a few|some) coins?['",.]*(?:\s+\w+){0,4}?['",.]*\s+(?:and|then)\s+['"]?(?:i|we|you)\b|\bfor (?:just |only |a mere )?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|a few) coins?\b|\bprice\b|\bhand over\b/g;
const BET = /\b(?:bet|bets|betting|wager\w*|stak(?:e|es|ed)|double or (?:nothing|quits)|odds|side-?bet|winner|loser|beat me|if you win|you win|fair|fairly|honest\w*|square|against (?:my|mine|yours|your)|match(?:es)? (?:your|my|it)|put (?:up|down)|says? you (?:can't|cannot|won't|don't|will not)|even money|evens|\d+ to \d+|purse against|coin for coin|whoever wins|make it interesting|on the table|(?:takes?|keeps?|gets?) (?:both|all|the lot|the pot|everything|it all)|(?:best|better) (?:fighter|man|woman|one)|fight to win|may the best|pot|kitty|coins? (?:each|apiece)|flutter|gamble|sporting|back yourself|money where your mouth is)\b/g;
const STRONG_BET = /\b(?:bet|bets|betting|wager\w*|stak(?:e|es|ed)|double or (?:nothing|quits)|odds|side-?bet|winner|loser|whoever wins|(?:takes?|keeps?|gets?) (?:both|all|the lot|the pot|everything|it all)|(?:best|better) (?:fighter|man|woman|one)|coins? (?:each|apiece)|flutter|gamble)\b/;

function chooseOffer(facts, actions) {
  const raw = lineAfter(facts, 'Before the bell, an offer is made:') || facts;
  let t = norm(raw);
  let conditions = 0;
  let dives = 0;
  const blank = (i, e) => { t = t.slice(0, i) + ' '.repeat(e - i) + t.slice(e); };
  for (const m of [...t.matchAll(NOTHING_TO_LOSE)]) blank(m.index, m.index + m[0].length);
  for (const m of [...t.matchAll(HERO_LOSES)]) {
    const i = m.index; const e = i + m[0].length;
    if (!t.slice(i, e).trim()) continue;
    if (negatedAt(t, i, 3)) { blank(i, e); continue; }
    let after = t.slice(e).split(/[.!?;]/)[0];
    const stop = after.search(/\b(?:but|if|win|wins|beat|beats)\b/);
    if (stop >= 0) after = after.slice(0, stop);
    after = after.slice(0, 90);
    const cost = COST.test(after);
    if (REWARD.test(after) && !cost) { dives += 1; continue; }
    if (cost || CONDITIONAL_BEFORE.test(t.slice(0, i))) { conditions += 1; blank(i, e); }
  }
  for (const m of [...t.matchAll(BET_CONDITION)]) { conditions += 1; blank(m.index, m.index + m[0].length); }
  const live = rx => [...t.matchAll(rx)].filter(m => !negatedAt(t, m.index, 3));
  const crooked = dives + live(DIVE).length + live(BRIBE).length;
  const bet = live(BET).length + conditions;
  const strongBet = conditions > 0 || STRONG_BET.test(t);
  const weak = strongBet ? 0 : live(WEAK_BRIBE).length;
  if (crooked + weak > 0) return pickId(actions, 'decline');
  return bet > 0 ? pickId(actions, 'accept', 'decline') : pickId(actions, 'decline');
}

/** Returns the id of one of `actions` for this idea, orders version ('a' or 'b') and situation text. */
export function choose(idea, ordersKey, facts, actions) {
  const list = Array.isArray(actions) ? actions : [];
  if (!list.length) return undefined;
  let id;
  try {
    if (idea === 'tells') id = chooseTells(facts, list);
    else if (idea === 'notice') id = chooseNotice(ordersKey, facts, list);
    else if (idea === 'stock') id = chooseStock(ordersKey, facts, list);
    else if (idea === 'inspector') id = chooseInspector(facts, list);
    else if (idea === 'opponent') id = chooseOpponent(facts, list);
    else if (idea === 'offer') id = chooseOffer(facts, list);
  } catch { id = undefined; }
  return list.some(a => a.id === id) ? id : list[0].id;
}

// Exposed for the scratch check only.
export const _internals = { tellIsBig, noticeDirective, itemScores, sealIsShown };
