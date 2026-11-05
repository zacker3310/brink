// The heads of government and how they feel. Every leader here is invented: no real head of state
// by name or likeness. A power's leader is `NATION_LEADERS[id]`, else its government's
// `GOVERNMENT_LEADERS` entry. Every number is an integer; a change is a ruleset change.

import type { AgendaId, GovernmentId, LeaderId, MemoryKind, NationId, Stance, Temperament } from '@brink/contracts';

/** What makes a leader speak. Greetings go by stance; the rest answer a deal or an event. */
export type LineTrigger =
  | Stance
  | 'accept'
  | 'reject_mood'
  | 'reject_terms'
  | 'reject_strength'
  | 'took_city'
  | 'betrayed'
  | 'winning'
  | 'war'
  | 'peace'
  | 'deal'
  | 'demand'
  | 'defied'
  | 'paid';

export interface LeaderDef {
  id: LeaderId;
  name: string;
  /** Office, shown before the name. */
  title: string;
  temperament: Temperament;
  agenda: AgendaId;
  /** One line of who they are. */
  bio: string;
  /** What they say. `{you}` is the listener's nation. Every trigger has at least one line. */
  lines: Record<LineTrigger, readonly string[]>;
}

const L = (d: LeaderDef): LeaderDef => d;

export const LEADERS: Record<LeaderId, LeaderDef> = {
  usa_wainwright: L({
    id: 'usa_wainwright',
    name: 'Caleb Wainwright',
    title: 'President',
    temperament: 'opportunist',
    agenda: 'commerce',
    bio: 'Former shipping-line executive who treats every alliance as a contract with an exit clause.',
    lines: {
      hostile: ['We are done talking, {you}. The fleet will do it for us.', 'I have nothing to say to {you} that a carrier group cannot say better.'],
      wary: ['Make it quick, {you}. My patience costs more than you think.', 'I am listening. That is not the same as agreeing.'],
      neutral: ['Everything has a price, {you}. Let us find yours.', 'The sea lanes are open. For now.'],
      cordial: ['Good to hear from {you}. Business is better when nobody is shooting.', 'Our ports are open to {you}. Do not make me regret it.'],
      friendly: ['{you}! The best partner on the Pacific. What do you need?', 'Whatever {you} need, we can make it work.'],
      accept: ['Done. Have your people call my people.', 'A fair deal. I like fair deals; they last.'],
      reject_mood: ['After what {you} did? Not a chance.', 'Trust is a currency, {you}, and you are overdrawn.'],
      reject_terms: ['Those numbers do not work for me. Try again.', 'You want a lot for very little, {you}.'],
      reject_strength: ['Threats? From {you}? We will take our chances.', 'Nobody dictates terms to Washington.'],
      took_city: ['{you} took one of ours. Markets do not forget, and neither do I.', 'You will pay for that city, {you}, one way or another.'],
      betrayed: ['A deal is a deal, {you}. You just showed the world what yours are worth.', 'You broke your word. Nobody will sign with {you} again.'],
      winning: ['{you} are getting too big. Big is bad for business.', 'Every nation on this ocean is watching {you} now. So am I.'],
      war: ['So be it, {you}. Wars end; balance sheets remember.', 'You chose this, {you}.'],
      peace: ['Peace. Finally, something that pays.', 'Good. Now we can get back to trade.'],
      deal: ['Signed. A good day for both of us.', 'Pleasure doing business, {you}.'],
      demand: ['Pay up, {you}, or we cut you off from the sea.'],
      defied: ['You ignored us, {you}. That was a costly mistake.'],
      paid: ['Fine. Take it. This is not over.'],
    },
  }),
  china_gao: L({
    id: 'china_gao',
    name: 'Gao Yiran',
    title: 'Premier',
    temperament: 'hawk',
    agenda: 'homeland',
    bio: 'A planner from the coastal provinces who counts the century in rivers retaken.',
    lines: {
      hostile: ['History will judge {you}. So will we.', 'Every grievance is recorded, {you}. Every one.'],
      wary: ['We hear {you}. We have heard such words before.', 'Speak carefully. We remember everything.'],
      neutral: ['Our patience is long, {you}. Do not mistake it for weakness.', 'The river flows on. What do you want?'],
      cordial: ['There is room for both of us in this sea, {you}.', 'Our friendship can grow, if {you} respect our ground.'],
      friendly: ['Old friend. What brings {you} to Beijing?', 'Between us, {you}, there need be no secrets.'],
      accept: ['Agreed. Let it be written down.', 'This serves us both. We accept.'],
      reject_mood: ['You ask for trust you have not earned, {you}.', 'Not while our grievances stand.'],
      reject_terms: ['The terms insult us. Again.', 'We do not trade at a loss.'],
      reject_strength: ['We have outlasted empires, {you}. We will outlast you.', 'Threaten someone smaller.'],
      took_city: ['{you} hold what is ours. We will take it back.', 'That city is ours, {you}. It will be ours again.'],
      betrayed: ['{you} lied to us. We will not forget this for a generation.', 'Your word is worthless, {you}.'],
      winning: ['No one power should rule this ocean, {you}. Not even you.', 'Your shadow grows long, {you}. It will be cut.'],
      war: ['Then let it be decided on the field, {you}.', 'We did not seek this. We will finish it.'],
      peace: ['Peace, for now. The river is patient.', 'Let the guns cool.'],
      deal: ['It is signed. Do not break it.', 'A sound arrangement.'],
      demand: ['Pay what is owed, {you}, or we will collect it.'],
      defied: ['{you} defied us. The answer will come in steel.'],
      paid: ['Take it. We will remember who asked.'],
    },
  }),
  japan_tsujimoto: L({
    id: 'japan_tsujimoto',
    name: 'Haruka Tsujimoto',
    title: 'Prime Minister',
    temperament: 'dove',
    agenda: 'honour',
    bio: 'A former judge who believes a treaty kept is worth more than a fleet.',
    lines: {
      hostile: ['I had hoped for better from {you}. I no longer do.', 'There is nothing honourable left to discuss, {you}.'],
      wary: ['We will listen, {you}. Carefully.', 'Your words will be weighed against your deeds.'],
      neutral: ['Welcome, {you}. Let us speak plainly.', 'We prefer agreements to wars. Do you?'],
      cordial: ['It is good to see {you}. Our door is open.', 'We value the trust between us, {you}.'],
      friendly: ['{you} are a true friend to Tokyo.', 'Whatever comes, {you}, we stand with you.'],
      accept: ['We accept, and we will keep our word.', 'Agreed. May it hold.'],
      reject_mood: ['Trust broken is slow to mend, {you}.', 'Not yet. Show us your word is good.'],
      reject_terms: ['We cannot accept these terms.', 'That is not a fair bargain, {you}.'],
      reject_strength: ['We will not bow to threats, {you}.', 'Pressure will not move us.'],
      took_city: ['{you} took our city. We grieve, and we remember.', 'Our people will not forgive this easily, {you}.'],
      betrayed: ['{you} broke a solemn promise. Shame on you.', 'An oath broken is a wound that does not close.'],
      winning: ['{you} grow strong. We hope you will also be just.', 'Power without restraint frightens us, {you}.'],
      war: ['We did not want this war, {you}.', 'With regret, we will defend ourselves.'],
      peace: ['Peace. Thank you, {you}.', 'Let this peace last longer than the last.'],
      deal: ['Signed, and we will honour it.', 'An agreement between honest nations.'],
      demand: ['We must ask {you} for compensation. Please do not refuse.'],
      defied: ['You ignored a fair request, {you}. We are disappointed.'],
      paid: ['We pay to keep the peace. Remember that.'],
    },
  }),
  russia_severin: L({
    id: 'russia_severin',
    name: 'Oleg Severin',
    title: 'President',
    temperament: 'hawk',
    agenda: 'strength',
    bio: 'A former submarine captain who respects only what can sink him.',
    lines: {
      hostile: ['Talk is cheap, {you}. Shells are not, and we have plenty.', 'You bore me, {you}.'],
      wary: ['Say what you came to say, {you}.', 'Interesting. Go on. Briefly.'],
      neutral: ['Strength recognises strength, {you}. Show me yours.', 'Vladivostok is listening.'],
      cordial: ['{you}. You are more serious than I expected.', 'We may yet do business, {you}.'],
      friendly: ['My friend! The vodka is cold and the guns are warm.', '{you} and I understand each other.'],
      accept: ['Good. We have a deal.', 'Agreed. Do not make me regret it.'],
      reject_mood: ['I do not deal with {you}. Not now.', 'You have not earned a seat at my table.'],
      reject_terms: ['You take me for a fool, {you}?', 'No. Bring a better offer.'],
      reject_strength: ['You threaten me? Come and try, {you}.', 'Ultimatums from the weak amuse me.'],
      took_city: ['You took a city of mine, {you}. I will take two.', 'Enjoy it while you can, {you}.'],
      betrayed: ['A knife in the back, {you}? I will remember whose hand held it.', 'Treachery. Fine. Now we play by my rules.'],
      winning: ['{you} are strong. Strong enough to be a target.', 'Everyone is ganging up on the winner, {you}. Including me.'],
      war: ['Finally. Let us see what {you} are made of.', 'You wanted war, {you}. You have it.'],
      peace: ['Peace. For now.', 'We stop. Not because we must.'],
      deal: ['Signed. A deal with me is a deal.', 'Good. Now we are partners.'],
      demand: ['Pay me, {you}, or I come and take it.'],
      defied: ['You said no to me, {you}. Now you will hear my answer.'],
      paid: ['Take your money. Spend it on a fortress; you will need one.'],
    },
  }),
  // Generic leaders, by government, for any power without its own.
  gov_commonwealth: L({
    id: 'gov_commonwealth',
    name: 'Imra Vale',
    title: 'Chancellor',
    temperament: 'dove',
    agenda: 'commerce',
    bio: 'A banker who thinks every war is a bad investment.',
    lines: {
      hostile: ['Our accounts with {you} are closed.'],
      wary: ['State your business, {you}.'],
      neutral: ['Shall we talk terms, {you}?'],
      cordial: ['Always a pleasure, {you}.'],
      friendly: ['Our dearest partner, {you}.'],
      accept: ['Agreed. Let the ledgers show it.'],
      reject_mood: ['Not with {you}. Not now.'],
      reject_terms: ['The numbers do not add up.'],
      reject_strength: ['We will not be bullied, {you}.'],
      took_city: ['{you} took our city. We will send the bill.'],
      betrayed: ['{you} broke a contract. Nobody will trade with you.'],
      winning: ['{you} are cornering the market. That worries us.'],
      war: ['A war. What a waste.'],
      peace: ['Peace, at last.'],
      deal: ['Signed and sealed.'],
      demand: ['Settle your account, {you}.'],
      defied: ['{you} ignored our terms.'],
      paid: ['Paid in full. Under protest.'],
    },
  }),
  gov_directorate: L({
    id: 'gov_directorate',
    name: 'Kassian Rhee',
    title: 'Director',
    temperament: 'hawk',
    agenda: 'strength',
    bio: 'An engineer who measures nations by their steel output.',
    lines: {
      hostile: ['The Directorate has nothing to say to {you}.'],
      wary: ['Speak, {you}. Quickly.'],
      neutral: ['Output and order, {you}. What do you offer?'],
      cordial: ['{you} are useful to us.'],
      friendly: ['A strong partner, {you}.'],
      accept: ['Approved.'],
      reject_mood: ['Denied. We do not trust {you}.'],
      reject_terms: ['Inefficient terms. Denied.'],
      reject_strength: ['Threats are noted, {you}. And ignored.'],
      took_city: ['{you} took our works. We will retake them.'],
      betrayed: ['{you} broke the agreement. Unforgivable.'],
      winning: ['{you} grow too strong.'],
      war: ['Mobilise.'],
      peace: ['Demobilise. For now.'],
      deal: ['Agreement filed.'],
      demand: ['Deliver the quota, {you}.'],
      defied: ['Quota missed, {you}. Consequences follow.'],
      paid: ['Delivered. Noted.'],
    },
  }),
  gov_federation: L({
    id: 'gov_federation',
    name: 'Odile Saraf',
    title: 'First Minister',
    temperament: 'opportunist',
    agenda: 'balance',
    bio: 'A scientist who thinks the only safe world is one nobody wins.',
    lines: {
      hostile: ['We have run the numbers on {you}. They are not good.'],
      wary: ['Proceed, {you}. Cautiously.'],
      neutral: ['Let us reason together, {you}.'],
      cordial: ['{you} are a stabilising influence.'],
      friendly: ['A model partner, {you}.'],
      accept: ['The model approves. Agreed.'],
      reject_mood: ['Our trust in {you} is below threshold.'],
      reject_terms: ['The trade-off is unacceptable.'],
      reject_strength: ['Your threat changes nothing, {you}.'],
      took_city: ['{you} took one of our cities. Noted, and remembered.'],
      betrayed: ['{you} defected. We update our priors.'],
      winning: ['{you} are unbalancing the system.'],
      war: ['An unwelcome result.'],
      peace: ['Equilibrium restored.'],
      deal: ['Agreed and recorded.'],
      demand: ['A transfer is required, {you}.'],
      defied: ['{you} rejected a reasonable request.'],
      paid: ['Transfer complete. Remembered.'],
    },
  }),
  gov_union: L({
    id: 'gov_union',
    name: 'Bram Ostrova',
    title: 'Steward',
    temperament: 'dove',
    agenda: 'homeland',
    bio: 'A farmer elected by the farmers, who wants every field back.',
    lines: {
      hostile: ['{you} are no friend to our fields.'],
      wary: ['What do you want, {you}?'],
      neutral: ['The harvest is in. Let us talk, {you}.'],
      cordial: ['Good neighbours, {you}.'],
      friendly: ['Our granaries are your granaries, {you}.'],
      accept: ['Agreed, and gladly.'],
      reject_mood: ['Not with {you}. Not after what happened.'],
      reject_terms: ['That is no fair trade.'],
      reject_strength: ['We will not be frightened off our land, {you}.'],
      took_city: ['{you} took our town. We will come home to it.'],
      betrayed: ['{you} broke your word to us.'],
      winning: ['{you} want too much land.'],
      war: ['Then we defend our fields.'],
      peace: ['Peace. Back to the land.'],
      deal: ['A handshake, and it is done.'],
      demand: ['Give back what you owe, {you}.'],
      defied: ['{you} would not listen.'],
      paid: ['There. Leave us be.'],
    },
  }),
};

