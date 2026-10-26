/**
 * A segmented 2D swimmer in a resistive fluid (resistive-force theory).
 *
 * Shape is kinematic: the CPG prescribes spine joint angles and each limb's
 * stroke. Motion of the body as a whole comes from the fluid: linear
 * anisotropic drag per segment (perpendicular coefficient >> parallel), plus
 * the body's own inertia. Each step solves a 3×3 linear system for the body's
 * linear velocity (vx, vy) and angular velocity w, with drag treated
 * implicitly so the step is unconditionally stable. Undulation turns into
 * thrust only through the drag asymmetry, so "forward" cannot be faked;
 * inertia makes the body coast between beats instead of twitching.
 *
 * The body is a tree of chains: the spine, then limbs rooted at spine joints.
 * Every segment is a drag element; chains only matter for building the shape
 * and for rendering.
 *
 * Pose: (x, y, phi) places the body frame, whose origin is the head joint and
 * whose x-axis is the head segment. Momentum is tracked about that point.
 */
import { JOINT_LIMIT, jointAngles, type CpgParams } from './cpg'
import { spineOnly, type Morphology } from './morphology'

export interface FluidParams {
  /** drag per unit length for motion along a segment */
  cPar: number
  /** drag per unit length for motion across a segment */
  cPerp: number
  /** body mass per unit length; 0 gives the overdamped (massless) limit */
  rho: number
  /** added mass per unit length for broadside motion: the water a segment drags along */
  rhoA: number
}

/**
 * rhoA is kept at 0: tracking momentum through a shape-dependent added-mass
 * tensor sheds it wrongly when segments rotate (broadside momentum becomes a
 * velocity spike edge-on). Isotropic body mass gives the coasting we want.
 */
export const DEFAULT_FLUID: FluidParams = { cPar: 0.1, cPerp: 1.0, rho: 0.14, rhoA: 0 }
/** Largest passive bend the fluid can impose on a joint, rad. */
export const DEFLECT_LIMIT = 0.6
/** Time constant of the passive-bend filter, s, and its slew limit, rad/s: the
 * fluid feedback is explicit (one step late), so it must not be able to slam a joint. */
export const DEFLECT_TAU = 0.06
export const DEFLECT_RATE = 4

/** Largest joint angular speed, rad/s. */
export const JOINT_RATE_LIMIT = 10
/** Largest limb joint bend, rad. */
export const LIMB_LIMIT = 1.4
/** Time constant of the goal-bearing filter, s: a goal jump becomes a smooth turn. */
export const BEARING_TAU = 0.3

export interface Chain {
  kind: 'spine' | 'limb'
  /** first segment index and segment count in the flat segment arrays */
  first: number
  count: number
  /** visual width at the chain's root, body lengths */
  width: number
  /** index into morphology.limbs for limbs */
  limb: number
}

export class Swimmer {
  readonly morph: Morphology
  readonly fluid: FluidParams
  /** spine segment count */
  readonly n: number
  readonly spineLen: number
  /** total segment count (spine + limbs) */
  readonly segs: number
  readonly chains: Chain[]
  readonly segLen: Float64Array
  /** pose of the head joint in the world */
  x = 0
  y = 0
  phi = 0
  /** last solved body velocity (world frame), for diagnostics */
  vx = 0
  vy = 0
  w = 0
  private Px = 0
  private Py = 0
  private Lz = 0
  /** CPG phase, rad, accumulated so parameter changes stay continuous */
  phase = 0
  /** filtered goal bearing, rad */
  bearingF = 0
  private bearingInit = false
  /** spine joint angles (n-1), current and previous step */
  readonly joints: Float64Array
  private readonly jointsPrev: Float64Array
  private readonly jointVel: Float64Array
  /** controller targets for the spine joints (before compliance) */
  readonly jointTarget: Float64Array
  /** limb joint angles, flat, in limb order */
  readonly limbJoints: Float64Array
  private readonly limbJointsPrev: Float64Array
  private readonly limbJointVel: Float64Array
  readonly limbJointTarget: Float64Array
  /** fluid torque about each joint from everything distal to it, last step */
  readonly jointTorque: Float64Array
  readonly limbJointTorque: Float64Array
  /** filtered passive deflection per joint, rad */
  private readonly jointDefl: Float64Array
  private readonly limbJointDefl: Float64Array
  /** per-segment world drag force, last step */
  private readonly fx: Float64Array
  private readonly fy: Float64Array
  private readonly limbJointOffset: Int32Array
  /** body-frame segment endpoints, current and previous */
  private readonly ax: Float64Array
  private readonly ay: Float64Array
  private readonly bx: Float64Array
  private readonly by: Float64Array
  private readonly axPrev: Float64Array
  private readonly ayPrev: Float64Array
  private readonly bxPrev: Float64Array
  private readonly byPrev: Float64Array
  /** world-frame segment endpoints, refreshed by step() / refresh() */
  readonly wax: Float64Array
  readonly way: Float64Array
  readonly wbx: Float64Array
  readonly wby: Float64Array
  /** world-frame spine joints (n+1), convenience view for centroid/heading */
  readonly px: Float64Array
  readonly py: Float64Array
  private readonly segScratch: Float64Array
  private readonly bucketFx: Float64Array
  private readonly bucketFy: Float64Array
  private readonly bucketM: Float64Array
  private readonly jointX: Float64Array
  private readonly jointY: Float64Array
  private readonly segAng: Float64Array
  /** work done against the fluid (drag dissipation), integrated over time */
  energy = 0
  private started = false

