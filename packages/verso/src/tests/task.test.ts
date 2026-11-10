import {describe, test, expect, vi} from "vitest";
import {isInterruption, TaskRunner, type Task} from "../core/client/task";
import {silence, silenced} from "../util/promise";
import {rejected, tick} from "./util/promise";

type FakeTask = {
  task: Task;
  started: () => boolean;
  interrupted: () => boolean;
  finish: () => void;
  fail: (err: unknown) => void;
};

// Mock Task with externally controlled lifecycle
function makeFakeTask(): FakeTask {
  const dfd = Promise.withResolvers<void>();
  let started = false;
  let interrupted = false;

  const task: Task = () => {
    started = true;
    return {
      promise: dfd.promise,
      interrupt: () => {
        interrupted = true;
      },
    };
  };

  return {
    task,
    started: () => started,
    interrupted: () => interrupted,
    finish: () => dfd.resolve(),
    fail: (err) => dfd.reject(err),
  };
}

describe('TaskRunner', () => {

  describe('running tasks', () => {

    test('runs a single task to completion', async () => {
      const runner = new TaskRunner();
      const fake = makeFakeTask();
      const done = runner.runTask(fake.task);
      expect(fake.started()).toBe(true);
      expect(fake.interrupted()).toBe(false);
      fake.finish();
      await done;
    });

    test('runs sequential tasks', async () => {
      const runner = new TaskRunner();
      const a = makeFakeTask();
      const b = makeFakeTask();

      const aDone = runner.runTask(a.task);
      a.finish();
      await aDone;

      const bDone = runner.runTask(b.task);
      expect(b.started()).toBe(true);
      expect(a.interrupted()).toBe(false);

      b.finish();
      await bDone;
    });

    test('task failure propagates to caller', async () => {
      const runner = new TaskRunner();
      const fake = makeFakeTask();
      const done = runner.runTask(fake.task);
      expect(fake.started()).toBe(true);
      expect(fake.interrupted()).toBe(false);
      const err = new Error('fake failure');
      fake.fail(err);
      await expect(done).rejects.toThrow(err);
    });

    test('synchronous throw from task factory propagates and leaves runner usable', async () => {
      const runner = new TaskRunner();
      const err = new Error('factory boom');
      const throwingTask: Task = () => { throw err; };
      await expect(runner.runTask(throwingTask)).rejects.toThrow(err);

      // the runner must not be wedged: a fresh task still runs to completion.
      const fake = makeFakeTask();
      const done = runner.runTask(fake.task);
      expect(fake.started()).toBe(true);
      fake.finish();
      await done;
    });

  });

  describe('interruptions', () => {

    test('interrupts current task when new task arrives', () => {
      const runner = new TaskRunner();
      const a = makeFakeTask();
      const b = makeFakeTask();
      void runner.runTask(a.task);
      void runner.runTask(b.task);
      expect(a.interrupted()).toBe(true);
    });

    test('waits for interrupted task to fully settle before starting next', async () => {
      const runner = new TaskRunner();
      const a = makeFakeTask();
      const b = makeFakeTask();

      const aDone = runner.runTask(a.task);
      await tick();

      void runner.runTask(b.task);
      expect(b.started()).toBe(false);
      a.finish();
      expect(b.started()).toBe(false);
      await silenced(aDone);
      expect(b.started()).toBe(true);
    });

    test('rejects with sentinel when interrupted, overwriting underlying rejection', async () => {
      const runner = new TaskRunner();
      const a = makeFakeTask();
      const b = makeFakeTask();
      const aDone = runner.runTask(a.task);
      void runner.runTask(b.task);
      a.fail(new Error('some other error'));
      await expect(aDone).rejects.toThrow();
      expect(isInterruption(await rejected(aDone))).toBe(true);
    });

    test('rejects with sentinel when interrupted, even if task resolves', async () => {
      const runner = new TaskRunner();
      const a = makeFakeTask();
      const b = makeFakeTask();
      const aDone = runner.runTask(a.task);
      void runner.runTask(b.task);
      a.finish();
      await expect(aDone).rejects.toThrow();
      expect(isInterruption(await rejected(aDone))).toBe(true);
    });

    test('rejects with sentinel when displaced by new task while still queued', async () => {
      const runner = new TaskRunner();
      const a = makeFakeTask();
      const b = makeFakeTask();
      const c = makeFakeTask();

      silence(runner.runTask(a.task));
      const bDone = runner.runTask(b.task);
      void runner.runTask(c.task);

      a.finish(); // b won't reject until a is done
      expect(b.started()).toBe(false);
      await expect(bDone).rejects.toThrow();
      expect(isInterruption(await rejected(bDone))).toBe(true);
    });

  });

  describe('lifecycle callbacks', () => {

    test('single task: onActive once before task starts, onIdle once after settle', async () => {
      const onActive = vi.fn();
      const onIdle = vi.fn();
      const runner = new TaskRunner({ onActive, onIdle });
      const fake = makeFakeTask();

      const done = runner.runTask(fake.task);
      expect(onActive).toHaveBeenCalledTimes(1);
      expect(onIdle).toHaveBeenCalledTimes(0);

      fake.finish();
      await done;
      expect(onIdle).toHaveBeenCalledTimes(1);
      expect(onActive).toHaveBeenCalledTimes(1);
    });

    test('overlapping burst: onActive and onIdle each fire exactly once', async () => {
      // A in-flight; B and C arrive while A runs.
      // activeCount never returns to 0 mid-burst, so callbacks fire only once.
      const onActive = vi.fn();
      const onIdle = vi.fn();
      const runner = new TaskRunner({ onActive, onIdle });
      const a = makeFakeTask();
      const b = makeFakeTask();
      const c = makeFakeTask();

      const aDone = silenced(runner.runTask(a.task));
      await tick();
      expect(onActive).toHaveBeenCalledTimes(1);

      // B and C arrive while A is still in-flight.
      const bDone = silenced(runner.runTask(b.task));
      const cDone = runner.runTask(c.task);
      await tick();

      // onActive must not fire again -- we never went idle between tasks.
      expect(onActive).toHaveBeenCalledTimes(1);
      expect(onIdle).toHaveBeenCalledTimes(0);

      // settle A so the interrupted chain can drain.
      a.finish();
      await aDone;
      await bDone;
      await tick();

      // C is now running; still not idle.
      expect(onIdle).toHaveBeenCalledTimes(0);

      c.finish();
      await cDone;
      expect(onIdle).toHaveBeenCalledTimes(1);
      expect(onActive).toHaveBeenCalledTimes(1);
    });

    test('sequential non-overlapping tasks: onActive and onIdle fire once per task', async () => {
      const onActive = vi.fn();
      const onIdle = vi.fn();
      const runner = new TaskRunner({ onActive, onIdle });
      const a = makeFakeTask();
      const b = makeFakeTask();

      // First task.
      const aDone = runner.runTask(a.task);
      a.finish();
      await aDone;
      expect(onActive).toHaveBeenCalledTimes(1);
      expect(onIdle).toHaveBeenCalledTimes(1);

      // Second task starts after first fully settled -- activeCount hit 0.
      const bDone = runner.runTask(b.task);
      b.finish();
      await bDone;
      expect(onActive).toHaveBeenCalledTimes(2);
      expect(onIdle).toHaveBeenCalledTimes(2);
    });

    test('ordering: onActive fires before task body; onIdle fires after settle (success)', async () => {
      const order: string[] = [];
      const onActive = vi.fn(() => order.push('onActive'));
      const onIdle = vi.fn(() => order.push('onIdle'));
      const fake = makeFakeTask();
      const origTask = fake.task;
      const wrappedTask: Task = () => { order.push('taskStart'); return origTask(); };

      const runner = new TaskRunner({ onActive, onIdle });
      const done = runner.runTask(wrappedTask);
      expect(order).toEqual(['onActive', 'taskStart']);

      fake.finish();
      await done;
      expect(order).toEqual(['onActive', 'taskStart', 'onIdle']);
    });

    test('ordering: onIdle fires after settle on failure path', async () => {
      const onIdle = vi.fn();
      const runner = new TaskRunner({ onActive: vi.fn(), onIdle });
      const fake = makeFakeTask();

      const done = runner.runTask(fake.task);
      fake.fail(new Error('boom'));
      await done.catch(() => {});
      expect(onIdle).toHaveBeenCalledTimes(1);
    });

    test('synchronous throw from task factory: onActive and onIdle still fire once', async () => {
      const onActive = vi.fn();
      const onIdle = vi.fn();
      const runner = new TaskRunner({ onActive, onIdle });

      const throwingTask: Task = () => { throw new Error('factory boom'); };
      await expect(runner.runTask(throwingTask)).rejects.toThrow();

      // activeCount must return to 0 even on the synchronous-throw path, so the
      // idle callback fires exactly once.
      expect(onActive).toHaveBeenCalledTimes(1);
      expect(onIdle).toHaveBeenCalledTimes(1);
    });

  });

});
