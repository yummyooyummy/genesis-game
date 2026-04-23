const ItemIcons = {
  magnet: null,
  clear: null,
  evolve: null,
  loaded: false,

  preload() {
    return new Promise((resolve) => {
      const urls = {
        magnet: 'assets/icons/icon_magnet.png',
        clear: 'assets/icons/icon_clear.png',
        evolve: 'assets/icons/icon_evolve.png',
      };
      let loadCount = 0;
      const total = Object.keys(urls).length;

      for (const [key, url] of Object.entries(urls)) {
        const img = wx.createImage();
        img.onload = () => {
          console.log(`[ItemIcons] ${key} loaded:`, img.width, 'x', img.height);
          this[key] = img;
          loadCount++;
          if (loadCount === total) {
            this.loaded = true;
            resolve();
          }
        };
        img.onerror = (e) => {
          console.warn(`[ItemIcons] ${key} failed:`, e);
          loadCount++;
          if (loadCount === total) {
            this.loaded = true;
            resolve();
          }
        };
        img.src = url;
      }
    });
  },
};

GameGlobal.ItemIcons = ItemIcons;
module.exports = ItemIcons;