  constructor(morph: Morphology = spineOnly(), fluid: FluidParams = DEFAULT_FLUID) {
    this.morph = morph
    this.fluid = fluid
    this.n = morph.spineSegments
    this.spineLen = 1 / this.n
    const chains: Chain[] = [{ kind: 'spine', first: 0, count: this.n, width: 0.035 * morph.plumage.spineWidth, limb: -1 }]
    let segs = this.n
    let lj = 0
    this.limbJointOffset = new Int32Array(morph.limbs.length + 1)
    morph.limbs.forEach((l, i) => {
      chains.push({ kind: 'limb', first: segs, count: l.segments, width: l.width, limb: i })
      segs += l.segments
      this.limbJointOffset[i] = lj
      lj += l.segments
    })
    this.limbJointOffset[morph.limbs.length] = lj
    this.chains = chains
    this.segs = segs
    this.segLen = new Float64Array(segs)
    for (const c of chains) {
      const L = c.kind === 'spine' ? this.spineLen : morph.limbs[c.limb].length / c.count
      for (let i = 0; i < c.count; i++) this.segLen[c.first + i] = L
    }
    this.joints = new Float64Array(this.n - 1)
    this.jointsPrev = new Float64Array(this.n - 1)
    this.jointVel = new Float64Array(this.n - 1)
    this.jointTarget = new Float64Array(this.n - 1)
    this.jointTorque = new Float64Array(this.n - 1)
    this.jointDefl = new Float64Array(this.n - 1)
    this.limbJointDefl = new Float64Array(lj)
    this.limbJoints = new Float64Array(lj)
    this.limbJointsPrev = new Float64Array(lj)
    this.limbJointVel = new Float64Array(lj)
    this.limbJointTarget = new Float64Array(lj)
    this.limbJointTorque = new Float64Array(lj)
    this.fx = new Float64Array(segs)
    this.fy = new Float64Array(segs)
    const mk = () => new Float64Array(segs)
    this.ax = mk(); this.ay = mk(); this.bx = mk(); this.by = mk()
    this.axPrev = mk(); this.ayPrev = mk(); this.bxPrev = mk(); this.byPrev = mk()
    this.wax = mk(); this.way = mk(); this.wbx = mk(); this.wby = mk()
    this.px = new Float64Array(this.n + 1)
    this.py = new Float64Array(this.n + 1)
    this.segScratch = new Float64Array(segs * 7)
    this.bucketFx = new Float64Array(this.n)
    this.bucketFy = new Float64Array(this.n)
    this.bucketM = new Float64Array(this.n)
    this.jointX = new Float64Array(this.n + 1)
    this.jointY = new Float64Array(this.n + 1)
    this.segAng = new Float64Array(this.n)
    this.buildShape()
    this.refresh()
  }

