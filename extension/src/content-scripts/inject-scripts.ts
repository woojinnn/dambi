import Browser from 'webextension-polyfill';

function injectScript(url: string): void {
  const container = document.head ?? document.documentElement;
  const script = document.createElement('script');
  script.setAttribute('async', 'false');
  script.setAttribute('src', Browser.runtime.getURL(url));
  container.appendChild(script);
  script.onload = () => script.remove();
}

injectScript('js/injected/proxy-injected-providers.js');
