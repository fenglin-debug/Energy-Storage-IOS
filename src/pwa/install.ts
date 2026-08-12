export function isStandalone(): boolean {
  const mq = window.matchMedia('(display-mode: standalone)').matches;
  // iOS Safari legacy
  const ios = 'standalone' in navigator && (navigator as Navigator & { standalone?: boolean }).standalone;
  return mq || !!ios;
}

export function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const webkit = /WebKit/.test(ua);
  const notChrome = !/CriOS|FxiOS|EdgiOS/.test(ua);
  return iOS && webkit && notChrome;
}
