import { useState } from 'react';

export const DISCLAIMER =
  'Boundaries are approximate and not a legal survey. Posted signs and current regulations always win. You are responsible for getting permission to enter private land.';

const KEY = 'openhunt.disclaimer.v1';

function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function Disclaimer() {
  const [open, setOpen] = useState(() => !seen());
  if (!open) return null;

  const accept = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // Private mode: show it again next launch.
    }
    setOpen(false);
  };

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="disclaimer-title">
        <h2 id="disclaimer-title">Before you head out</h2>
        <p>{DISCLAIMER}</p>
        <p>Land data comes from public government sources and can be out of date. Each layer shows its source date.</p>
        <button onClick={accept}>I understand</button>
      </div>
    </div>
  );
}
