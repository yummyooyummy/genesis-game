const FREEZE_DURATION_FRAMES = 48; // 0.8s @60fps

class TimeFreeze {
  constructor() {
    this.framesLeft = 0;
    this.corePulseAccumulator = 0;
  }

  start() {
    this.framesLeft = FREEZE_DURATION_FRAMES;
    this.corePulseAccumulator = 0;
  }

  isFrozen() {
    return this.framesLeft > 0;
  }

  shouldCoreTick() {
    if (!this.isFrozen()) return true;
    this.corePulseAccumulator += 1;
    if (this.corePulseAccumulator >= 3) {
      this.corePulseAccumulator = 0;
      return true;
    }
    return false;
  }

  update() {
    if (this.framesLeft > 0) {
      this.framesLeft -= 1;
    }
  }

  reset() {
    this.framesLeft = 0;
    this.corePulseAccumulator = 0;
  }
}

module.exports = TimeFreeze;