/** Each power's own leader. A new nation is one entry here and one in `LEADERS`. */
export const NATION_LEADERS: Record<NationId, LeaderId> = {
  usa: 'usa_wainwright',
  china: 'china_gao',
  japan: 'japan_tsujimoto',
  russia: 'russia_severin',
};

export const GOVERNMENT_LEADERS: Record<GovernmentId, LeaderId> = {
  commonwealth: 'gov_commonwealth',
  directorate: 'gov_directorate',
  federation: 'gov_federation',
  union: 'gov_union',
};

/** Who leads `nation`: its own leader, else its government's. */
export function leaderFor(nation: NationId, government: GovernmentId): LeaderDef {
  return LEADERS[NATION_LEADERS[nation] ?? GOVERNMENT_LEADERS[government]]!;
}

export const TEMPERAMENT_TEXT: Record<Temperament, { name: string; means: string }> = {
  hawk: { name: 'Hawk', means: 'Quick to fight, slow to forgive. Respects force.' },
  dove: { name: 'Dove', means: 'Prefers treaties to wars and forgives sooner.' },
  opportunist: { name: 'Opportunist', means: 'Sides with whoever pays and whoever is winning.' },
};

export const AGENDA_TEXT: Record<AgendaId, { name: string; means: string }> = {
  balance: { name: 'Balance of Power', means: 'Distrusts whoever leads the race.' },
  commerce: { name: 'Open Seas', means: 'Loves a trading partner; hates an embargo.' },
  honour: { name: 'A Word Kept', means: 'Values treaties kept; never forgets a betrayal.' },
  strength: { name: 'Iron Respect', means: 'Respects the strong; despises the weak.' },
  homeland: { name: 'Lost Provinces', means: 'Wants back every city it ever lost.' },
};

