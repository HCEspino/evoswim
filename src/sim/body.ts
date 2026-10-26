/**
 * A segmented 2D swimmer in a resistive fluid (resistive-force theory).
 *
 * Shape is kinematic: the CPG prescribes joint angles. Motion of the body as a
 * whole is solved from drag alone: the fluid is overdamped, so at every step the
 * net drag force and torque on the body are zero. With linear anisotropic drag
 * (perpendicular coefficient >> parallel) that is a 3×3 linear system in the
 * body's linear velocity (vx, vy) and angular velocity w. Undulation turns into
 * thrust only through the drag asymmetry, so "forward" cannot be faked.
 *
 * Pose: (x, y, phi) places the body frame, whose origin is the head joint and
 * whose x-axis is the head segment. The overdamped solution is independent of
 * that frame choice, so the heading wobble of the head is harmless.
 */
import { JOINT_LIMIT, jointAngles, type CpgParams } from './cpg'

export interface FluidParams {
  /** drag per unit length for motion along a segment */
  cPar: number
  /** drag per unit length for motion across a segment */
  cPerp: number
}

export const DEFAULT_FLUID: FluidParams = { cPar: 0.1, cPerp: 1.0 }

export interface SwimmerOptions {
  segments?: number
  /** total body length, world units */
  length?: number
  fluid?: FluidParams
}

export class Swimmer {
  readonly n: number
  readonly segLen: number
  readonly fluid: FluidParams
  /** pose of the head joint in the world */
  x = 0
  y = 0
  phi = 0
  /** last solved body velocity (world frame), for diagnostics */
  vx = 0
  vy = 0
  w = 0
  /** CPG phase, rad, accumulated so parameter changes stay continuous */
  phase = 0
  /** joint angles (n-1), current and previous step */
  readonly joints: Float64Array
  private readonly jointsPrev: Float64Array
  /** body-frame joint positions (n+1 points), current and previous */
  private readonly bx: Float64Array
  private readonly by: Float64Array
  private readonly bxPrev: Float64Array
  private readonly byPrev: Float64Array
  /** world-frame joint positions, refreshed by step() / refresh() */
  readonly px: Float64Array
  readonly py: Float64Array
  /** energy proxy: sum of squared joint angular velocity × dt */
  energy = 0
  private started = false

  constructor(opts: SwimmerOptions = {}) {
    this.n = opts.segments ?? 12
    this.segLen = (opts.length ?? 1) / this.n
    this.fluid = opts.fluid ?? DEFAULT_FLUID
    const nj = this.n - 1
    this.joints = new Float64Array(nj)
    this.jointsPrev = new Float64Array(nj)
    this.bx = new Float64Array(this.n + 1)
    this.by = new Float64Array(this.n + 1)
    this.bxPrev = new Float64Array(this.n + 1)
    this.byPrev = new Float64Array(this.n + 1)
    this.px = new Float64Array(this.n + 1)
    this.py = new Float64Array(this.n + 1)
    this.buildShape(this.bx, this.by)
    this.refresh()
  }

  reset(x = 0, y = 0, phi = 0): void {
    this.x = x
    this.y = y
    this.phi = phi
    this.vx = this.vy = this.w = 0
    this.phase = 0
    this.energy = 0
    this.joints.fill(0)
    this.jointsPrev.fill(0)
    this.started = false
    this.buildShape(this.bx, this.by)
    this.refresh()
  }

  /** Body-frame chain from the current joint angles. */
  private buildShape(outX: Float64Array, outY: Float64Array): void {
    let cx = 0
    let cy = 0
    let ang = 0
    outX[0] = 0
    outY[0] = 0
    for (let i = 0; i < this.n; i++) {
      if (i > 0) ang += this.joints[i - 1]
      cx += Math.cos(ang) * this.segLen
      cy += Math.sin(ang) * this.segLen
      outX[i + 1] = cx
      outY[i + 1] = cy
    }
  }

  /** World-frame joint positions from pose + body-frame shape. */
  refresh(): void {
    const c = Math.cos(this.phi)
    const s = Math.sin(this.phi)
    for (let i = 0; i <= this.n; i++) {
      this.px[i] = this.x + c * this.bx[i] - s * this.by[i]
      this.py[i] = this.y + s * this.bx[i] + c * this.by[i]
    }
  }

  /** Centroid of the joint positions, world frame. */
  centroid(): [number, number] {
    let sx = 0
    let sy = 0
    for (let i = 0; i <= this.n; i++) {
      sx += this.px[i]
      sy += this.py[i]
    }
    return [sx / (this.n + 1), sy / (this.n + 1)]
  }

  /** Heading = direction of the mean segment tangent, rad. Smoother than the head. */
  heading(): number {
    let tx = 0
    let ty = 0
    for (let i = 0; i < this.n; i++) {
      tx += this.px[i + 1] - this.px[i]
      ty += this.py[i + 1] - this.py[i]
    }
    return Math.atan2(ty, tx)
  }

  /** Signed bearing from heading to the goal, rad, positive = goal on the left. */
  bearingTo(gx: number, gy: number): number {
    const [cx, cy] = this.centroid()
    const want = Math.atan2(gy - cy, gx - cx)
    let d = want - this.heading()
    while (d > Math.PI) d -= 2 * Math.PI
    while (d < -Math.PI) d += 2 * Math.PI
    return d
  }

