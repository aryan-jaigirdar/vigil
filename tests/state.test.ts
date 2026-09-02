import { describe, expect, it } from 'vitest';
import { StateTracker } from '../src/state.js';

describe('StateTracker', () => {
  it('starts every check as unknown', () => {
    const tracker = new StateTracker(2);
    expect(tracker.stateOf('web')).toBe('unknown');
  });

  it('settles unknown -> up silently on first success', () => {
    const tracker = new StateTracker(2);
    expect(tracker.record('web', true)).toBeNull();
    expect(tracker.stateOf('web')).toBe('up');
  });

  it('does not go down before the failure threshold', () => {
    const tracker = new StateTracker(2);
    tracker.record('web', true);
    expect(tracker.record('web', false)).toBeNull();
    expect(tracker.stateOf('web')).toBe('up');
    expect(tracker.consecutiveFailuresOf('web')).toBe(1);
  });

  it('transitions up -> down at the threshold', () => {
    const tracker = new StateTracker(2);
    tracker.record('web', true);
    tracker.record('web', false);
    const transition = tracker.record('web', false);
    expect(transition).toEqual({ check: 'web', from: 'up', to: 'down', consecutiveFailures: 2 });
    expect(tracker.stateOf('web')).toBe('down');
  });

  it('alerts when a check comes up down from a cold start', () => {
    const tracker = new StateTracker(2);
    expect(tracker.record('web', false)).toBeNull();
    const transition = tracker.record('web', false);
    expect(transition).toEqual({ check: 'web', from: 'unknown', to: 'down', consecutiveFailures: 2 });
  });

  it('does not re-alert while a check stays down', () => {
    const tracker = new StateTracker(1);
    expect(tracker.record('web', false)).not.toBeNull();
    expect(tracker.record('web', false)).toBeNull();
    expect(tracker.record('web', false)).toBeNull();
    expect(tracker.stateOf('web')).toBe('down');
  });

  it('transitions down -> up on the first success', () => {
    const tracker = new StateTracker(2);
    tracker.record('web', false);
    tracker.record('web', false);
    const transition = tracker.record('web', true);
    expect(transition).toEqual({ check: 'web', from: 'down', to: 'up', consecutiveFailures: 0 });
    expect(tracker.stateOf('web')).toBe('up');
  });

  it('suppresses flapping below the threshold', () => {
    const tracker = new StateTracker(2);
    tracker.record('web', true);
    // fail, recover, fail, recover: never two consecutive failures.
    expect(tracker.record('web', false)).toBeNull();
    expect(tracker.record('web', true)).toBeNull();
    expect(tracker.record('web', false)).toBeNull();
    expect(tracker.record('web', true)).toBeNull();
    expect(tracker.stateOf('web')).toBe('up');
  });

  it('goes down immediately with threshold 1', () => {
    const tracker = new StateTracker(1);
    tracker.record('web', true);
    const transition = tracker.record('web', false);
    expect(transition).toMatchObject({ to: 'down', consecutiveFailures: 1 });
  });

  it('tracks checks independently', () => {
    const tracker = new StateTracker(1);
    tracker.record('a', false);
    tracker.record('b', true);
    expect(tracker.stateOf('a')).toBe('down');
    expect(tracker.stateOf('b')).toBe('up');
  });

  it('rejects a non-positive threshold', () => {
    expect(() => new StateTracker(0)).toThrowError(RangeError);
  });
});