export const LEADER_TUNING = {
  /** Each memory: its weight when fresh, and the turns over which it fades to nothing. */
  memory: {
    betrayed: { weight: -45, turns: 30 },
    declared_war: { weight: -15, turns: 15 },
    took_city: { weight: -12, turns: 20 },
    made_peace: { weight: 10, turns: 10 },
    dealt: { weight: 6, turns: 10 },
    extorted: { weight: -25, turns: 20 },
    paid_us: { weight: 8, turns: 10 },
    defied: { weight: -20, turns: 12 },
    comrades: { weight: 18, turns: 15 },
  } satisfies Record<MemoryKind, { weight: number; turns: number }>,
  /** At most this many memories of one kind about one power (the newest). */
  memoriesPerKind: 3,
  /** Baseline mood, and percent applied to bad memories (grudges). */
  temperament: {
    hawk: { base: -5, grudge: 150 },
    dove: { base: 8, grudge: 70 },
    opportunist: { base: 0, grudge: 100 },
  } satisfies Record<Temperament, { base: number; grudge: number }>,
  /** Moods from how things stand now. */
  live: {
    at_war: -30,
    allied: 25,
    trade: 10,
    pact: 8,
    ceasefire: 4,
    joint_op: 12,
    embargo: -15,
    common_enemy: 12,
    /** A power this many points of standing ahead of everyone is feared: hawks and opportunists more. */
    fearedGap: 8,
    feared: -12,
    fearedDove: -6,
  },
  agenda: {
    balance: -12,
    commerce: 10,
    /** Honour: a treaty in force with no betrayal remembered, or a betrayal remembered. */
    honourKept: 8,
    honourBroken: -20,
    /** Strength: respect at this many points of standing above us, contempt this far below. */
    strengthGap: 5,
    strengthRespect: 10,
    contemptGap: 8,
    strengthContempt: -10,
    /** Homeland: per city or base of ours they hold, up to the cap. */
    homelandPerSite: -10,
    homelandCap: -30,
  },
  /** Stance thresholds: hostile below the first, wary below the second, and so on. */
  stances: { hostile: -40, wary: -10, neutral: 15, cordial: 40 },
  /** Turns a ceasefire binds both sides. */
  ceasefireTurns: 3,
  /** Turns a joint operation runs. */
  jointOpTurns: 5,
  /** Most of one resource a single exchange or tribute may move. */
  dealMax: 400,
  /** How the AI's leaders weigh an offer (mood points; see `packages/ai/src/diplomacy-ai.ts`). */
  ai: {
    allianceMood: 30,
    pactMood: -10,
    /** No pact with a power this many points of standing ahead: it would only shield the leader. */
    pactGap: 4,
    tradeMood: -25,
    jointOpMood: 0,
    /** Black Files: a leader signs the Accord with anyone it feels better than this about. */
    accordMood: -70,
    /** Percent of what they give a leader wants back in an exchange, before mood. */
    exchangeMargin: 110,
    /** A tribute is paid only when the demander leads by this much standing (hawks need twice). */
    tributeGap: 10,
    /** And never more than this percent of any resource held. */
    tributeShare: 35,
    /** A leader at least this hostile will not trade or sign a pact. */
    sulkMood: -40,
    /** A dove will not start a war on a power it feels this warmly about. */
    doveRestraint: 25,
    /** A leader asks for a ceasefire only from this turn, and only this far behind its enemy in standing. */
    ceasefireFromTurn: 6,
    ceasefireGap: 10,
    /**
     * Asked to start a war (an alliance against a power, or a joint operation on its city, when not
     * already fighting it): the score is half the mood toward the one asking, less half the mood
     * toward the target, plus each reason the target is worth fighting, less each war already on our
     * hands, plus the temperament and any sweetener in the deal. At `threshold` or more, yes.
     */
    joinWar: {
      threshold: 30,
      /** Friendship counts up to this mood: a war needs a reason beyond it. */
      moodFromCap: 40,
      /** Refusals: they like the target this much... */
      likesTarget: 20,
      /** ...or their wars already weigh this much (two at `perWar`). */
      stretched: 30,
      /** Never for a power we like less than this... */
      minMood: 0,
      /** ...and the alliance or joint operation with a power we already fight beside needs this. */
      alreadyAtWarMood: 0,
      /** The target leads the race toward Supremacy. */
      raceLeader: 20,
      /** The target stands ahead of us. */
      stronger: 10,
      /** The target took a city of ours (a memory). */
      tookOurCity: 15,
      /** The target's cities lie within this many hexes of ours... */
      neighbourHexes: 6,
      /** ...worth this much: a threat on the doorstep. */
      neighbour: 10,
      /** Each war (with a power, not a minor state) already being fought. */
      perWar: 15,
      /** The one asking is already our ally. */
      ally: 10,
      hawk: 10,
      dove: -10,
      /** An opportunist joins a war on the race leader readily. */
      opportunistOnLeader: 10,
      /** A sweetener: score per 1000 of its worth at the leader's prices (100 credits at par is 10 000). */
      sweetenerPer1000: 1,
      sweetenerMax: 40,
    },
  },
} as const;
