import { BehaviorSubject, filter, Observable } from 'rxjs';

export function updateBehavior<T>(
  subj: BehaviorSubject<T>,
  updateFn: (oldState: T) => T,
) {
  subj.next(updateFn(subj.getValue()));
}

export const Tuple = <T extends [any, ...any]>(v: T) => v;

function isNonNullable<T>(val: T): val is NonNullable<T> {
  return val !== null && val !== undefined;
}

export const filterNull =
  <T>() =>
  (obs: Observable<T>) =>
    obs.pipe(filter(isNonNullable));
