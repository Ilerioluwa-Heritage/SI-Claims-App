// "Install this app". Android phones and Chrome or Edge on a computer offer it
// themselves; the button appears when they do. On an iPhone it's done from
// the Share menu, so the page says how.

import { useEffect, useState } from 'react';

/** Chrome's install offer (not in the standard browser types yet). */
interface InstallOffer extends Event {
  prompt(): Promise<void>;
}

const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const isIPhone = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

export function Install() {
  const [offer, setOffer] = useState<InstallOffer | null>(null);
  const [installed, setInstalled] = useState(isInstalled);

  useEffect(() => {
    const onOffer = (e: Event) => {
      e.preventDefault();
      setOffer(e as InstallOffer);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onOffer);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onOffer);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed) return null;
  if (offer) {
    return (
      <button
        className="secondary"
        onClick={async () => {
          await offer.prompt();
          setOffer(null);
        }}
      >
        Install this app
      </button>
    );
  }
  if (isIPhone()) return <p className="hint">To install on this iPhone: tap Share, then "Add to Home Screen".</p>;
  return null;
}
