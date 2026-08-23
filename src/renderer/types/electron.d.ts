/// <reference types="vite/client" />

import { TaxPortalAPI } from '../../preload/preload';

declare global {
  interface Window {
    taxPortalAPI: TaxPortalAPI;
  }
}
