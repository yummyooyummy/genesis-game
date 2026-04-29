const playerData = require('./playerData');

const SFX_NAMES = ['merge', 'levelup', 'item', 'pickup', 'gameover', 'button', 'button_V2', 'record'];
const SFX_POOL_SIZE = 3;

class AudioManager {
  constructor() {
    this.bgm = null;
    this.bgmStarted = false;
    this.bgmMuted = false;
    this.sfxMuted = false;
    this.bgmPausedByGame = false;
    this.sfxPools = {};
  }

  init() {
    const settings = playerData.getAudioSettings();
    this.bgmMuted = settings.bgmMuted;
    this.sfxMuted = settings.sfxMuted;

    this.bgm = wx.createInnerAudioContext();
    this.bgm.src = 'audio/bgm_main.mp3';
    this.bgm.loop = true;
    this.bgm.volume = this.bgmMuted ? 0 : 0.5;

    for (const name of SFX_NAMES) {
      this.sfxPools[name] = [];
      for (let i = 0; i < SFX_POOL_SIZE; i++) {
        const a = wx.createInnerAudioContext();
        a.src = `audio/sfx_${name}.mp3`;
        a.volume = this.sfxMuted ? 0 : 0.7;
        this.sfxPools[name].push(a);
      }
    }
  }

  playBGM() {
    if (this.bgmMuted) return;
    if (!this.bgmStarted) {
      this.bgm.play();
      this.bgmStarted = true;
    } else if (this.bgm.paused) {
      this.bgm.play();
    }
    this.bgmPausedByGame = false;
  }

  pauseBGMByGame() {
    if (this.bgmPausedByGame) return;
    this.bgmPausedByGame = true;
    if (!this.bgmMuted && this.bgmStarted) {
      this.bgm.pause();
    }
  }

  resumeBGMByGame() {
    if (!this.bgmPausedByGame) return;
    this.bgmPausedByGame = false;
    if (!this.bgmMuted && this.bgmStarted) {
      this.bgm.play();
    }
  }

  playSFX(name) {
    if (this.sfxMuted) return;
    const pool = this.sfxPools[name];
    if (!pool) return;
    for (const a of pool) {
      if (a.paused) {
        a.seek(0);
        a.play();
        return;
      }
    }
  }

  setBGMMuted(muted) {
    this.bgmMuted = muted;
    this.bgm.volume = muted ? 0 : 0.5;
    if (muted && this.bgmStarted && !this.bgmPausedByGame) {
      this.bgm.pause();
    } else if (!muted && this.bgmStarted && !this.bgmPausedByGame) {
      this.bgm.play();
    }
    playerData.setAudioSettings({ bgmMuted: muted });
  }

  setSFXMuted(muted) {
    this.sfxMuted = muted;
    for (const name of SFX_NAMES) {
      for (const a of this.sfxPools[name]) {
        a.volume = muted ? 0 : 0.7;
      }
    }
    playerData.setAudioSettings({ sfxMuted: muted });
  }
}

module.exports = AudioManager;
