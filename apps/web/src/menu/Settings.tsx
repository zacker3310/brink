import { useEffect, useState, type ReactNode } from 'react';
import { readSettings, writeSettings, type ArenaSettings } from '../arena/quality';
import { ScreenHeader, useKeys } from '../chrome';
import { readPrefs, writePrefs, type MapStyle } from '../saves';
import { isMuted, setMuted, sfx } from '../sfx';
import { useGame } from '../store';
import { applyMotion, install, installState, onInstallChange, type InstallState } from './device';

// Settings: one screen for what a player tunes once on a device. Sound, the battle's render
// quality, motion, haptics and colours (the battle menu changes the same settings), the campaign's
// map and staff, the guided turn, and installing Brink to the Home Screen.

function Seg<T extends string>({ id, value, options, onChange }: { id: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void }) {
  return (
    <div className="set-seg" role="radiogroup" aria-labelledby={`${id}-label`}>
      {options.map(([v, label]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} data-testid={`set-${id}-${v}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Row({ id, label, note, children }: { id: string; label: string; note: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="min-w-0 flex-1">
        <div id={`${id}-label`} className="set-label">
          {label}
        </div>
        <p className="set-note">{note}</p>
      </div>
      <div className="set-control">{children}</div>
    </div>
  );
}

const ONOFF = [
  ['on', 'On'],
  ['off', 'Off'],
] as const;
const onoff = (b: boolean) => (b ? 'on' : 'off');

export function Settings({ onBack }: { onBack: () => void }) {
  const [arena, setArena] = useState<ArenaSettings>(() => readSettings());
  const [muted, setMute] = useState(isMuted());
  const mapStyle = useGame((s) => s.mapStyle);
  const setMapStyle = useGame((s) => s.setMapStyle);
  const staffPlan = useGame((s) => s.staffPlan);
  const setStaffPlan = useGame((s) => s.setStaffPlan);
  const animate = useGame((s) => s.animate);
  const setAnimate = useGame((s) => s.setAnimate);
  const notify = useGame((s) => s.notify);
  const [tutorial, setTutorial] = useState(readPrefs().tutorialDone === true);
  const [inst, setInst] = useState<InstallState>(installState);
  useEffect(() => onInstallChange(() => setInst(installState())), []);
  useKeys(
    (e) => {
      if (e.key === 'Escape') onBack();
    },
    [onBack],
  );

  const put = (patch: Partial<ArenaSettings>) => {
    const next = { ...arena, ...patch };
    setArena(next);
    writeSettings(next);
    if (patch.motion) applyMotion(patch.motion);
  };

  return (
    <main className="safe-bottom flex min-h-full flex-col" data-testid="settings">
      <ScreenHeader kicker="Options" title="Settings" onBack={onBack} />
      <div className="mx-auto w-full max-w-2xl px-4 pt-4 pb-10">
        <section className="set-group" aria-label="Sound">
          <h2 className="set-head">Sound</h2>
          <Row id="sound" label="Sound" note="Effects, battle music and radio, made live in the browser.">
            <Seg
              id="sound"
              value={onoff(!muted)}
              options={ONOFF}
              onChange={(v) => {
                setMuted(v === 'off');
                setMute(v === 'off');
                if (v === 'on') sfx.order();
              }}
            />
          </Row>
          <Row id="radio" label="Radio calls" note="Your crews call contacts and kills in battle.">
            <Seg id="radio" value={onoff(arena.radio)} options={ONOFF} onChange={(v) => put({ radio: v === 'on' })} />
          </Row>
        </section>

        <section className="set-group" aria-label="Display">
          <h2 className="set-head">Display</h2>
          <Row id="quality" label="Battle quality" note="Low for older phones and long sessions on battery; High for a desk.">
            <Seg
              id="quality"
              value={arena.quality}
              options={[
                ['low', 'Low'],
                ['balanced', 'Balanced'],
                ['high', 'High'],
              ]}
              onChange={(quality) => put({ quality })}
            />
          </Row>
          <Row id="motion" label="Motion" note="Reduced: cuts instead of camera flights and no slow motion. Off also stops screen shake.">
            <Seg
              id="motion"
              value={arena.motion}
              options={[
                ['full', 'Full'],
                ['reduced', 'Reduced'],
                ['off', 'Off'],
              ]}
              onChange={(motion) => put({ motion, ...(motion === 'off' ? { shake: 0 } : arena.shake === 0 ? { shake: 100 } : {}) })}
            />
          </Row>
          <Row id="palette" label="Colours" note="Friend and foe in a colour-blind-safe blue and orange.">
            <Seg
              id="palette"
              value={arena.palette}
              options={[
                ['standard', 'Standard'],
                ['colourblind', 'Colour-blind'],
              ]}
              onChange={(palette) => put({ palette })}
            />
          </Row>
          <Row id="map" label="War map" note="Painted world map, a clean board, or satellite ground.">
            <Seg<MapStyle>
              id="map"
              value={mapStyle}
              options={[
                ['painted', 'Painted'],
                ['atlas', 'Clean'],
                ['satellite', 'Satellite'],
              ]}
              onChange={setMapStyle}
            />
          </Row>
        </section>

        <section className="set-group" aria-label="Touch">
          <h2 className="set-head">Touch</h2>
          <Row id="haptics" label="Haptics" note="A tick under your thumb on Fire and End Turn (iPhone).">
            <Seg id="haptics" value={onoff(arena.haptics)} options={ONOFF} onChange={(v) => put({ haptics: v === 'on' })} />
          </Row>
          <Row id="hand" label="Battle controls" note="Camera buttons and End Turn on the side of your thumb.">
            <Seg
              id="hand"
              value={arena.leftHanded ? 'left' : 'right'}
              options={[
                ['right', 'Right hand'],
                ['left', 'Left hand'],
              ]}
              onChange={(v) => put({ leftHanded: v === 'left' })}
            />
          </Row>
        </section>

        <section className="set-group" aria-label="Campaign">
          <h2 className="set-head">Campaign</h2>
          <Row id="staff" label="Staff plan" note="Every turn opens with your staff's orders drafted; change any of them.">
            <Seg id="staff" value={onoff(staffPlan)} options={ONOFF} onChange={(v) => setStaffPlan(v === 'on')} />
          </Row>
          <Row id="replay" label="Turn replay" note="Watch every resolved turn play out on the map.">
            <Seg id="replay" value={onoff(animate)} options={ONOFF} onChange={(v) => setAnimate(v === 'on')} />
          </Row>
          <Row id="guide" label="Guided first turn" note={tutorial ? 'Done. Put it first on the title screen again.' : 'Offered first on the title screen.'}>
            <button
              type="button"
              className="v-btn v-btn-secondary h-10 px-4 text-[13px]"
              disabled={!tutorial}
              onClick={() => {
                writePrefs({ tutorialDone: false });
                setTutorial(false);
                notify('The guided first turn is back on the title screen');
              }}
              data-testid="set-guide-reset"
            >
              {tutorial ? 'Show again' : 'Waiting'}
            </button>
          </Row>
        </section>

        <section className="set-group" aria-label="App">
          <h2 className="set-head">App</h2>
          <Row
            id="install"
            label="Home Screen"
            note={
              inst === 'installed'
                ? 'Brink is installed: it opens full screen and plays offline.'
                : inst === 'ios'
                  ? 'In Safari tap Share, then Add to Home Screen: full screen, offline, no browser bars.'
                  : inst === 'prompt'
                    ? 'Install Brink: full screen, offline, its own icon.'
                    : 'Install from your browser menu to play full screen and offline.'
            }
          >
            {inst === 'prompt' ? (
              <button type="button" className="v-btn v-btn-primary h-10 px-4 text-[13px]" onClick={() => void install()} data-testid="set-install">
                Install
              </button>
            ) : (
              <span className="set-badge" data-testid="set-install-state">
                {inst === 'installed' ? 'Installed' : inst === 'ios' ? 'Share › Add' : 'Browser menu'}
              </span>
            )}
          </Row>
        </section>
      </div>
    </main>
  );
}
