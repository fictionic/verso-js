import {getRLS} from "../common/RequestLocalStorage";

const RLS = getRLS<{
  controller: AbortController,
  dfd: PromiseWithResolvers<never>,
  timeoutId: NodeJS.Timeout | undefined;
}>();

export function initAbortController(parent?: AbortSignal) {
  const controller = parent ? chainedController(parent) : new AbortController();
  const dfd = Promise.withResolvers<never>();
  if (controller.signal.aborted) {
    dfd.reject(controller.signal.reason);
  } else {
    controller.signal.addEventListener('abort', () => dfd.reject(controller.signal.reason), { once: true });
  }
  RLS().controller = controller;
  RLS().dfd = dfd;

}

export function getAbortSignal(): AbortSignal {
  return RLS().controller.signal;
}

export function getAbortPromise(): Promise<never> {
  return RLS().dfd.promise;
}

export function didAbort(): boolean {
  return RLS().controller.signal.aborted;
}

export function startAbortTimeout(reason: any, timeoutMs: number): void {
  const timeoutId = RLS().timeoutId;
  if (timeoutId) throw new Error('already an active abort timeout!');
  RLS().timeoutId = setTimeout(() => {
    RLS().controller.abort(reason);
  }, timeoutMs);
}

export function cancelAbortTimeout(): void {
  const timeoutId = RLS().timeoutId;
  if (timeoutId) {
    clearTimeout(timeoutId);
    RLS().timeoutId = undefined;
  }
}

function chainedController(parent: AbortSignal): AbortController {
  const controller = new AbortController();
  if (parent.aborted) {
    controller.abort(parent.reason);
    return controller;
  }
  parent.addEventListener(
    'abort',
    () => controller.abort(parent.reason),
    { once: true, signal: controller.signal },
  );
  return controller;
}
