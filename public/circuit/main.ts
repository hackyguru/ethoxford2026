// This obviously doesn't need to be a separate file, but it's here to
// demonstrate that you can split up your summon code like this.
import isEqual from './isEqual.ts';
import isLarger from './isLarger.ts';

export default (io: Summon.IO) => {
  // Inputs from ID Holder (Bob)
  const age = io.input('bob', 'age', summon.number());
  const residency = io.input('bob', 'residency', summon.number());

  // Inputs from Verifier (Alice)
  const minAge = io.input('alice', 'minAge', summon.number());
  const requiredResidency = io.input('alice', 'requiredResidency', summon.number());

  let valid = 0;

  // Check if residency matches
  if (isEqual(residency, requiredResidency)) {
    // Check if age is greater than minAge
    if (isLarger(age, minAge)) {
      valid = 1;
    }
    // Or check if age is equal to minAge
    if (isEqual(age, minAge)) {
      valid = 1;
    }
  }

  io.outputPublic('valid', valid);
};
