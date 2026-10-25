import { useEffect, useRef, useState } from 'react';
import { NATIONS } from '@brink/scenarios';
import { useNet } from './net/room';

// Room chat, shared by the lobby and the game. Friends talk trash; the host relays every line.

export function Chat({ className = '', autoFocus = false, onClose }: { className?: string; autoFocus?: boolean; onClose?: () => void }) {
  const chat = useNet((s) => s.chat);
  const say = useNet((s) => s.say);
  const readChat = useNet((s) => s.readChat);
  const [text, setText] = useState('');
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
            ✕
          </button>
        )}
      </div>
      <ul ref={list} className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2 text-xs" aria-live="polite">
        {chat.length === 0 && <li className="text-faint">No traffic yet.</li>}
        {chat.map((l, i) => {
          const color = NATIONS.find((n) => n.id === l.nation)?.color;
          return (
            <li key={i}>
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
          say(text);
          setText('');
        }}
      >
        <input
          value={text}
          autoFocus={autoFocus}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose?.();
            e.stopPropagation();
          }}
          placeholder="Say something…"
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