  /** Advance one fixed step with the CPG driving the joints toward the goal. */
  step(p: CpgParams, dt: number, gx: number, gy: number): void {
    const bearing = this.bearingTo(gx, gy)
    this.phase += 2 * Math.PI * p.freq * dt
    this.jointsPrev.set(this.joints)
    jointAngles(p, this.phase, bearing, this.joints)
    // rate-limit joints so the optimizer cannot teleport the body
    const maxRate = 25 * dt
    let e = 0
    for (let j = 0; j < this.joints.length; j++) {
      let d = this.joints[j] - this.jointsPrev[j]
      if (d > maxRate) d = maxRate
      else if (d < -maxRate) d = -maxRate
      this.joints[j] = this.jointsPrev[j] + d
      e += (d / dt) * (d / dt)
    }
    this.energy += e * dt
    this.advance(dt)
  }

  /** Drive joints directly (tests, hand-tuned gaits) and advance. */
  stepWithJoints(target: ArrayLike<number>, dt: number): void {
    this.jointsPrev.set(this.joints)
    for (let j = 0; j < this.joints.length; j++) {
      const a = target[j]
      this.joints[j] = a > JOINT_LIMIT ? JOINT_LIMIT : a < -JOINT_LIMIT ? -JOINT_LIMIT : a
    }
    this.advance(dt)
  }

  /** Solve the overdamped force/torque balance for (vx, vy, w) and integrate. */
  private advance(dt: number): void {
    this.bxPrev.set(this.bx)
    this.byPrev.set(this.by)
    this.buildShape(this.bx, this.by)
    if (!this.started) {
      // no shape history yet: shape velocity is zero this step
      this.bxPrev.set(this.bx)
      this.byPrev.set(this.by)
      this.started = true
    }
    const c = Math.cos(this.phi)
    const s = Math.sin(this.phi)
    const { cPar, cPerp } = this.fluid
    const L = this.segLen
    // accumulate A (3×3 symmetric) and b (3)
    let a00 = 0, a01 = 0, a02 = 0, a11 = 0, a12 = 0, a22 = 0
    let b0 = 0, b1 = 0, b2 = 0
    for (let i = 0; i < this.n; i++) {
      // segment midpoint and tangent, body frame → world frame (rotation only)
      const mxB = 0.5 * (this.bx[i] + this.bx[i + 1])
      const myB = 0.5 * (this.by[i] + this.by[i + 1])
      const txB = this.bx[i + 1] - this.bx[i]
      const tyB = this.by[i + 1] - this.by[i]
      // shape velocity of the midpoint, body frame
      const uxB = (mxB - 0.5 * (this.bxPrev[i] + this.bxPrev[i + 1])) / dt
      const uyB = (myB - 0.5 * (this.byPrev[i] + this.byPrev[i + 1])) / dt
      const rx = c * mxB - s * myB
      const ry = s * mxB + c * myB
      let tx = c * txB - s * tyB
      let ty = s * txB + c * tyB
      const tl = Math.hypot(tx, ty) || 1
      tx /= tl
      ty /= tl
      const ux = c * uxB - s * uyB
      const uy = s * uxB + c * uyB
      // drag tensor D = L (cPar t tᵀ + cPerp n nᵀ), n = (-ty, tx)
      const dxx = L * (cPar * tx * tx + cPerp * ty * ty)
      const dxy = L * (cPar - cPerp) * tx * ty
      const dyy = L * (cPar * ty * ty + cPerp * tx * tx)
      // J r = (-ry, rx)
      const jx = -ry
      const jy = rx
      // D (J r)
      const djx = dxx * jx + dxy * jy
      const djy = dxy * jx + dyy * jy
      a00 += dxx
      a01 += dxy
      a11 += dyy
      a02 += djx
      a12 += djy
      a22 += jx * djx + jy * djy
      // D u
      const dux = dxx * ux + dxy * uy
      const duy = dxy * ux + dyy * uy
      b0 -= dux
      b1 -= duy
      b2 -= jx * dux + jy * duy
    }
    // solve symmetric 3×3 by Cramer's rule
    const det =
      a00 * (a11 * a22 - a12 * a12) -
      a01 * (a01 * a22 - a12 * a02) +
      a02 * (a01 * a12 - a11 * a02)
    if (Math.abs(det) > 1e-18) {
      const inv = 1 / det
      const vx =
        (b0 * (a11 * a22 - a12 * a12) -
          a01 * (b1 * a22 - a12 * b2) +
          a02 * (b1 * a12 - a11 * b2)) * inv
      const vy =
        (a00 * (b1 * a22 - a12 * b2) -
          b0 * (a01 * a22 - a12 * a02) +
          a02 * (a01 * b2 - b1 * a02)) * inv
      const w =
        (a00 * (a11 * b2 - b1 * a12) -
          a01 * (a01 * b2 - b1 * a02) +
          b0 * (a01 * a12 - a11 * a02)) * inv
      this.vx = vx
      this.vy = vy
      this.w = w
    } else {
      this.vx = this.vy = this.w = 0
    }
    this.x += this.vx * dt
    this.y += this.vy * dt
    this.phi += this.w * dt
    this.refresh()
  }
}
