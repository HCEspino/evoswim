/** A world→screen mapping that drifts after the swimmer. World unit = body length. */
export class Camera {
  cx = 0
  cy = 0
  /** CSS pixels per body length */
  scale = 110
  width = 800
  height = 500
  private started = false

  resize(width: number, height: number): void {
    this.width = width
    this.height = height
    // keep roughly 6.5 body lengths across, clamped for small screens
    this.scale = Math.max(70, Math.min(200, width / 6.5))
  }

  /** Fixed framing: show `worldWidth` body lengths across, centred on the origin. */
  frame(width: number, height: number, worldWidth: number): void {
    this.width = width
    this.height = height
    this.scale = width / worldWidth
    this.started = true
  }

  /**
   * Keep (x, y) inside the view with a margin, panning as little as possible
   * and easing back to the origin when it is comfortably inside.
   */
  keepInView(x: number, y: number, marginPx: number, k: number): void {
    const hw = this.width / 2 - marginPx
    const hh = this.height / 2 - marginPx
    const dx = (x - this.cx) * this.scale
    const dy = (y - this.cy) * this.scale
    let tx = 0
    let ty = 0
    if (Math.abs(dx) > hw) tx = this.cx + (dx - Math.sign(dx) * hw) / this.scale
    if (Math.abs(dy) > hh) ty = this.cy + (dy - Math.sign(dy) * hh) / this.scale
    this.cx += (tx - this.cx) * (tx !== 0 ? 0.3 : k)
    this.cy += (ty - this.cy) * (ty !== 0 ? 0.3 : k)
  }

  /** Ease toward (x, y). `k` is the per-step blend; 1 snaps. */
  follow(x: number, y: number, k: number): void {
    if (!this.started) {
      this.cx = x
      this.cy = y
      this.started = true
      return
    }
    this.cx += (x - this.cx) * k
    this.cy += (y - this.cy) * k
  }

  toScreenX(x: number): number {
    return this.width / 2 + (x - this.cx) * this.scale
  }
  toScreenY(y: number): number {
    return this.height / 2 + (y - this.cy) * this.scale
  }
  toWorldX(sx: number): number {
    return (sx - this.width / 2) / this.scale + this.cx
  }
  toWorldY(sy: number): number {
    return (sy - this.height / 2) / this.scale + this.cy
  }
}
