import { Behaviour, registerType, findObjectOfType, Animator } from "@needle-tools/engine";

/**
 * Central place that turns a "state code" sent from the host page (React)
 * into whatever the 3D scene should actually do (play an animation, toggle
 * visibility, swap a material, ...). React only ever needs to know codes;
 * this component owns the mapping from a code to scene behaviour.
 *
 * Added to the scene from React via `addComponent` (see NeedlePage.jsx) —
 * no Unity export wiring required for this to work.
 */

// Order here maps 1:1 to the animation clips found in the loaded glTF,
// mirroring the "Animation 1/2/3" buttons the page exposes today.
const STATE_CODES = ["STATE_1", "STATE_2", "STATE_3"];

@registerType
export class AppStateController extends Behaviour {
  private clips: any[] = [];
  private currentState: string | null = null;

  start() {
    this.clips = [];
    this.context.scene.traverse((obj: any) => {
      if (obj.animations?.length) this.clips.push(...obj.animations);
    });
  }

  getState() {
    return this.currentState;
  }

  setState(code: string) {
    if (!code || code === this.currentState) return;
    const previous = this.currentState;
    this.currentState = code;

    this.applyState(code);

    this.context.domElement?.dispatchEvent(
      new CustomEvent("app-state-changed", { detail: { code, previous } })
    );
  }

  private applyState(code: string) {
    const index = STATE_CODES.indexOf(code);
    const clip = index >= 0 ? this.clips[index] : undefined;
    if (!clip) {
      console.warn(`AppStateController: no animation clip mapped for state "${code}"`);
      return;
    }

    const animator = findObjectOfType(Animator, this.context);
    if (!animator) {
      console.warn(`AppStateController: no Animator component found to play "${clip.name}"`);
      return;
    }
    animator.play(clip.name);
  }
}
