import { useGame } from './store';

// The Black Files at a glance, beside the hand on the phone's top bar: before they wake, how many
// artefacts the world has dug against the waking and how many you hold; after, that they are awake
// and who has signed the Accord. Everything here is in the player's own view (`NationView.blackFiles`).

export function BlackFilesChip() {
  const view = useGame((s) => s.view);
  const bf = view?.blackFiles;
  if (!view || !bf) return null;
  const mine = bf.artefacts[view.self.id] ?? 0;
  const signed = bf.accord.includes(view.self.id);
  const label = bf.awake
    ? `The Visitors are awake. Accord: ${bf.accord.length} signed${signed ? ', you among them' : ''}. Artefacts held: ${mine}.`
    : `Black Files: ${bf.excavated} of ${bf.wakeAt} artefacts dug before something wakes${bf.wakeTurn ? ` (or turn ${bf.wakeTurn})` : ''}. You hold ${mine}.`;
  return (
    <span
      className={`flex shrink-0 items-center gap-1.5 rounded-full border bg-ink-900/90 py-1 pr-2.5 pl-2 text-[12px] ${bf.awake ? 'border-[#7df9e4]/70 text-[#7df9e4]' : 'border-line text-muted'}`}
      data-testid="black-files-chip"
      data-awake={bf.awake}
      title={label}
      aria-label={label}
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
        <path d="M8 1.5l4.5 3.6L8 14.5 3.5 5.1z" />
        <path d="M3.5 5.1h9M8 1.5v13" />
      </svg>
      {bf.awake ? (
        <span className="font-semibold">Awake · Accord {bf.accord.length}</span>
      ) : (
        <span className="font-semibold tabular-nums">
          {bf.excavated}/{bf.wakeAt} · held {mine}
        </span>
      )}
    </span>
  );
}
