import { useEffect, useRef, useState } from 'react';
import { NATIONS } from '@brink/scenarios';
import { useNet } from './net/room';
import { Icon } from './icons';

// Room chat, shared by the lobby and the game. Friends talk trash; the host relays every line.

export function Chat({ className = '', autoFocus = false, onClose }: { className?: string; autoFocus?: boolean; onClose?: () => void }) {
  const chat = useNet((s) => s.chat);
  const say = useNet((s) => s.say);
  const readChat = useNet((s) => s.readChat);
  const seats = useNet((s) => s.seats);
  const role = useNet((s) => s.role);
  const me = useNet((s) => s.me);
  const [text, setText] = useState('');
  const [to, setTo] = useState<string | null>(null);
  // Private channels: any other seat with a human in it.
  const others = seats.filter((s) => s.player !== null && !s.ai && !(role === 'host' ? s.host : s.player === me));
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    readChat();
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [chat.length, readChat]);
  return (
    <div className={`ds-panel flex flex-col ${className}`} data-testid="chat">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="ds-label">Comms</span>
        {onClose && (
          <button type="button" onClick={onClose} className="text-faint hover:text-text" aria-label="Close chat">
            <Icon name="close" />
          </button>
        )}
      </div>
      <ul ref={list} className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2 text-xs" aria-live="polite">
        {chat.length === 0 && <li className="text-faint">No traffic yet.</li>}
        {chat.map((l, i) => {
          const color = NATIONS.find((n) => n.id === l.nation)?.color;
          const target = l.to ? NATIONS.find((n) => n.id === l.to) : undefined;
          return (
            <li key={i} className={l.to ? 'border-l-2 border-signal/70 bg-signal/5 pl-1.5' : ''} data-private={l.to ? 'true' : undefined}>
              {target && <span className="mr-1 text-[10px] font-semibold text-signal uppercase">private to {target.name.split(' ')[0]}</span>}
              <span className="font-display font-bold tracking-wide uppercase" style={{ color: color ?? 'var(--color-muted)' }}>
                {l.from}
              </span>{' '}
              <span className={l.from === 'Room' ? 'text-faint italic' : 'text-text'}>{l.text}</span>
            </li>
          );
        })}
      </ul>
      <form
        className="flex border-t border-line"
        onSubmit={(e) => {
          e.preventDefault();
          say(text, to);
          setText('');
        }}
      >
        {others.length > 0 && (
          <select
            value={to ?? ''}
            onChange={(e) => setTo(e.target.value || null)}
            className="max-w-24 border-r border-line bg-transparent px-1 text-[11px] text-muted focus:outline-none"
            aria-label="Channel"
            data-testid="chat-channel"
          >
            <option value="">All</option>
            {others.map((s) => (
              <option key={s.nation} value={s.nation}>
                {NATIONS.find((n) => n.id === s.nation)?.name.split(' ')[0]}
              </option>
            ))}
          </select>
        )}
        <input
          value={text}
          autoFocus={autoFocus}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose?.();
            e.stopPropagation();
          }}
          placeholder={to ? 'Whisper…' : 'Say something…'}
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-xs text-text focus:outline-none"
          aria-label="Chat message"
          data-testid="chat-input"
          maxLength={280}
        />
        <button type="submit" className="px-3 text-xs font-semibold text-signal hover:brightness-125">
          Send
        </button>
      </form>
    </div>
  );
}