  reset(x = 0, y = 0, phi = 0): void {
    this.x = x
    this.y = y
    this.phi = phi
    this.vx = this.vy = this.w = 0
    this.Px = this.Py = this.Lz = 0
    this.phase = 0
    this.energy = 0
    this.bearingF = 0
    this.bearingInit = false
    this.joints.fill(0)
    this.jointsPrev.fill(0)
    this.jointVel.fill(0)
    this.jointTorque.fill(0)
    this.jointDefl.fill(0)
    this.limbJointDefl.fill(0)
    this.limbJoints.fill(0)
    this.limbJointsPrev.fill(0)
    this.limbJointVel.fill(0)
    this.limbJointTorque.fill(0)
    this.fx.fill(0)
    this.fy.fill(0)
    this.started = false
    this.buildShape()
    this.refresh()
  }

  /** Body-frame segments from the current joint angles: spine chain, then limbs. */
  private buildShape(): void {
    // spine
    let cx = 0, cy = 0, ang = 0
    const jointX = this.jointX
    const jointY = this.jointY
    const segAng = this.segAng
    for (let i = 0; i < this.n; i++) {
      if (i > 0) ang += this.joints[i - 1]
      segAng[i] = ang
      this.ax[i] = cx
      this.ay[i] = cy
      cx += Math.cos(ang) * this.spineLen
      cy += Math.sin(ang) * this.spineLen
      this.bx[i] = cx
      this.by[i] = cy
      jointX[i + 1] = cx
      jointY[i + 1] = cy
    }
    // limbs
    for (let li = 0; li < this.morph.limbs.length; li++) {
      const l = this.morph.limbs[li]
      const c = this.chains[li + 1]
      const L = this.segLen[c.first]
      let lx = jointX[l.rootJoint]
      let ly = jointY[l.rootJoint]
      // tail-ward direction of the spine at the root, rotated outward by side*baseAngle
      let a = segAng[Math.min(this.n - 1, l.rootJoint)] + l.side * l.baseAngle
      const jo = this.limbJointOffset[li]
      for (let k = 0; k < c.count; k++) {
        a += this.limbJoints[jo + k]
        const s = c.first + k
        this.ax[s] = lx
        this.ay[s] = ly
        lx += Math.cos(a) * L
        ly += Math.sin(a) * L
        this.bx[s] = lx
        this.by[s] = ly
      }
    }
  }

  /** World-frame segment endpoints and spine joints from pose + body-frame shape. */
  refresh(): void {
    const c = Math.cos(this.phi)
    const s = Math.sin(this.phi)
    for (let i = 0; i < this.segs; i++) {
      this.wax[i] = this.x + c * this.ax[i] - s * this.ay[i]
      this.way[i] = this.y + s * this.ax[i] + c * this.ay[i]
      this.wbx[i] = this.x + c * this.bx[i] - s * this.by[i]
      this.wby[i] = this.y + s * this.bx[i] + c * this.by[i]
    }
    this.px[0] = this.wax[0]
    this.py[0] = this.way[0]
    for (let i = 0; i < this.n; i++) {
      this.px[i + 1] = this.wbx[i]
      this.py[i + 1] = this.wby[i]
    }
  }

  /** Centroid of the spine joints, world frame. */
  centroid(): [number, number] {
    let sx = 0, sy = 0
    for (let i = 0; i <= this.n; i++) {
      sx += this.px[i]
      sy += this.py[i]
    }
    return [sx / (this.n + 1), sy / (this.n + 1)]
  }

