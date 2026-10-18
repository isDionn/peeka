// The "seen it" flag of the first-run card. Strip and island pages share an origin: Settings › Mascot clears the flag and the island reopens the card.
export const FIRST_KEY = "notch.firstRun";
const OLD_KEY = "notch.ilkAcilis"; // the pre-English key: moved to FIRST_KEY once so existing installs don't see the card again
export const firstRunDone = () => {
  try {
    if (localStorage.getItem(OLD_KEY) === "1") { localStorage.setItem(FIRST_KEY, "1"); localStorage.removeItem(OLD_KEY); }
    return localStorage.getItem(FIRST_KEY) === "1";
  } catch { return false; }
};
export const markFirstRun = () => { try { localStorage.setItem(FIRST_KEY, "1"); } catch { /* no storage: asks on every launch */ } };
export const resetFirstRun = () => { try { localStorage.removeItem(FIRST_KEY); localStorage.removeItem(OLD_KEY); } catch { /* no storage */ } };
