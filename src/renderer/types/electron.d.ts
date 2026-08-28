/// <reference types="vite/client" />

import { TaxPortalAPI } from '../../preload/preload';

declare global {
  const __APP_VERSION__: string;

  interface Window {
    taxPortalAPI: TaxPortalAPI;
  }
}