  /** Heading = the direction the swimmer faces, rad: the mean tail→head spine tangent. */
  heading(): number {
    let tx = 0, ty = 0
    for (let i = 0; i < this.n; i++) {
      tx += this.px[i] - this.px[i + 1]
      ty += this.py[i] - this.py[i + 1]
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
    const raw = this.bearingTo(gx, gy)
    if (!this.bearingInit) {
      this.bearingF = raw
      this.bearingInit = true
    } else {
      // first-order filter on the angle difference, so wrap-around stays smooth
      let d = raw - this.bearingF
      while (d > Math.PI) d -= 2 * Math.PI
      while (d < -Math.PI) d += 2 * Math.PI
      this.bearingF += d * (1 - Math.exp(-dt / BEARING_TAU))
      while (this.bearingF > Math.PI) this.bearingF -= 2 * Math.PI
      while (this.bearingF < -Math.PI) this.bearingF += 2 * Math.PI
    }
    this.phase += 2 * Math.PI * p.freq * dt
    jointAngles(p, this.phase, this.bearingF, this.jointTarget)
    // limbs: root stroke plus a lagged whip down the limb
    for (let li = 0; li < this.morph.limbs.length; li++) {
      const l = this.morph.limbs[li]
      const jo = this.limbJointOffset[li]
      for (let k = 0; k < l.segments; k++) {
        const amp = k === 0 ? l.amp : l.amp * l.whip
        let a = l.side * amp * Math.sin(this.phase + l.phase - k * l.lag)
        if (a > LIMB_LIMIT) a = LIMB_LIMIT
        else if (a < -LIMB_LIMIT) a = -LIMB_LIMIT
        this.limbJointTarget[jo + k] = a
      }
    }
    this.drive(this.joints, this.jointsPrev, this.jointVel, this.jointTarget, this.jointTorque, this.jointDefl, p.kSpine, p.response, JOINT_LIMIT, dt)
    this.drive(this.limbJoints, this.limbJointsPrev, this.limbJointVel, this.limbJointTarget, this.limbJointTorque, this.limbJointDefl, p.kLimb, p.response, LIMB_LIMIT, dt)
    this.advance(dt)
    this.jointTorques()
  }

  /**
   * Compliant joints: each joint is a critically damped spring toward
   * (controller target + fluid torque / stiffness). The second term is the
   * passive bend: a tail swept through water lags and whips instead of being
   * positioned by fiat. Semi-implicit Euler; muscle rate limit still applies.
   */
  private drive(
    th: Float64Array,
    prev: Float64Array,
    vel: Float64Array,
    target: Float64Array,
    torque: Float64Array,
    deflF: Float64Array,
    k: number,
    responseHz: number,
    limit: number,
    dt: number,
  ): void {
    prev.set(th)
    const w0 = 2 * Math.PI * responseHz
    const maxRate = JOINT_RATE_LIMIT
    const blend = 1 - Math.exp(-dt / DEFLECT_TAU)
    for (let j = 0; j < th.length; j++) {
      let defl = torque[j] / k
      if (defl > DEFLECT_LIMIT) defl = DEFLECT_LIMIT
      else if (defl < -DEFLECT_LIMIT) defl = -DEFLECT_LIMIT
      let dd = (defl - deflF[j]) * blend
      const maxDd = DEFLECT_RATE * dt
      if (dd > maxDd) dd = maxDd
      else if (dd < -maxDd) dd = -maxDd
      deflF[j] += dd
      let goal = target[j] + deflF[j]
      if (goal > limit) goal = limit
      else if (goal < -limit) goal = -limit
      const acc = w0 * w0 * (goal - th[j]) - 2 * w0 * vel[j]
      let v = vel[j] + acc * dt
      if (v > maxRate) v = maxRate
      else if (v < -maxRate) v = -maxRate
      let a = th[j] + v * dt
      if (a > limit) {
        a = limit
        v = 0
      } else if (a < -limit) {
        a = -limit
        v = 0
      }
      vel[j] = v
      th[j] = a
    }
  }

  /**
   * Fluid torque about every joint from the drag on everything distal to it,
   * using last step's segment forces. Positions relative to the head joint.
   * Spine joint j sits at the end of spine segment j; segment i and the limbs
   * rooted at joint position i are distal to joint j when i >= j + 1.
   */
  private jointTorques(): void {
    const n = this.n
    const hx = this.x, hy = this.y
    // per-spine-position buckets of (force, moment about head)
    const bFx = this.bucketFx, bFy = this.bucketFy, bM = this.bucketM
    bFx.fill(0); bFy.fill(0); bM.fill(0)
    const addSeg = (bucket: number, i: number) => {
      const mx = 0.5 * (this.wax[i] + this.wbx[i]) - hx
      const my = 0.5 * (this.way[i] + this.wby[i]) - hy
      bFx[bucket] += this.fx[i]
      bFy[bucket] += this.fy[i]
      bM[bucket] += mx * this.fy[i] - my * this.fx[i]
    }
    for (let i = 0; i < n; i++) addSeg(i, i)
    for (let li = 0; li < this.morph.limbs.length; li++) {
      const l = this.morph.limbs[li]
      const c = this.chains[li + 1]
      const bucket = Math.min(n - 1, l.rootJoint)
      for (let k = 0; k < c.count; k++) addSeg(bucket, c.first + k)
      // torques within the limb: suffix sums from the tip
      const jo = this.limbJointOffset[li]
      let sFx = 0, sFy = 0, sM = 0
      for (let k = c.count - 1; k >= 0; k--) {
        const i = c.first + k
        const mx = 0.5 * (this.wax[i] + this.wbx[i]) - hx
        const my = 0.5 * (this.way[i] + this.wby[i]) - hy
        sFx += this.fx[i]
        sFy += this.fy[i]
        sM += mx * this.fy[i] - my * this.fx[i]
        const px = this.wax[i] - hx, py = this.way[i] - hy
        this.limbJointTorque[jo + k] = sM - (px * sFy - py * sFx)
      }
    }
    // spine: suffix sums from the tail
    let sFx = 0, sFy = 0, sM = 0
    for (let j = n - 2; j >= 0; j--) {
      sFx += bFx[j + 1]
      sFy += bFy[j + 1]
      sM += bM[j + 1]
      const px = this.px[j + 1] - hx, py = this.py[j + 1] - hy
      this.jointTorque[j] = sM - (px * sFy - py * sFx)
    }
  }

  /** Drive spine joints directly (tests, hand-tuned gaits) and advance. Limbs hold still. */
  stepWithJoints(target: ArrayLike<number>, dt: number): void {
    this.jointsPrev.set(this.joints)
    for (let j = 0; j < this.joints.length; j++) {
      const a = target[j]
      this.joints[j] = a > JOINT_LIMIT ? JOINT_LIMIT : a < -JOINT_LIMIT ? -JOINT_LIMIT : a
    }
    this.advance(dt)
  }

  /** Drive limb joints directly (tests) and advance. Spine holds still. */
  stepWithLimbJoints(target: ArrayLike<number>, dt: number): void {
    this.limbJointsPrev.set(this.limbJoints)
    for (let j = 0; j < this.limbJoints.length; j++) this.limbJoints[j] = target[j]
    this.advance(dt)
  }

  /** Solve the implicit momentum balance for (vx, vy, w) and integrate. */
  private advance(dt: number): void {
    this.axPrev.set(this.ax); this.ayPrev.set(this.ay)
    this.bxPrev.set(this.bx); this.byPrev.set(this.by)
    this.buildShape()
    if (!this.started) {
      this.axPrev.set(this.ax); this.ayPrev.set(this.ay)
      this.bxPrev.set(this.bx); this.byPrev.set(this.by)
      this.started = true
    }
    const c = Math.cos(this.phi)
    const s = Math.sin(this.phi)
    const { cPar, cPerp, rho, rhoA } = this.fluid
    const seg = this.segScratch
    let a00 = 0, a01 = 0, a02 = 0, a11 = 0, a12 = 0, a22 = 0
    let b0 = 0, b1 = 0, b2 = 0
    // generalized mass: Mvv (2×2), Mvw (2), Mww, and shape momenta
    let m00 = 0, m01 = 0, m11 = 0, Sx = 0, Sy = 0, Izz = 0, mux = 0, muy = 0, mlu = 0
    for (let i = 0; i < this.segs; i++) {
      const L = this.segLen[i]
      const mxB = 0.5 * (this.ax[i] + this.bx[i])
      const myB = 0.5 * (this.ay[i] + this.by[i])
      const txB = this.bx[i] - this.ax[i]
      const tyB = this.by[i] - this.ay[i]
      const uxB = (mxB - 0.5 * (this.axPrev[i] + this.bxPrev[i])) / dt
      const uyB = (myB - 0.5 * (this.ayPrev[i] + this.byPrev[i])) / dt
      const rx = c * mxB - s * myB
      const ry = s * mxB + c * myB
      let tx = c * txB - s * tyB
      let ty = s * txB + c * tyB
      const tl = Math.hypot(tx, ty) || 1
      tx /= tl
      ty /= tl
      const ux = c * uxB - s * uyB
      const uy = s * uxB + c * uyB
      const dxx = L * (cPar * tx * tx + cPerp * ty * ty)
      const dxy = L * (cPar - cPerp) * tx * ty
      const dyy = L * (cPar * ty * ty + cPerp * tx * tx)
      const jx = -ry
      const jy = rx
      // mass tensor: body mass isotropic, added mass broadside (n nᵀ)
      const mb = rho * L
      const ma = rhoA * L
      const mxx = mb + ma * ty * ty
      const mxy = -ma * tx * ty
      const myy = mb + ma * tx * tx
      m00 += mxx
      m01 += mxy
      m11 += myy
      // M (J r)
      const mjx = mxx * jx + mxy * jy
      const mjy = mxy * jx + myy * jy
      Sx += mjx
      Sy += mjy
      Izz += jx * mjx + jy * mjy
      // M u and (J r)·(M u)
      const mux_i = mxx * ux + mxy * uy
      const muy_i = mxy * ux + myy * uy
      mux += mux_i
      muy += muy_i
      mlu += jx * mux_i + jy * muy_i
      const o = i * 7
      seg[o] = rx; seg[o + 1] = ry; seg[o + 2] = ux; seg[o + 3] = uy
      seg[o + 4] = dxx; seg[o + 5] = dxy; seg[o + 6] = dyy
      const djx = dxx * jx + dxy * jy
      const djy = dxy * jx + dyy * jy
      a00 += dxx
      a01 += dxy
      a11 += dyy
      a02 += djx
      a12 += djy
      a22 += jx * djx + jy * djy
      const dux = dxx * ux + dxy * uy
      const duy = dxy * ux + dyy * uy
      b0 -= dux
      b1 -= duy
      b2 -= jx * dux + jy * duy
    }
    const c00 = m00 + dt * a00, c01 = m01 + dt * a01, c02 = Sx + dt * a02
    const c10 = m01 + dt * a01, c11 = m11 + dt * a11, c12 = Sy + dt * a12
    const c20 = Sx + dt * a02 + dt * this.Py, c21 = Sy + dt * a12 - dt * this.Px, c22 = Izz + dt * a22
    const r0 = this.Px - mux + dt * b0
    const r1 = this.Py - muy + dt * b1
    const r2 = this.Lz - mlu + dt * b2
    const det =
      c00 * (c11 * c22 - c12 * c21) -
      c01 * (c10 * c22 - c12 * c20) +
      c02 * (c10 * c21 - c11 * c20)
    if (Math.abs(det) > 1e-18) {
      const inv = 1 / det
      this.vx = (r0 * (c11 * c22 - c12 * c21) - c01 * (r1 * c22 - c12 * r2) + c02 * (r1 * c21 - c11 * r2)) * inv
      this.vy = (c00 * (r1 * c22 - c12 * r2) - r0 * (c10 * c22 - c12 * c20) + c02 * (c10 * r2 - r1 * c20)) * inv
      this.w = (c00 * (c11 * r2 - r1 * c21) - c01 * (c10 * r2 - r1 * c20) + r0 * (c10 * c21 - c11 * c20)) * inv
    } else {
      this.vx = this.vy = this.w = 0
    }
    this.Px = m00 * this.vx + m01 * this.vy + this.w * Sx + mux
    this.Py = m01 * this.vx + m11 * this.vy + this.w * Sy + muy
    this.Lz = Sx * this.vx + Sy * this.vy + Izz * this.w + mlu
    let power = 0
    for (let i = 0; i < this.segs; i++) {
      const o = i * 7
      const vx = this.vx - this.w * seg[o + 1] + seg[o + 2]
      const vy = this.vy + this.w * seg[o] + seg[o + 3]
      const dfx = seg[o + 4] * vx + seg[o + 5] * vy
      const dfy = seg[o + 5] * vx + seg[o + 6] * vy
      // drag force on the segment (world), kept for the joint-torque pass
      this.fx[i] = -dfx
      this.fy[i] = -dfy
      power += vx * dfx + vy * dfy
    }
    this.energy += power * dt
    this.x += this.vx * dt
    this.y += this.vy * dt
    this.phi += this.w * dt
    this.refresh()
  }
}
