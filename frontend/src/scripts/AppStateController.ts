import {
  Behaviour,
  registerType,
  findObjectOfType,
  Animator,
  WaitForSeconds,
} from "@needle-tools/engine";

/**
 * Central place that turns a "state code" sent from the host page (React)
 * into whatever the 3D scene should actually do (play an animation, toggle
 * visibility, swap a material, ...). React only ever needs to know codes;
 * this component owns the mapping from a code to scene behaviour, and
 * reports back once a transition has actually finished.
 *
 * Added to the scene from React via `addComponent` (see NeedlePage.jsx) —
 * no Unity export wiring required for this to work. See unity-comms.txt
 * for the full React <-> scene contract.
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

  // Entry point React calls to push a state in:
  //   findObjectOfType(AppStateController)?.setState("STATE_1")
  setState(code: string) {
    if (!code || code === this.currentState) return;
    this.currentState = code;

    this.notifyReact("app-state-started", code);

    const clip = this.clipForCode(code);
    if (!clip) {
      console.warn(`AppStateController: no animation clip mapped for state "${code}"`);
      return;
    }

    this.startCoroutine(this.playAndReportCompletion(clip, code));
  }

  private *playAndReportCompletion(clip: any, code: string) {
    const animator = findObjectOfType(Animator, this.context);
    if (!animator) {
      console.warn(`AppStateController: no Animator component found to play "${clip.name}"`);
      return;
    }
    animator.play(clip.name);

    // Wait for the real transition to finish before reporting completion.
    // Swap this for whatever "finished" means for the state in question.
    yield WaitForSeconds(clip.duration ?? 1);

    this.notifyReact("app-state-complete", code);
  }

  private clipForCode(code: string) {
    const index = STATE_CODES.indexOf(code);
    return index >= 0 ? this.clips[index] : undefined;
  }

  // Single choke point for anything pushed back out to the host page.
  private notifyReact(eventName: string, code: string) {
    this.context.domElement?.dispatchEvent(
      new CustomEvent(eventName, { detail: { code } })
    );
  }
}
