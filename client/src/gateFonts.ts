export const gateFontsReady = Promise.all([
  document.fonts.load('400 34px "ZSFT-br"', "Mian"),
  document.fonts.load('500 8px "ZSFT-br"', "PRIVATE ARCHIVE SINCE 10.15"),
  document.fonts.load('400 11px "LXGW Heart Serif"', "敲門開著進來密碼給不用我先把鎖好至少十個字在這台電腦上那邊沒醒等一下不對再寫次。"),
]).then(() => { document.documentElement.classList.add("gate-fonts-ready"); });
