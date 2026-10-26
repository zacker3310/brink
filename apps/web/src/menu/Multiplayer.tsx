import { useState } from 'react';
import type { NationId } from '@brink/contracts';
import { GOVERNMENTS } from '@brink/game-data';
import { NATIONS } from '@brink/scenarios';
import { Frame, Kbd, Label, ScreenHeader, useKeys } from '../chrome';
import { Emblem } from '../glyphs';
import { useNet } from '../net/room';
import { netMode } from '../net/transport';
import { Chat } from '../Chat';
import { operationName, randomSeed } from './intel';

// Multiplayer: host a room for friends, join one by code, or play hotseat on one device.

export function inviteLink(code: string): string {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  if (netMode() === 'local') url.searchParams.set('net', 'local');
  url.searchParams.set('join', code);
  return url.toString();
}

export function Multiplayer({ onBack, initialCode }: { onBack: () => void; initialCode?: string }) {
  const role = useNet((s) => s.role);
  const leave = useNet((s) => s.leave);
  const back = () => {
    leave();
    onBack();
  };
  useKeys((e) => e.key === 'Escape' && back(), []);
  return (
    <main className="flex min-h-full flex-col">
      <ScreenHeader kicker="Multiplayer" title={role === 'host' || role === 'guest' ? 'War room' : 'Play with friends'} onBack={back} />
      {role === 'host' || role === 'guest' ? <Lobby /> : <Choose initialCode={initialCode} />}
    </main>
  );
}

function Choose({ initialCode }: { initialCode?: string }) {
  const name = useNet((s) => s.name);
  const setName = useNet((s) => s.setName);
  const host = useNet((s) => s.host);
  const join = useNet((s) => s.join);
  const busy = useNet((s) => s.busy);
  const error = useNet((s) => s.error);
  const startHotseat = useNet((s) => s.startHotseat);
  const [code, setCode] = useState(initialCode ?? '');
  const [seats, setSeats] = useState<NationId[]>([NATIONS[0]!.id, NATIONS[1]!.id]);
  const toggle = (n: NationId) => setSeats((s) => (s.includes(n) ? s.filter((x) => x !== n) : [...s, n]));
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4 p-4 sm:p-6 lg:grid-cols-3">
      <div className="lg:col-span-3">
        <Label>Your callsign</Label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 24))}
          placeholder="e.g. Viper"
          className="mt-1 w-72 border border-line bg-ink-850 px-3 py-2 font-display text-lg tracking-wide text-text uppercase focus:border-signal focus:outline-none"
          data-testid="mp-name"
          aria-label="Your name"
        />
        {error && (
          <p className="mt-2 text-sm text-hostile" role="alert" data-testid="mp-error">
            {error}
          </p>
        )}
      </div>

      <Frame className="enter-1 flex flex-col p-5">
        <Label>Host online</Label>
        <h2 className="mt-1 font-display text-2xl font-bold tracking-wide uppercase">Open a war room</h2>
        <p className="mt-2 flex-1 text-sm text-muted">Get a room code to send your friends. Your browser runs the war; everyone else sees only what their own nation can see. Empty seats go to the AI.</p>
        <button type="button" disabled={busy} onClick={() => void host()} data-testid="mp-host" className="mt-4 bg-signal px-4 py-3 font-display text-lg font-bold tracking-wider text-ink-950 uppercase hover:brightness-110 disabled:opacity-60">
          {busy ? 'Opening…' : 'Host a game'}
        </button>
      </Frame>

      <Frame className="enter-2 flex flex-col p-5">
        <Label>Join</Label>
        <h2 className="mt-1 font-display text-2xl font-bold tracking-wide uppercase">Enter a code</h2>
        <p className="mt-2 text-sm text-muted">Your host has a five-letter room code, or send you an invite link that fills it in.</p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))}
          placeholder="K7QXR"
          className="mt-3 border border-line bg-ink-850 px-3 py-2 text-center font-mono text-2xl tracking-[0.4em] text-text focus:border-signal focus:outline-none"
          data-testid="mp-code"
          aria-label="Room code"
        />
        <div className="flex-1" />
        <button
          type="button"
          disabled={busy || code.length !== 5}
          onClick={() => void join(code)}
          data-testid="mp-join"
          className="mt-4 border border-signal px-4 py-3 font-display text-lg font-bold tracking-wider text-signal uppercase hover:bg-signal/10 disabled:opacity-40"
        >
          {busy ? 'Connecting…' : 'Join game'}
        </button>
      </Frame>

      <Frame className="enter-3 flex flex-col p-5">
        <Label>Hotseat</Label>
        <h2 className="mt-1 font-display text-2xl font-bold tracking-wide uppercase">Pass the laptop</h2>
        <p className="mt-2 text-sm text-muted">Two to four players on one device. Each plans in secret behind a curtain, then the world moves at once.</p>
        <div className="mt-3 grid grid-cols-2 gap-1.5">
          {NATIONS.map((n) => {
            const on = seats.includes(n.id);
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => toggle(n.id)}
                aria-pressed={on}
                data-testid={`hotseat-${n.id}`}
                className={`flex items-center gap-1.5 border px-2 py-1.5 text-left text-xs ${on ? 'border-signal bg-signal/10' : 'border-line text-muted hover:border-faint'}`}
              >
                <Emblem color={n.color} government={n.government} className="h-4 w-4" />
                {n.name.split(' ')[0]}
                <span className="ml-auto text-[10px]">{on ? 'HUMAN' : 'AI'}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          disabled={seats.length < 2}
          onClick={() => void startHotseat(seats, randomSeed())}
          data-testid="mp-hotseat"
          className="mt-4 border border-line bg-ink-800 px-4 py-3 font-display text-lg font-bold tracking-wider uppercase hover:border-faint disabled:opacity-40"
        >
          Start hotseat · {seats.length} players
        </button>
      </Frame>
    </div>
  );
}

