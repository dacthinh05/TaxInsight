import axios, { AxiosInstance } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import { PORTAL_CONFIG } from '../../shared/constants';
import { UserSessionInfo } from '../../shared/types';
import { ApiInspectorManager } from '../inspector/ApiInspectorManager';

export class PortalSession {
  private jar: CookieJar;
  public client: AxiosInstance;
  private sessionInfo: UserSessionInfo = { isLoggedIn: false };

  constructor() {
    this.jar = new CookieJar();
    this.client = wrapper(
      axios.create({
        baseURL: PORTAL_CONFIG.BASE_URL,
        jar: this.jar,
        timeout: PORTAL_CONFIG.REQUEST_TIMEOUT_MS,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8',
          'Connection': 'keep-alive'
        },
        withCredentials: true
      })
    );
    ApiInspectorManager.getInstance().attachAxios(this.client);
  }

  public getSessionInfo(): UserSessionInfo {
    return { ...this.sessionInfo };
  }

  public setLoggedIn(taxCode: string, companyName?: string) {
    this.sessionInfo = {
      isLoggedIn: true,
      taxCode,
      companyName: companyName || `Doanh nghiệp MST: ${taxCode}`,
      loginTime: new Date().toISOString()
    };
  }

  public clearSession() {
    this.jar.removeAllCookiesSync();
    this.sessionInfo = { isLoggedIn: false };
  }

  public getCookieJar(): CookieJar {
    return this.jar;
  }
}
