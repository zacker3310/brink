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
  // The Middle East and Africa (docs/mideast.md). Invented, like every leader here.
  turkey_demirkol: L({
    id: 'turkey_demirkol',
    name: 'Ayla Demirkol',
    title: 'President',
    temperament: 'opportunist',
    agenda: 'balance',
    bio: 'A former foreign minister who has spent her life keeping three neighbours from ganging up on her.',
    lines: {
      hostile: ['We know exactly what {you} are doing. So does everyone else.', 'Ankara has nothing more to say to {you}.'],
      wary: ['Go on, {you}. We are listening, from a distance.', 'Every bridge has two ends, {you}. Mind yours.'],
      neutral: ['Three seas meet here, {you}. Everyone passes through eventually.', 'We talk to everyone. Today it is your turn.'],
      cordial: ['{you}. A useful conversation, as always.', 'There is business to be done between us, {you}.'],
      friendly: ['{you}! Our door is open and the tea is hot.', 'Whatever {you} need, Ankara will find a way.'],
      accept: ['Agreed. It suits us both, for now.', 'Done. Let the others wonder how.'],
      reject_mood: ['Not after what {you} did. Not yet.', 'Trust is earned on our side of the strait, {you}.'],
      reject_terms: ['A poor bargain. Bring a better one.', 'You value our friendship too cheaply, {you}.'],
      reject_strength: ['Threats do not cross the Bosphorus, {you}.', 'We have outlasted bigger neighbours than {you}.'],
      took_city: ['{you} took one of our cities. The balance will be restored.', 'You will give that city back, {you}, one way or another.'],
      betrayed: ['{you} broke your word. Everyone in the region will hear of it.', 'A broken promise, {you}. We keep a long ledger.'],
      winning: ['{you} are growing too large for this neighbourhood.', 'Nobody rules between the seas, {you}. Not even you.'],
      war: ['So be it, {you}. The plateau has seen armies come and go.', 'You chose this, {you}. We will finish it.'],
      peace: ['Peace. Good. Now everyone can get back to trade.', 'Let the guns cool, and the ports open.'],
      deal: ['Signed. Ankara keeps its bargains.', 'A good arrangement, {you}.'],
      demand: ['A payment is owed, {you}. Settle it.'],
      defied: ['{you} refused us. That will be remembered.'],
      paid: ['Fine. This buys you a little time.'],
    },
  }),
  iran_rostami: L({
    id: 'iran_rostami',
    name: 'Kaveh Rostami',
    title: 'President',
    temperament: 'hawk',
    agenda: 'honour',
    bio: 'A former engineer and negotiator who believes an agreement is sacred, and so is the memory of one broken.',
    lines: {
      hostile: ['We have seen your kind before, {you}. We are still here.', 'There is nothing left to discuss, {you}.'],
      wary: ['Speak, {you}. We will judge your words by your deeds.', 'We are listening. We are not trusting.'],
      neutral: ['Our civilisation is old and our patience older, {you}.', 'Let us speak plainly, {you}.'],
      cordial: ['{you} have dealt fairly with us. We remember that.', 'There is respect between us, {you}.'],
      friendly: ['A true friend of Tehran, {you}. That is rare.', 'Whatever comes, {you}, we stand with you.'],
      accept: ['Agreed. We keep our word; see that you keep yours.', 'It is written. Let it hold.'],
      reject_mood: ['Not while the last wrong stands, {you}.', 'You ask for trust you have not earned.'],
      reject_terms: ['These terms are an insult to our people.', 'No. That is not a fair bargain, {you}.'],
      reject_strength: ['Pressure only hardens us, {you}.', 'We have been threatened by empires. You are not one.'],
      took_city: ['{you} took one of our cities. We will not forget it.', 'That city will be ours again, {you}.'],
      betrayed: ['{you} broke a solemn agreement. A generation will remember.', 'Your signature is worthless now, {you}.'],
      winning: ['Your shadow grows long, {you}. Long shadows fall.', 'No one power will rule this region, {you}.'],
      war: ['Then it will be decided in the mountains, {you}.', 'We did not choose this war. We will end it.'],
      peace: ['Peace, with honour. That is enough.', 'Let this peace be kept better than the last.'],
      deal: ['Signed, and it will be honoured.', 'An agreement between equals.'],
      demand: ['What is owed must be paid, {you}.'],
      defied: ['{you} refused a just demand. There will be an answer.'],
      paid: ['Take it. We pay for peace, not from fear.'],
    },
  }),
  saudi_qahtani: L({
    id: 'saudi_qahtani',
    name: 'Saad Al-Qahtani',
    title: 'Prime Minister',
    temperament: 'opportunist',
    agenda: 'commerce',
    bio: 'An economist who ran the sovereign fund before he ran the government, and still reads the oil price first.',
    lines: {
      hostile: ['Our accounts with {you} are closed.', 'There is no price at which we deal with {you}.'],
      wary: ['Be brief, {you}. Time is money.', 'We will hear your offer. Make it a good one.'],
      neutral: ['Everything has a value, {you}. Let us find yours.', 'The pipelines are open. For now.'],
      cordial: ['Good to hear from {you}. Commerce prefers calm seas.', 'Our markets welcome {you}.'],
      friendly: ['{you}! A partner worth every barrel.', 'Whatever {you} need, we can arrange it.'],
      accept: ['Done. Our people will settle the details.', 'A fair deal, and fair deals last.'],
      reject_mood: ['After what {you} did? No.', 'Your credit with us is spent, {you}.'],
      reject_terms: ['The numbers do not work for us.', 'You ask a great deal for very little, {you}.'],
      reject_strength: ['We can afford to wait you out, {you}.', 'Threats do not move markets, {you}.'],
      took_city: ['{you} took one of our cities. That is a very expensive mistake.', 'We will buy it back, {you}, or take it back.'],
      betrayed: ['A contract broken, {you}. No bank will lend to you now.', 'Your word is worth less than a barrel of sand, {you}.'],
      winning: ['{you} are cornering the market. That worries everyone.', 'Monopolies are bad for business, {you}.'],
      war: ['A war. What a waste of good money.', 'You chose this, {you}. We will outspend you.'],
      peace: ['Peace. Finally, something that pays.', 'Good. The tankers can sail again.'],
      deal: ['Signed. A profitable day for both of us.', 'Pleasure doing business, {you}.'],
      demand: ['Settle your account, {you}, or lose access to the Gulf.'],
      defied: ['{you} ignored our terms. The cost will rise.'],
      paid: ['Paid in full. Under protest.'],
    },
  }),
  egypt_elmasry: L({
    id: 'egypt_elmasry',
    name: 'Nadia El-Masry',
    title: 'President',
    temperament: 'hawk',
    agenda: 'strength',
    bio: 'A former chief of staff who says the Nile has seen every army in history, and buried most of them.',
    lines: {
      hostile: ['The canal is closed to {you}, and so is my door.', 'We are done talking, {you}.'],
      wary: ['Say what you came to say, {you}.', 'Cairo is listening. Briefly.'],
      neutral: ['Strength recognises strength, {you}. Show me yours.', 'Every ship passes Suez sooner or later, {you}.'],
      cordial: ['{you}. More serious than I expected.', 'We may yet work together, {you}.'],
      friendly: ['My friend! Cairo stands with you.', '{you} and Egypt understand each other.'],
      accept: ['Agreed. Egypt keeps its bargains.', 'Good. We have a deal.'],
      reject_mood: ['Not with {you}. Not now.', 'You have not earned a seat at our table.'],
      reject_terms: ['You take us for fools, {you}?', 'No. Bring a better offer.'],
      reject_strength: ['Threaten the largest army in the region, {you}? Try.', 'We do not bend, {you}.'],
      took_city: ['You took a city of ours, {you}. We will take it back with interest.', 'Enjoy it while you can, {you}.'],
      betrayed: ['A knife in the back, {you}. We remember whose hand held it.', 'Treachery. Now we play by our rules.'],
      winning: ['{you} are strong. Strong enough to be a target.', 'The region is watching {you}. So are we.'],
      war: ['Then let it be decided in the desert, {you}.', 'You wanted war, {you}. You have it.'],
      peace: ['Peace. Not because we must.', 'We stop. For now.'],
      deal: ['Signed. A deal with Cairo is a deal.', 'Good. Now we are partners.'],
      demand: ['Pay what is owed, {you}, or the canal closes.'],
      defied: ['You said no to Egypt, {you}. Now hear our answer.'],
      paid: ['Take it. Build yourself a fortress; you will need one.'],
    },
  }),
  nigeria_okafor: L({
    id: 'nigeria_okafor',
    name: 'Adaeze Okafor',
    title: 'President',
    temperament: 'dove',
    agenda: 'homeland',
    bio: 'A former mediator in a dozen regional crises who has promised that no Nigerian town will be left in foreign hands.',
    lines: {
      hostile: ['{you} have made an enemy of two hundred million people.', 'There is nothing left to say, {you}.'],
      wary: ['We will hear you, {you}. Carefully.', 'Your words are welcome. Your armies are not.'],
      neutral: ['Africa can settle its own quarrels, {you}. Shall we try?', 'Let us talk before anyone shoots.'],
      cordial: ['Good to see {you}. Abuja values a steady neighbour.', 'There is room for both of us on this continent, {you}.'],
      friendly: ['{you} are a true friend of Nigeria.', 'Whatever comes, {you}, we stand together.'],
      accept: ['Agreed, and gladly.', 'A good agreement. Let it bring calm.'],
      reject_mood: ['Not after what happened, {you}.', 'Trust takes time to rebuild, {you}.'],
      reject_terms: ['That is not a fair trade, {you}.', 'We cannot accept these terms.'],
      reject_strength: ['We will not be frightened off our own land, {you}.', 'Pressure will not move us.'],
      took_city: ['{you} hold one of our towns. We are coming home to it.', 'Our people will not rest until that town is free, {you}.'],
      betrayed: ['{you} broke your word to us. Shame on you.', 'An oath broken is a wound that does not close, {you}.'],
      winning: ['{you} want too much of this continent.', 'Power without restraint frightens us, {you}.'],
      war: ['We did not want this war, {you}.', 'With regret, we will defend our people.'],
      peace: ['Peace. Thank you, {you}.', 'Let this peace hold longer than the last one.'],
      deal: ['Signed, and we will honour it.', 'An agreement between good neighbours.'],
      demand: ['We must ask {you} for what is ours. Please do not refuse.'],
      defied: ['You ignored a fair request, {you}. We are disappointed.'],
      paid: ['We pay to keep the peace. Remember that.'],
    },
  }),
  southafrica_mokoena: L({
    id: 'southafrica_mokoena',
    name: 'Mandisa Mokoena',
    title: 'President',
    temperament: 'dove',
    agenda: 'honour',
    bio: 'A constitutional lawyer who believes a treaty kept is the strongest weapon a country can have.',
    lines: {
      hostile: ['I had hoped for better from {you}. I no longer do.', 'There is nothing honourable left to discuss, {you}.'],
      wary: ['We will listen, {you}. And we will check.', 'Your words will be weighed against your deeds.'],
      neutral: ['Welcome, {you}. Let us speak plainly.', 'We prefer agreements to wars. Do you?'],
      cordial: ['It is good to see {you}. Our door is open.', 'We value the trust between us, {you}.'],
      friendly: ['{you} are a true friend to Pretoria.', 'Whatever comes, {you}, we stand with you.'],
      accept: ['We accept, and we will keep our word.', 'Agreed. May it hold.'],
      reject_mood: ['Trust broken is slow to mend, {you}.', 'Not yet. Show us your word is good.'],
      reject_terms: ['We cannot accept these terms.', 'That is not a fair bargain, {you}.'],
      reject_strength: ['We will not bow to threats, {you}.', 'Pressure will not move us.'],
      took_city: ['{you} took our city. We grieve, and we remember.', 'Our people will not forgive this easily, {you}.'],
      betrayed: ['{you} broke a solemn promise. The whole continent will know.', 'A treaty broken is a wound that does not close.'],
      winning: ['{you} grow strong. We hope you will also be just.', 'Power without restraint frightens us, {you}.'],
      war: ['We did not want this war, {you}.', 'With regret, we will defend ourselves.'],
      peace: ['Peace. Thank you, {you}.', 'Let this peace last.'],
      deal: ['Signed, and we will honour it.', 'An agreement between honest nations.'],
      demand: ['We must ask {you} for compensation. Please do not refuse.'],
      defied: ['You ignored a fair request, {you}. We are disappointed.'],
      paid: ['We pay to keep the peace. Remember that.'],
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
  egypt: 'egypt_elmasry',
  iran: 'iran_rostami',
  nigeria: 'nigeria_okafor',
  'saudi-arabia': 'saudi_qahtani',
  'south-africa': 'southafrica_mokoena',
  turkey: 'turkey_demirkol',
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
  },
} as const;