function Lobby() {
  const role = useNet((s) => s.role);
  const code = useNet((s) => s.code)!;
  const seats = useNet((s) => s.seats);
  const seed = useNet((s) => s.seed);
  const meName = useNet((s) => s.me);
  const claim = useNet((s) => s.claim);
  const setSeed = useNet((s) => s.setSeed);
  const turnSeconds = useNet((s) => s.turnSeconds);
  const setTurnSeconds = useNet((s) => s.setTurnSeconds);
  const start = useNet((s) => s.start);
  const busy = useNet((s) => s.busy);
  const error = useNet((s) => s.error);
  const resumeTurn = useNet((s) => s.resumeTurn);
  const resuming = resumeTurn !== null;
  const [copied, setCopied] = useState(false);
  const isHost = role === 'host';
  const me = (s: (typeof seats)[number]) => (isHost ? s.host : s.player !== null && s.player === meName);
  const mine = seats.find(me);
  const humans = seats.filter((s) => s.player).length;
  const link = inviteLink(code);
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4 p-4 sm:p-6 lg:grid-cols-[1fr_340px]">
      <div className="flex flex-col gap-4">
        <Frame className="enter-1 flex flex-wrap items-center gap-6 p-5">
          <div>
            <Label>Room code</Label>
            <div className="font-mono text-5xl font-medium tracking-[0.3em] text-signal" data-testid="room-code">
              {code}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <Label>Invite link</Label>
            <div className="mt-1 flex">
              <input readOnly value={link} className="min-w-0 flex-1 border border-line bg-ink-850 px-2 py-1.5 font-mono text-xs text-muted" aria-label="Invite link" onFocus={(e) => e.target.select()} />
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(link).then(() => setCopied(true));
                }}
                className="border border-l-0 border-line bg-ink-800 px-3 text-xs hover:text-signal"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-faint">{isHost ? 'Keep this tab open: your browser is the server.' : 'Waiting for the host to start.'}</p>
          </div>
        </Frame>

        <div className="grid gap-3 sm:grid-cols-2" data-testid="seats">
          {seats.map((s, i) => {
            const spec = NATIONS.find((n) => n.id === s.nation)!;
            const gov = GOVERNMENTS[spec.government];
            const taken = s.player !== null;
            const isMine = me(s);
            return (
              <Frame key={s.nation} className={`enter-${(i % 4) + 1} p-4`} accent={spec.color}>
                <div className="flex items-center gap-3">
                  <Emblem color={spec.color} government={spec.government} className="h-10 w-10" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-display text-xl font-bold tracking-wide uppercase" style={{ color: spec.color }}>
                      {spec.name}
                    </div>
                    <div className="text-[11px] text-muted">{gov.name}</div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span className={`h-2 w-2 rounded-full ${taken ? (s.connected ? 'bg-good' : 'bg-hostile') : 'bg-faint'}`} aria-hidden />
                    {taken ? (
                      <span className="font-semibold">
                        {s.player}
                        {s.host && <span className="ml-1.5 text-[10px] text-signal uppercase">host</span>}
                        {isMine && <span className="ml-1.5 text-[10px] text-friend uppercase">you</span>}
                        {resuming && !s.connected && <span className="ml-1.5 text-[10px] text-faint uppercase">{s.ai ? 'reserved · AI held' : 'reserved'}</span>}
                      </span>
                    ) : (
                      <span className="text-faint">AI commander</span>
                    )}
                  </div>
                  {!taken && !resuming && (
                    <button type="button" onClick={() => claim(s.nation)} data-testid={`claim-${s.nation}`} className="border border-signal/60 px-2.5 py-1 text-xs font-semibold text-signal hover:bg-signal/10">
                      Take seat
                    </button>
                  )}
                  {isMine && !isHost && !resuming && (
                    <button type="button" onClick={() => claim(null)} className="text-xs text-faint hover:text-text">
                      Leave seat
                    </button>
                  )}
                </div>
              </Frame>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <Frame className="p-4">
          <Label>Operation</Label>
          {resuming ? (
            <div className="mt-1 font-display text-2xl font-bold tracking-wide text-signal uppercase" data-testid="resume-turn">
              Resuming turn {resumeTurn}
            </div>
          ) : (
            <div className="mt-1 font-display text-2xl font-bold tracking-wide text-signal uppercase">{operationName(seed)}</div>
          )}
          <div className={`mt-2 flex items-center gap-2 text-xs text-muted ${resuming ? 'hidden' : ''}`}>
            Seed <span className="font-mono text-text">{seed}</span>
            {isHost && (
              <button type="button" onClick={() => setSeed(randomSeed())} className="border border-line px-1.5 hover:text-text" aria-label="New seed">
                ⚄
              </button>
            )}
          </div>
          <div className="mt-2 text-xs text-muted">
            {humans} human{humans === 1 ? '' : 's'} · {4 - humans} AI
          </div>
          <div className="mt-3">
            <Label>Planning timer</Label>
            <div className="mt-1 flex gap-1" role="radiogroup" aria-label="Planning timer">
              {[0, 60, 120, 300].map((secs) => (
                <button
                  key={secs}
                  type="button"
                  role="radio"
                  aria-checked={turnSeconds === secs}
                  disabled={!isHost}
                  onClick={() => setTurnSeconds(secs)}
                  data-testid={`timer-${secs}`}
                  className={`flex-1 border py-1 text-xs ${turnSeconds === secs ? 'border-signal text-signal' : 'border-line text-muted'} ${isHost ? 'hover:text-text' : 'cursor-default'}`}
                >
                  {secs === 0 ? 'Off' : `${secs / 60} min`}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="mt-2 text-xs text-hostile">{error}</p>}
          {isHost ? (
            <button
              type="button"
              disabled={busy || !mine}
              onClick={() => void start()}
              data-testid="mp-start"
              className="mt-4 w-full bg-signal px-4 py-3 font-display text-lg font-bold tracking-wider text-ink-950 uppercase hover:brightness-110 disabled:opacity-50"
            >
              {busy ? 'Deploying…' : resuming ? 'Resume campaign' : 'Start campaign'}
            </button>
          ) : (
            <div className="mt-4 border border-line px-3 py-2 text-center text-xs text-muted">{mine ? 'Ready. Waiting for the host…' : resuming ? 'Seats are held for the saved players.' : 'Take a seat to play.'}</div>
          )}
          <p className="mt-2 text-[10px] text-faint">
            <Kbd>Esc</Kbd> leaves the room.
          </p>
        </Frame>
        <Chat className="h-72" />
      </div>
    </div>
  );
}
